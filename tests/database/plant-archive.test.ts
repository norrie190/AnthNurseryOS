import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { archivePlant, restorePlant } from '../../src/modules/plants/plant-archive-service';
import {
  archivePlantAction,
  restorePlantAction,
} from '../../src/modules/plants/plant-archive-actions';
import { updatePlant } from '../../src/modules/plants/plant-update-service';
import {
  getPlantList,
  getArchivedPlantList,
  getPlantById,
  getPlantParentOptions,
} from '../../src/modules/plants/plant-queries';
import { PlantError } from '../../src/modules/plants/plant-errors';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: () => queryTransaction ?? database }));
const url = getTestDatabaseUrl();
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 5000, max: 5 }),
});
const realTransaction = database.$transaction.bind(database);
let queryTransaction: Prisma.TransactionClient | undefined;
let baseline: unknown;
let sequence: unknown;
const rollbackFixture = new Error('Roll back archive fixtures');

async function counts(client: Prisma.TransactionClient = database) {
  return client.$queryRaw`SELECT
    (SELECT count(*) FROM "Plant") AS plants,
    (SELECT count(*) FROM "PlantParentage") AS parents,
    (SELECT count(*) FROM "PlantPurchase") AS purchases,
    (SELECT count(*) FROM "PlantPhoto") AS photos,
    (SELECT count(*) FROM "Location") AS locations`;
}
beforeAll(async () => {
  const [target] = await database.$queryRaw<
    { name: string; version: number }[]
  >`SELECT current_database() AS name, current_setting('server_version_num')::int AS version`;
  expect(target.name).toBe(decodeURIComponent(new URL(url).pathname.slice(1)));
  expect(target.version).toBeGreaterThanOrEqual(180000);
  expect(target.version).toBeLessThan(190000);
  baseline = await counts();
  sequence =
    await database.$queryRaw`SELECT last_value, is_called FROM public.plant_reference_sequence`;
});
afterEach(async () => {
  queryTransaction = undefined;
  vi.restoreAllMocks();
  expect(await counts()).toEqual(baseline);
  expect(
    await database.$queryRaw`SELECT last_value, is_called FROM public.plant_reference_sequence`,
  ).toEqual(sequence);
});
afterAll(() => database.$disconnect());

