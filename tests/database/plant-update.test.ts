import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { updatePlant, type UpdatedPlant } from '../../src/modules/plants/plant-update-service';
import { PlantError } from '../../src/modules/plants/plant-errors';
import { updatePlantAction } from '../../src/modules/plants/plant-actions';
import { getPlantById } from '../../src/modules/plants/plant-queries';
import { plantEditValues } from '../../src/modules/plants/plant-edit-values';
import { initialPlantFormState } from '../../src/modules/plants/plant-form-state';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: () => queryTransaction ?? database }));
const url = getTestDatabaseUrl();
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 5000, max: 5 }),
});
const realTransaction = database.$transaction.bind(database);
let queryTransaction: Prisma.TransactionClient | undefined;
let baseline: unknown;
let sequence: unknown;
const rollbackFixture = new Error('Roll back edit fixtures');

async function counts() {
  return database.$queryRaw`SELECT
    (SELECT count(*) FROM "Plant") AS plants,
    (SELECT count(*) FROM "PlantParentage") AS parents,
    (SELECT count(*) FROM "PlantPurchase") AS purchases,
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
        // Keep setup and assertions inside one rolled back transaction. A savepoint
        // gives each public service call its normal atomic failure boundary without
        // committing fixtures or adding transaction hooks to production code.
        const operationTransaction = async (
          operation: (client: Prisma.TransactionClient) => Promise<UpdatedPlant>,
          options?: { isolationLevel?: string },
        ) => {
          expect(options?.isolationLevel).toBe('ReadCommitted');
          await tx.$executeRaw`SAVEPOINT plant_edit_operation`;
          try {
            const result = await operation(tx);
            await tx.$executeRaw`RELEASE SAVEPOINT plant_edit_operation`;
            return result;
          } catch (error) {
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT plant_edit_operation`;
            await tx.$executeRaw`RELEASE SAVEPOINT plant_edit_operation`;
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
function plant(
  tx: Prisma.TransactionClient,
  data: Omit<Prisma.PlantUncheckedCreateInput, 'reference'> = {},
) {
  return tx.plant.create({ data: { reference: `test-edit-${randomUUID()}`, ...data } });
}
function location(tx: Prisma.TransactionClient, archived = false) {
  return tx.location.create({
    data: { name: `edit-location-${randomUUID()}`, archivedAt: archived ? new Date() : null },
  });
}
function token(record: { updatedAt: Date }) {
  return { expectedUpdatedAt: record.updatedAt.toISOString() };
}

test('edits ordinary fields without changing identity, creation/archive timestamps or allocating references', () =>
  fixture(async (tx) => {
    const original = await plant(tx, {
      name: 'Original',
      notes: 'Old',
      archivedAt: new Date('2026-01-01'),
    });
    const saved = await updatePlant(original.id, {
      ...token(original),
      name: ' Revised ',
      status: 'QUARANTINE',
      notes: ' New notes ',
    });
    expect(saved).toMatchObject({
      id: original.id,
      reference: original.reference,
      createdAt: original.createdAt,
      archivedAt: original.archivedAt,
      name: 'Revised',
      status: 'QUARANTINE',
      notes: 'New notes',
      parentage: null,
      purchase: null,
    });
    expect(saved.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
  }));
test('omitted fields and related groups are preserved; explicit null clears nullable fields', () =>
  fixture(async (tx) => {
    const place = await location(tx);
    const original = await plant(tx, {
      name: 'Original',
      notes: 'Notes',
      status: 'SOLD',
      locationId: place.id,
    });
    const parents = await tx.plantParentage.create({
      data: { plantId: original.id, seedParentName: 'Seed' },
    });
    const purchase = await tx.plantPurchase.create({
      data: { plantId: original.id, seller: 'Seller', plantPriceMinor: 5000 },
    });
    const kept = await updatePlant(original.id, { ...token(original), name: undefined });
    expect(kept).toMatchObject({
      name: 'Original',
      notes: 'Notes',
      status: 'SOLD',
      locationId: place.id,
      parentage: parents,
      purchase,
    });
    const cleared = await updatePlant(original.id, {
      ...token(kept),
      name: null,
      notes: null,
      locationId: null,
    });
    expect(cleared).toMatchObject({
      name: null,
      notes: null,
      locationId: null,
      location: null,
      parentage: parents,
      purchase,
    });
  }));
test('creates parentage and transitions linked, external and unknown without deleting its row', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    const historical = await plant(tx, { status: 'DECEASED', archivedAt: new Date() });
    const linked = await updatePlant(original.id, {
      ...token(original),
      parentage: {
        seedParent: { kind: 'plant', plantId: historical.id },
        pollenParent: { kind: 'plant', plantId: historical.id },
      },
    });
    expect(linked.parentage).toMatchObject({
      seedParentPlantId: historical.id,
      pollenParentPlantId: historical.id,
      seedParentName: null,
    });
    const named = await updatePlant(original.id, {
      ...token(linked),
      parentage: { seedParent: { kind: 'external', name: ' External ' } },
    });
    expect(named.parentage).toMatchObject({
      id: linked.parentage!.id,
      seedParentPlantId: null,
      seedParentName: 'External',
      pollenParentPlantId: historical.id,
    });
    const cleared = await updatePlant(original.id, {
      ...token(named),
      parentage: { seedParent: { kind: 'unknown' }, pollenParent: { kind: 'unknown' } },
    });
    expect(cleared.parentage).toMatchObject({
      id: linked.parentage!.id,
      createdAt: linked.parentage!.createdAt,
      seedParentPlantId: null,
      seedParentName: null,
      pollenParentPlantId: null,
      pollenParentName: null,
    });
    const relinked = await updatePlant(original.id, {
      ...token(cleared),
      parentage: {
        pollenParent: { kind: 'external', name: 'Pollen' },
        seedParent: { kind: 'plant', plantId: historical.id },
      },
    });
    expect(relinked.parentage).toMatchObject({
      seedParentPlantId: historical.id,
      pollenParentName: 'Pollen',
    });
  }));
