import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';
import { createPlantAction } from '../../src/modules/plants/plant-actions';
import type { CreatedPlant } from '../../src/modules/plants/plant-service';
import { initialPlantFormState } from '../../src/modules/plants/plant-form-state';
import {
  getPlantById,
  getPlantList,
  getPlantParentOptions,
  getUsableLocationOptions,
} from '../../src/modules/plants/plant-queries';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: () => queryTransaction ?? database }));

const url = getTestDatabaseUrl();
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 5_000 }),
});
const realTransaction = database.$transaction.bind(database);
let queryTransaction: Prisma.TransactionClient | undefined;
const redirectSignal = new Error('Next redirect');
let baseline: unknown;
class RollbackFixture extends Error {
  constructor(readonly value?: CreatedPlant) {
    super('Rollback fixture');
  }
}

async function counts() {
  return database.$queryRaw`SELECT
    (SELECT count(*) FROM "Plant") AS plants, (SELECT count(*) FROM "PlantParentage") AS parents,
    (SELECT count(*) FROM "PlantPurchase") AS purchases, (SELECT count(*) FROM "Location") AS locations`;
}
beforeAll(async () => {
  const [target] = await database.$queryRaw<
    { name: string; version: number }[]
  >`SELECT current_database() AS name, current_setting('server_version_num')::int AS version`;
  expect(target.name).toBe(decodeURIComponent(new URL(url).pathname.slice(1)));
  expect(target.version).toBeGreaterThanOrEqual(180000);
  expect(target.version).toBeLessThan(190000);
  baseline = await counts();
});
beforeEach(() => {
  vi.mocked(redirect).mockImplementation(() => {
    throw redirectSignal;
  });
});
afterEach(async () => {
  queryTransaction = undefined;
  vi.restoreAllMocks();
  expect(await counts()).toEqual(baseline);
});
afterAll(async () => {
  await database.$disconnect();
});

test.each([false, true])(
  'the real form action creates and reads a Plant, then redirects (optional details: %s)',
  async (withDetails) => {
    const locationId = randomUUID();
    const parentId = randomUUID();
    let saved: Awaited<ReturnType<typeof getPlantById>>;
    const rollback = async (operation: (tx: Prisma.TransactionClient) => Promise<CreatedPlant>) => {
      try {
        return await realTransaction(async (tx) => {
          if (withDetails) {
            await tx.location.create({ data: { id: locationId, name: `test-${randomUUID()}` } });
            await tx.plant.create({
              data: {
                id: parentId,
                reference: `test-${randomUUID()}`,
                status: 'DECEASED',
                archivedAt: new Date(),
              },
            });
          }
          const created = await operation(tx);
          queryTransaction = tx;
          saved = await getPlantById(created.id);
          expect(saved?.reference).toBe(created.reference);
          expect(await getPlantList()).toContainEqual({
            id: created.id,
            reference: created.reference,
            name: created.name,
            status: created.status,
            createdAt: created.createdAt,
            photos: [],
            location: withDetails ? { name: saved!.location!.name } : null,
          });
          throw new RollbackFixture(created);
        });
      } catch (error) {
        if (error instanceof RollbackFixture && error.value) return error.value;
        throw error;
      } finally {
        queryTransaction = undefined;
      }
    };
    vi.spyOn(database, '$transaction').mockImplementation(rollback as typeof database.$transaction);
    const form = new FormData();
    if (withDetails) {
      for (const [key, value] of Object.entries({
        name: 'Test nursery record',
        locationId,
        seedParentMode: 'existing',
        seedParentPlantId: parentId,
        pollenParentMode: 'external',
        pollenParentName: 'External pollen',
        recordPurchase: 'on',
        seller: 'Seller',
        orderReference: 'ORDER-1',
        purchaseDate: '2024-02-29',
        plantPrice: '125.50',
        shippingCost: '',
        otherCost: '0',
        currency: 'GBP',
      }))
        form.set(key, value);
    }
    await expect(createPlantAction(initialPlantFormState, form)).rejects.toBe(redirectSignal);
    expect(saved!).toMatchObject({
      status: 'GROWING',
      reference: expect.stringMatching(/^ANT-\d{4,}$/),
    });
    expect(redirect).toHaveBeenCalledWith(`/plants/${saved!.id}`);
    if (withDetails) {
      expect(saved!).toMatchObject({
        location: { id: locationId },
        parentage: { seedParent: { id: parentId }, pollenParentName: 'External pollen' },
        purchase: {
          plantPriceMinor: 12550,
          shippingCostMinor: null,
          otherCostMinor: 0,
          currency: 'GBP',
          orderReference: 'ORDER-1',
        },
      });
    } else {
      expect(saved!).toMatchObject({ name: null, location: null, parentage: null, purchase: null });
    }
    expect(await database.plant.findUnique({ where: { id: saved!.id } })).toBeNull();
  },
);