async function fixture(check: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await realTransaction(
      async (tx) => {
        // Same rollback isolation as the edit tests. Only the transaction boundary is
        // redirected; services and SQL run unchanged against the separate test DB.
        const operationTransaction = async (
          operation: (client: Prisma.TransactionClient) => Promise<unknown>,
          options?: { isolationLevel?: string },
        ) => {
          expect(options?.isolationLevel).toBe('ReadCommitted');
          await tx.$executeRaw`SAVEPOINT plant_archive_operation`;
          try {
            const result = await operation(tx);
            await tx.$executeRaw`RELEASE SAVEPOINT plant_archive_operation`;
            return result;
          } catch (error) {
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT plant_archive_operation`;
            await tx.$executeRaw`RELEASE SAVEPOINT plant_archive_operation`;
            throw error;
          }
        };
        vi.spyOn(database, '$transaction').mockImplementation(
          operationTransaction as typeof database.$transaction,
        );
        await check(tx);
        throw rollbackFixture;
      },
      { timeout: 15000 },
    );
  } catch (error) {
    if (error !== rollbackFixture) throw error;
  }
}
function plant(tx: Prisma.TransactionClient, data: Partial<Prisma.PlantUncheckedCreateInput> = {}) {
  return tx.plant.create({ data: { reference: `test-archive-${randomUUID()}`, ...data } });
}
function token(record: { updatedAt: Date }) {
  return { expectedUpdatedAt: record.updatedAt.toISOString() };
}
async function read<T>(tx: Prisma.TransactionClient, query: () => Promise<T>) {
  queryTransaction = tx;
  try {
    return await query();
  } finally {
    queryTransaction = undefined;
  }
}

test.each(['GROWING', 'QUARANTINE', 'SOLD', 'DECEASED'] as const)(
  'archives and restores %s without changing status or identity',
  (status) =>
    fixture(async (tx) => {
      const original = await plant(tx, { status, name: 'History', notes: 'Preserve me' });
      const archived = await archivePlant(original.id, token(original));
      expect(archived.changed).toBe(true);
      expect(archived.plant.archivedAt).toBeInstanceOf(Date);
      expect(archived.plant).toEqual({
        ...original,
        archivedAt: archived.plant.archivedAt,
        updatedAt: archived.plant.updatedAt,
      });
      expect(archived.plant.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
      const restored = await restorePlant(original.id, token(archived.plant));
      expect(restored.changed).toBe(true);
      expect(restored.plant).toEqual({ ...original, updatedAt: restored.plant.updatedAt });
      expect(restored.plant.updatedAt.getTime()).toBeGreaterThan(
        archived.plant.updatedAt.getTime(),
      );
    }),
);

test('preserves parentage, purchase, photos, Location and links from offspring through archive and restore', () =>
  fixture(async (tx) => {
    const location = await tx.location.create({
      data: { name: `archive-location-${randomUUID()}`, archivedAt: new Date() },
    });
    const parent = await plant(tx);
    const original = await plant(tx, { locationId: location.id });
    const offspring = await plant(tx);
    await tx.plantParentage.create({
      data: {
        plantId: original.id,
        seedParentPlantId: parent.id,
        pollenParentName: 'External parent',
      },
    });
    await tx.plantParentage.create({
      data: {
        plantId: offspring.id,
        seedParentPlantId: original.id,
        pollenParentPlantId: original.id,
      },
    });
    await tx.plantPurchase.create({
      data: {
        plantId: original.id,
        seller: 'Seller',
        orderReference: 'Order',
        plantPriceMinor: 5000,
        shippingCostMinor: 0,
        otherCostMinor: null,
      },
    });
    await tx.plantPhoto.createMany({
      data: [0, 1].map((sortOrder) => ({
        plantId: original.id,
        storageKey: `archive-test/${randomUUID()}`,
        originalFilename: 'fixture.jpeg',
        sortOrder,
      })),
    });
    const snapshot = () =>
      tx.plant.findUniqueOrThrow({
        where: { id: original.id },
        include: {
          location: true,
          purchase: true,
          parentage: true,
          photos: { orderBy: { sortOrder: 'asc' } },
          offspringAsSeedParent: true,
          offspringAsPollenParent: true,
        },
      });
    const before = await snapshot();
    const beforeCounts = await counts(tx);
    const archived = await archivePlant(original.id, token(original));
    expect(await snapshot()).toEqual({
      ...before,
      archivedAt: archived.plant.archivedAt,
      updatedAt: archived.plant.updatedAt,
    });
    expect(await counts(tx)).toEqual(beforeCounts);
    const restored = await restorePlant(original.id, token(archived.plant));
    expect(await snapshot()).toEqual({ ...before, updatedAt: restored.plant.updatedAt });
    expect(await counts(tx)).toEqual(beforeCounts);
  }));

test('repeated archive keeps the original archive timestamp and repeated restore is a no op', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    expect(await restorePlant(original.id, token(original))).toEqual({
      plant: original,
      changed: false,
    });
    const archived = await archivePlant(original.id, token(original));
    expect(await archivePlant(original.id, token(original))).toEqual({
      ...archived,
      changed: false,
    });
    const restored = await restorePlant(original.id, token(archived.plant));
    expect(await restorePlant(original.id, token(archived.plant))).toEqual({
      ...restored,
      changed: false,
    });
  }));

test('moves between active and archived queries while keeping details and parent options accessible', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    expect(await read(tx, getPlantList)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: original.id })]),
    );
    const archived = await archivePlant(original.id, token(original));
    expect((await read(tx, getPlantList)).some((item) => item.id === original.id)).toBe(false);
    expect(await read(tx, getArchivedPlantList)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: original.id,
          reference: original.reference,
          archivedAt: archived.plant.archivedAt,
        }),
      ]),
    );
    expect(await read(tx, () => getPlantById(original.id))).toMatchObject({
      id: original.id,
      reference: original.reference,
      archivedAt: archived.plant.archivedAt,
    });
    expect(await read(tx, getPlantParentOptions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: original.id, label: expect.stringContaining('(Archived)') }),
      ]),
    );
    await restorePlant(original.id, token(archived.plant));
    expect((await read(tx, getArchivedPlantList)).some((item) => item.id === original.id)).toBe(
      false,
    );
    expect((await read(tx, getPlantList)).some((item) => item.id === original.id)).toBe(true);
  }));

test('orders archived Plants by newest archive then reference, independently of their creation dates', () =>
  fixture(async (tx) => {
    const prefix = `archive-order-${randomUUID()}`;
    const older = await plant(tx, { reference: `${prefix}-3`, archivedAt: new Date('2026-01-01') });
    const second = await plant(tx, {
      reference: `${prefix}-2`,
      archivedAt: new Date('2026-01-02'),
      createdAt: new Date('2025-01-01'),
    });
    const first = await plant(tx, {
      reference: `${prefix}-1`,
      archivedAt: new Date('2026-01-02'),
      createdAt: new Date('2024-01-01'),
    });
    const active = await plant(tx, { reference: `${prefix}-4` });
    const ids = (await read(tx, getArchivedPlantList))
      .filter((item) => item.reference.startsWith(prefix))
      .map((item) => item.id);
    expect(ids).toEqual([first.id, second.id, older.id]);
    expect(ids).not.toContain(active.id);
  }));

test.each([archivePlant, restorePlant])('%s reports a missing Plant', (operation) =>
  fixture(async () => {
    await expect(
      operation(randomUUID(), { expectedUpdatedAt: new Date().toISOString() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }),
);

test('rejects stale state changes after another edit, without silently overwriting it', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    const edited = await updatePlant(original.id, { ...token(original), notes: 'Newer edit' });
    await expect(archivePlant(original.id, token(original))).rejects.toMatchObject({
      code: 'STALE_UPDATE',
    });
    const archived = await archivePlant(original.id, token(edited));
    const editedWhileArchived = await updatePlant(original.id, {
      ...token(archived.plant),
      purchase: {},
    });
    await expect(restorePlant(original.id, token(archived.plant))).rejects.toMatchObject({
      code: 'STALE_UPDATE',
    });
    expect(await tx.plant.findUnique({ where: { id: original.id } })).toMatchObject({
      archivedAt: archived.plant.archivedAt,
      notes: 'Newer edit',
      updatedAt: editedWhileArchived.updatedAt,
    });
  }));

test('archive and restore invalidate old edit forms and stale opposite state requests', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    const archived = await archivePlant(original.id, token(original));
    await expect(
      updatePlant(original.id, { ...token(original), name: 'Stale' }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
    await expect(restorePlant(original.id, token(original))).rejects.toMatchObject({
      code: 'STALE_UPDATE',
    });
    const restored = await restorePlant(original.id, token(archived.plant));
    await expect(
      updatePlant(original.id, { ...token(archived.plant), name: 'Stale' }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
    await expect(archivePlant(original.id, token(original))).rejects.toMatchObject({
      code: 'STALE_UPDATE',
    });
    expect(await tx.plant.findUnique({ where: { id: original.id } })).toEqual(restored.plant);
  }));

test('advances updatedAt strictly even for rapid archive and restore within the same millisecond', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    vi.spyOn(Date, 'now').mockReturnValue(original.updatedAt.getTime());
    const archived = await archivePlant(original.id, token(original));
    const restored = await restorePlant(original.id, token(archived.plant));
    expect(archived.plant.updatedAt.getTime()).toBe(original.updatedAt.getTime() + 1);
    expect(restored.plant.updatedAt.getTime()).toBe(original.updatedAt.getTime() + 2);
  }));

test('locks the target before writing but does not lock the parentage graph', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    const raw = vi.spyOn(tx, '$queryRaw');
    const update = vi.spyOn(tx.plant, 'update');
    await archivePlant(original.id, token(original));
    expect(raw.mock.calls).toHaveLength(1);
    expect((raw.mock.calls[0][0] as TemplateStringsArray).join('')).toContain('FOR NO KEY UPDATE');
    expect(raw.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
    await realTransaction(async (other) => {
      expect(
        await other.$queryRaw`SELECT pg_try_advisory_xact_lock(1095650894, 1) AS acquired`,
      ).toEqual([{ acquired: true }]);
    });
  }));

test('rolls back timestamps and preserves data after a real database update failure', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    await tx.$executeRaw`CREATE FUNCTION pg_temp.reject_archive() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'archive rollback fixture'; END; $$`;
    await tx.$executeRaw`CREATE TRIGGER reject_archive AFTER UPDATE ON public."Plant" FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_archive()`;
    let failure: unknown;
    try {
      await archivePlant(original.id, token(original));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(PlantError);
    expect(String(failure)).toContain('archive rollback fixture');
    expect(await tx.plant.findUnique({ where: { id: original.id } })).toEqual(original);
  }));

test('real server actions archive, expose the preserved detail and restore the fixture to the active list', () =>
  fixture(async (tx) => {
    const original = await plant(tx, { name: 'Action fixture' });
    expect(
      await archivePlantAction(original.id, original.updatedAt.toISOString(), new FormData()),
    ).toMatchObject({ success: false });
    expect(await tx.plant.findUnique({ where: { id: original.id } })).toEqual(original);
    const data = new FormData();
    data.set('confirmation', 'archive');
    expect(
      await archivePlantAction(original.id, original.updatedAt.toISOString(), data),
    ).toMatchObject({ success: true });
    const archived = await read(tx, () => getPlantById(original.id));
    expect(archived).toMatchObject({
      reference: original.reference,
      name: original.name,
      archivedAt: expect.any(Date),
    });
    expect((await read(tx, getPlantList)).some((item) => item.id === original.id)).toBe(false);
    expect(
      await restorePlantAction(original.id, archived!.updatedAt.toISOString(), new FormData()),
    ).toMatchObject({ success: true });
    expect((await read(tx, getPlantList)).some((item) => item.id === original.id)).toBe(true);
  }));