test('does not create a parentage row for unknown roles on a Plant with none', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    expect(
      (
        await updatePlant(original.id, {
          ...token(original),
          parentage: { seedParent: { kind: 'unknown' }, pollenParent: { kind: 'unknown' } },
        })
      ).parentage,
    ).toBeNull();
  }));
test('rejects a missing target, missing parent and self parent', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    await expect(updatePlant(randomUUID(), token(original))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    for (const id of [randomUUID(), original.id]) {
      await expect(
        updatePlant(original.id, {
          ...token(original),
          parentage: { seedParent: { kind: 'plant', plantId: id } },
        }),
      ).rejects.toMatchObject({ code: 'INVALID_PARENT' });
    }
  }));
test.each(['seed', 'pollen'] as const)(
  'rejects direct and multi generation cycles through the %s role',
  (role) =>
    fixture(async (tx) => {
      const ancestor = await plant(tx);
      const child = await plant(tx);
      const descendant = await plant(tx);
      await tx.plantParentage.create({
        data: { plantId: child.id, [`${role}ParentPlantId`]: ancestor.id },
      });
      await tx.plantParentage.create({
        data: {
          plantId: descendant.id,
          [role === 'seed' ? 'pollenParentPlantId' : 'seedParentPlantId']: child.id,
        },
      });
      for (const parentId of [child.id, descendant.id]) {
        await expect(
          updatePlant(ancestor.id, {
            ...token(ancestor),
            parentage: {
              [role === 'seed' ? 'seedParent' : 'pollenParent']: {
                kind: 'plant',
                plantId: parentId,
              },
            },
          }),
        ).rejects.toMatchObject({ code: 'ANCESTRY_CYCLE' });
      }
      expect(await tx.plantParentage.findUnique({ where: { plantId: ancestor.id } })).toBeNull();
    }),
);
test('deduplicates traversal even when preexisting data contains a cycle', () =>
  fixture(async (tx) => {
    const a = await plant(tx);
    const b = await plant(tx);
    const target = await plant(tx);
    await tx.plantParentage.create({ data: { plantId: a.id, seedParentPlantId: b.id } });
    await tx.plantParentage.create({ data: { plantId: b.id, pollenParentPlantId: a.id } });
    const saved = await updatePlant(target.id, {
      ...token(target),
      parentage: { seedParent: { kind: 'plant', plantId: a.id } },
    });
    expect(saved.parentage?.seedParentPlantId).toBe(a.id);
  }));