test('read options include historical parents but exclude archived Locations', async () => {
  const rootId = randomUUID(),
    shelfId = randomUUID(),
    archivedId = randomUUID(),
    parentId = randomUUID();
  try {
    await realTransaction(async (tx) => {
      await tx.location.create({ data: { id: rootId, name: `test-${randomUUID()}` } });
      await tx.location.create({ data: { id: shelfId, name: 'Shelf', parentLocationId: rootId } });
      await tx.location.create({
        data: { id: archivedId, name: `test-${randomUUID()}`, archivedAt: new Date() },
      });
      await tx.plant.create({
        data: {
          id: parentId,
          reference: `test-${randomUUID()}`,
          status: 'SOLD',
          archivedAt: new Date(),
        },
      });
      queryTransaction = tx;
      const parents = await getPlantParentOptions();
      expect(parents.find((parent) => parent.id === parentId)?.label).toMatch(
        /Unnamed Plant.*Sold.*Archived/,
      );
      const locations = await getUsableLocationOptions();
      expect(locations.some((location) => location.id === archivedId)).toBe(false);
      expect(locations.find((location) => location.id === shelfId)?.label).toMatch(/ \/ Shelf$/);
      expect(await getPlantById(randomUUID())).toBeNull();
      expect(await getPlantById('ANT-0001')).toBeNull();
      throw new RollbackFixture();
    });
  } catch (error) {
    if (!(error instanceof RollbackFixture)) throw error;
  }
});

test('the action returns safe validation without allocating on malformed or missing references', async () => {
  const [before] = await database.$queryRaw<
    { last_value: bigint; is_called: boolean }[]
  >`SELECT last_value, is_called FROM public.plant_reference_sequence`;
  const malformed = new FormData();
  malformed.set('locationId', 'invalid');
  expect(
    (await createPlantAction(initialPlantFormState, malformed)).fieldErrors.locationId,
  ).toBeTruthy();
  const missing = new FormData();
  missing.set('seedParentMode', 'existing');
  missing.set('seedParentPlantId', randomUUID());
  expect((await createPlantAction(initialPlantFormState, missing)).message).toContain(
    'parent Plant does not exist',
  );
  const [after] = await database.$queryRaw<
    { last_value: bigint; is_called: boolean }[]
  >`SELECT last_value, is_called FROM public.plant_reference_sequence`;
  expect(after).toEqual(before);
});

test('lists only non archived Plants, newest first with reference breaking date ties', async () => {
  const prefix = `test-${randomUUID()}`;
  try {
    await realTransaction(async (tx) => {
      // Fixed fixture dates establish ordering without consuming the ANT sequence.
      const older = await tx.plant.create({
        data: {
          reference: `${prefix}-9999`,
          createdAt: new Date('2020-01-01T12:00:00Z'),
        },
      });
      const location = await tx.location.create({
        data: {
          name: prefix,
          archivedAt: new Date(),
        },
      });
      const tiedLater = await tx.plant.create({
        data: {
          reference: `${prefix}-0003`,
          status: 'DECEASED',
          locationId: location.id,
          createdAt: new Date('2020-01-02T12:00:00Z'),
        },
      });
      const tiedFirst = await tx.plant.create({
        data: {
          reference: `${prefix}-0002`,
          status: 'SOLD',
          createdAt: new Date('2020-01-02T12:00:00Z'),
        },
      });
      const newest = await tx.plant.create({
        data: {
          reference: `${prefix}-0001`,
          status: 'QUARANTINE',
          createdAt: new Date('2020-01-03T12:00:00Z'),
        },
      });
      const archived = await tx.plant.create({
        data: {
          reference: `${prefix}-0004`,
          archivedAt: new Date(),
          createdAt: new Date('2020-01-04T12:00:00Z'),
        },
      });
      queryTransaction = tx;
      const listed = (await getPlantList()).filter((plant) => plant.reference.startsWith(prefix));
      expect(listed.map((plant) => plant.id)).toEqual([
        newest.id,
        tiedFirst.id,
        tiedLater.id,
        older.id,
      ]);
      expect(listed.some((plant) => plant.id === archived.id)).toBe(false);
      expect(listed[2].location).toEqual({ name: prefix });
      expect(listed[3]).toEqual({
        id: older.id,
        reference: older.reference,
        name: null,
        status: 'GROWING',
        createdAt: older.createdAt,
        photos: [],
        location: null,
      });
      throw new RollbackFixture();
    });
  } catch (error) {
    if (!(error instanceof RollbackFixture)) throw error;
  }
});