test('creates an unknown purchase, patches fields, preserves omitted values and clears explicitly', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    const empty = await updatePlant(original.id, { ...token(original), purchase: {} });
    expect(empty.purchase).toMatchObject({
      seller: null,
      currency: 'GBP',
      plantPriceMinor: null,
      shippingCostMinor: null,
      otherCostMinor: null,
    });
    const filled = await updatePlant(original.id, {
      ...token(empty),
      purchase: {
        seller: ' Seller ',
        orderReference: ' Order ',
        purchaseDate: '2024-02-29',
        plantPriceMinor: 5000,
        shippingCostMinor: 0,
        otherCostMinor: null,
        currency: 'EUR',
      },
    });
    expect(filled.purchase).toMatchObject({
      id: empty.purchase!.id,
      seller: 'Seller',
      orderReference: 'Order',
      purchaseDate: new Date('2024-02-29T00:00:00.000Z'),
      plantPriceMinor: 5000,
      shippingCostMinor: 0,
      otherCostMinor: null,
      currency: 'EUR',
    });
    const kept = await updatePlant(original.id, { ...token(filled), purchase: {} });
    expect(kept.purchase).toEqual(filled.purchase);
    const partial = await updatePlant(original.id, {
      ...token(kept),
      purchase: { seller: null, plantPriceMinor: 0 },
    });
    expect(partial.purchase).toMatchObject({
      seller: null,
      orderReference: 'Order',
      plantPriceMinor: 0,
      shippingCostMinor: 0,
      currency: 'EUR',
    });
    const cleared = await updatePlant(original.id, {
      ...token(partial),
      purchase: {
        orderReference: null,
        purchaseDate: null,
        plantPriceMinor: null,
        shippingCostMinor: null,
        otherCostMinor: null,
      },
    });
    expect(cleared.purchase).toMatchObject({
      id: empty.purchase!.id,
      seller: null,
      orderReference: null,
      purchaseDate: null,
      plantPriceMinor: null,
      shippingCostMinor: null,
      otherCostMinor: null,
      currency: 'EUR',
    });
  }));
test('currency changes never convert stored amounts', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    await tx.plantPurchase.create({ data: { plantId: original.id, plantPriceMinor: 12550 } });
    expect(
      (await updatePlant(original.id, { ...token(original), purchase: { currency: 'EUR' } }))
        .purchase,
    ).toMatchObject({ currency: 'EUR', plantPriceMinor: 12550 });
  }));
test('preserves an assigned archived Location, moves to a usable Location and can clear it', () =>
  fixture(async (tx) => {
    const archived = await location(tx, true);
    const usable = await location(tx);
    const original = await plant(tx, { locationId: archived.id });
    const omitted = await updatePlant(original.id, { ...token(original), notes: 'New' });
    expect(omitted.location?.id).toBe(archived.id);
    const unchanged = await updatePlant(original.id, {
      ...token(omitted),
      locationId: archived.id,
    });
    expect(unchanged.location?.archivedAt).not.toBeNull();
    const moved = await updatePlant(original.id, { ...token(unchanged), locationId: usable.id });
    expect(moved.locationId).toBe(usable.id);
    await expect(
      updatePlant(original.id, { ...token(moved), locationId: archived.id }),
    ).rejects.toMatchObject({ code: 'LOCATION_UNAVAILABLE' });
    await expect(
      updatePlant(original.id, { ...token(moved), locationId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'LOCATION_UNAVAILABLE' });
    expect(
      (await updatePlant(original.id, { ...token(moved), locationId: null })).location,
    ).toBeNull();
  }));
test('two callers with the same token cannot overwrite the first successful edit', () =>
  fixture(async (tx) => {
    const original = await plant(tx, { name: 'Original' });
    const first = await updatePlant(original.id, { ...token(original), name: 'First caller' });
    await expect(
      updatePlant(original.id, { ...token(original), name: 'Second caller', purchase: {} }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
    expect(await tx.plant.findUnique({ where: { id: original.id } })).toMatchObject({
      name: 'First caller',
      updatedAt: first.updatedAt,
    });
    expect(await tx.plantPurchase.count({ where: { plantId: original.id } })).toBe(0);
  }));
test('related only and rapid edits advance the timestamp even when the clock has not advanced', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    vi.spyOn(Date, 'now').mockReturnValue(original.updatedAt.getTime());
    const parent = await updatePlant(original.id, {
      ...token(original),
      parentage: { seedParent: { kind: 'external', name: 'Named' } },
    });
    const purchase = await updatePlant(original.id, { ...token(parent), purchase: {} });
    const simple = await updatePlant(original.id, { ...token(purchase), notes: 'Notes' });
    expect(parent.updatedAt.getTime()).toBe(original.updatedAt.getTime() + 1);
    expect(purchase.updatedAt.getTime()).toBe(parent.updatedAt.getTime() + 1);
    expect(simple.updatedAt.getTime()).toBe(purchase.updatedAt.getTime() + 1);
  }));
test('uses a transaction advisory lock before Plant and Location locks, and releases it on rollback', async () => {
  await fixture(async (tx) => {
    const original = await plant(tx);
    const place = await location(tx);
    const raw = vi.spyOn(tx, '$queryRaw');
    await updatePlant(original.id, {
      ...token(original),
      locationId: place.id,
      parentage: { seedParent: { kind: 'external', name: 'Named' } },
    });
    const statements = raw.mock.calls.map(([strings]) =>
      Array.isArray(strings) ? strings.join('') : '',
    );
    expect(statements[0]).toContain('pg_advisory_xact_lock');
    expect(statements[1]).toContain('FOR NO KEY UPDATE');
    expect(statements[2]).toContain('FOR SHARE');
    await realTransaction(async (other) => {
      expect(
        await other.$queryRaw`SELECT pg_try_advisory_xact_lock(1095650894, 1) AS acquired`,
      ).toEqual([{ acquired: false }]);
    });
  });
  await realTransaction(async (other) => {
    expect(
      await other.$queryRaw`SELECT pg_try_advisory_xact_lock(1095650894, 1) AS acquired`,
    ).toEqual([{ acquired: true }]);
  });
});
test('ordinary field edits do not acquire the parentage advisory lock', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    await updatePlant(original.id, { ...token(original), notes: 'Notes' });
    await realTransaction(async (other) => {
      expect(
        await other.$queryRaw`SELECT pg_try_advisory_xact_lock(1095650894, 1) AS acquired`,
      ).toEqual([{ acquired: true }]);
    });
  }));
test('rolls back Plant, parentage and purchase after a real related SQL update failure', () =>
  fixture(async (tx) => {
    const original = await plant(tx, { name: 'Before' });
    const parentage = await tx.plantParentage.create({
      data: { plantId: original.id, seedParentName: 'Before' },
    });
    const purchase = await tx.plantPurchase.create({
      data: { plantId: original.id, seller: 'Before' },
    });
    await tx.$executeRaw`CREATE FUNCTION pg_temp.reject_edit_purchase() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM public."Plant" WHERE id = NEW."plantId" AND name = 'After')
        AND EXISTS (SELECT 1 FROM public."PlantParentage" WHERE "plantId" = NEW."plantId" AND "seedParentName" = 'After') THEN
        RAISE EXCEPTION 'edit rollback fixture saw previous writes';
      END IF;
      RAISE EXCEPTION 'edit rollback fixture missing previous writes';
    END; $$`;
    await tx.$executeRaw`CREATE TRIGGER reject_edit_purchase BEFORE UPDATE ON public."PlantPurchase" FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_edit_purchase()`;
    let failure: unknown;
    try {
      await updatePlant(original.id, {
        ...token(original),
        name: 'After',
        parentage: { seedParent: { kind: 'external', name: 'After' } },
        purchase: { seller: 'After' },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(PlantError);
    expect(String(failure)).toContain('edit rollback fixture saw previous writes');
    expect(await tx.plant.findUnique({ where: { id: original.id } })).toEqual(original);
    expect(await tx.plantParentage.findUnique({ where: { plantId: original.id } })).toEqual(
      parentage,
    );
    expect(await tx.plantPurchase.findUnique({ where: { plantId: original.id } })).toEqual(
      purchase,
    );
  }));
test('the real edit action saves, reads the unchanged reference and redirects to detail', () =>
  fixture(async (tx) => {
    const original = await plant(tx, { name: 'Before' });
    queryTransaction = tx;
    const record = await getPlantById(original.id);
    queryTransaction = undefined;
    const data = new FormData();
    for (const [key, value] of Object.entries({
      ...plantEditValues(record!),
      name: 'After',
      recordPurchase: 'on',
      plantPrice: '50.00',
      shippingCost: '',
      otherCost: '0',
      seedParentMode: 'external',
      seedParentName: 'Named',
    }))
      data.set(key, value);
    const signal = new Error('Next redirect');
    vi.mocked(redirect).mockImplementation(() => {
      throw signal;
    });
    await expect(
      updatePlantAction(original.id, original.updatedAt.toISOString(), initialPlantFormState, data),
    ).rejects.toBe(signal);
    expect(redirect).toHaveBeenCalledWith(`/plants/${original.id}`);
    queryTransaction = tx;
    expect(await getPlantById(original.id)).toMatchObject({
      id: original.id,
      reference: original.reference,
      name: 'After',
      purchase: { plantPriceMinor: 5000, shippingCostMinor: null, otherCostMinor: 0 },
      parentage: { seedParentName: 'Named' },
    });
    queryTransaction = undefined;
  }));
