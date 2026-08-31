import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { redirect } from 'next/navigation';
import {
  createEquipmentAction,
  updateEquipmentAction,
} from '../../src/modules/equipment/equipment-actions';
import {
  archiveEquipmentAction,
  restoreEquipmentAction,
} from '../../src/modules/equipment/equipment-archive-actions';
import { initialEquipmentFormState } from '../../src/modules/equipment/equipment-form-state';
import {
  createEquipment,
  updateEquipment,
  archiveEquipment,
  restoreEquipment,
  type EquipmentRecord,
} from '../../src/modules/equipment/equipment-service';
import {
  getEquipmentList,
  getArchivedEquipmentList,
  getEquipmentById,
  getEquipmentLocationOptions,
} from '../../src/modules/equipment/equipment-queries';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: () => binding ?? database }));
const url = getTestDatabaseUrl();
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 5000, max: 8 }),
});
const realTransaction = database.$transaction.bind(database);
let binding: object | undefined;
let baseline: unknown;
let ant: unknown;
const rollback = new Error('Roll back Equipment fixtures');
const token = (record: { updatedAt: Date }) => ({
  expectedUpdatedAt: record.updatedAt.toISOString(),
});

async function records() {
  return database.$queryRaw`SELECT
    (SELECT jsonb_agg(t ORDER BY id) FROM "Plant" t) AS plants,
    (SELECT jsonb_agg(t ORDER BY id) FROM "PlantPurchase" t) AS plant_purchases,
    (SELECT jsonb_agg(t ORDER BY id) FROM "PlantParentage" t) AS parents,
    (SELECT jsonb_agg(t ORDER BY id) FROM "PlantPhoto" t) AS photos,
    (SELECT jsonb_agg(t ORDER BY id) FROM "Location" t) AS locations,
    (SELECT jsonb_agg(t ORDER BY id) FROM "Equipment" t) AS equipment,
    (SELECT jsonb_agg(t ORDER BY id) FROM "EquipmentPurchase" t) AS purchases`;
}
beforeAll(async () => {
  const [target] = await database.$queryRaw<{ name: string; version: number }[]>`
    SELECT current_database() AS name, current_setting('server_version_num')::int AS version
  `;
  expect(target.name).toBe(decodeURIComponent(new URL(url).pathname.slice(1)));
  expect(target.version).toBeGreaterThanOrEqual(180000);
  expect(target.version).toBeLessThan(190000);
  baseline = await records();
  ant = await database.$queryRaw`SELECT last_value, is_called FROM public.plant_reference_sequence`;
});
afterEach(async () => {
  binding = undefined;
  vi.mocked(redirect).mockReset();
  vi.restoreAllMocks();
  expect(await records()).toEqual(baseline);
  expect(
    await database.$queryRaw`SELECT last_value, is_called FROM public.plant_reference_sequence`,
  ).toEqual(ant);
});
afterAll(() => database.$disconnect());

async function fixture(check: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await realTransaction(
      async (tx) => {
        // Only the connection binding is replaced. Each public operation keeps a real
        // SQL rollback boundary, and all setup and successful writes are rolled back too.
        const operationTransaction = async (
          operation: (client: Prisma.TransactionClient) => Promise<unknown>,
          options: { isolationLevel: string },
        ) => {
          expect(options.isolationLevel).toBe('ReadCommitted');
          await tx.$executeRaw`SAVEPOINT equipment_operation`;
          try {
            const result = await operation(tx);
            await tx.$executeRaw`RELEASE SAVEPOINT equipment_operation`;
            return result;
          } catch (error) {
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT equipment_operation`;
            await tx.$executeRaw`RELEASE SAVEPOINT equipment_operation`;
            throw error;
          }
        };
        binding = {
          equipment: tx.equipment,
          location: tx.location,
          $transaction: operationTransaction,
        };
        await check(tx);
        throw rollback;
      },
      { timeout: 15000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
function equipment(
  tx: Prisma.TransactionClient,
  data: Partial<Prisma.EquipmentUncheckedCreateInput> = {},
) {
  return tx.equipment.create({
    data: { reference: `test-${randomUUID()}`, name: 'Light', usesPower: true, ...data },
  });
}
function location(tx: Prisma.TransactionClient, archived = false) {
  return tx.location.create({
    data: { name: `test-${randomUUID()}`, archivedAt: archived ? new Date() : null },
  });
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

test('browser actions create, edit, archive and restore through real services and queries', () =>
  fixture(async (tx) => {
    const signal = new Error('Redirect');
    vi.mocked(redirect).mockImplementation(() => {
      throw signal;
    });
    const place = await location(tx);
    await expect(
      createEquipmentAction(
        initialEquipmentFormState,
        form({
          name: 'Browser light',
          category: 'grow light',
          usesPower: 'true',
          locationId: place.id,
          brand: 'Brand',
          recordPurchase: 'on',
          currency: 'GBP',
          equipmentPrice: '125.50',
          shippingCost: '0',
          otherCost: '',
          seller: 'Shop',
          purchaseDate: '2026-08-13',
        }),
      ),
    ).rejects.toBe(signal);
    const url = vi.mocked(redirect).mock.calls[0][0];
    const id = url.split('/').at(-1)!;
    const saved = await getEquipmentById(id);
    expect(saved).toMatchObject({
      reference: expect.stringMatching(/^EQP-\d{4,}$/),
      name: 'Browser light',
      category: 'Grow Light',
      usesPower: true,
      location: place,
      purchase: {
        equipmentPriceMinor: 12550,
        shippingCostMinor: 0,
        otherCostMinor: null,
        currency: 'GBP',
      },
    });
    if (!saved) throw new Error('Missing created Equipment');
    expect((await getEquipmentList()).map((row) => row.id)).toContain(id);
    await expect(
      updateEquipmentAction(
        id,
        saved.updatedAt.toISOString(),
        initialEquipmentFormState,
        form({
          usesPower: 'false',
          brand: '',
          locationId: '',
          recordPurchase: 'on',
          seller: '',
          equipmentPrice: '',
          currency: 'GBP',
        }),
      ),
    ).rejects.toBe(signal);
    const updated = await getEquipmentById(id);
    expect(updated).toMatchObject({
      reference: saved.reference,
      usesPower: false,
      brand: null,
      location: null,
      purchase: { seller: null, equipmentPriceMinor: null, shippingCostMinor: 0 },
    });
    if (!updated) throw new Error('Missing updated Equipment');
    expect(
      await updateEquipmentAction(
        id,
        saved.updatedAt.toISOString(),
        initialEquipmentFormState,
        form({ name: 'Stale' }),
      ),
    ).toMatchObject({ stale: true });
    expect(
      await archiveEquipmentAction(
        id,
        updated.updatedAt.toISOString(),
        form({ confirmation: 'archive' }),
      ),
    ).toMatchObject({ success: true });
    expect((await getEquipmentList()).map((row) => row.id)).not.toContain(id);
    expect((await getArchivedEquipmentList()).map((row) => row.id)).toContain(id);
    const archived = await getEquipmentById(id);
    if (!archived) throw new Error('Missing archived Equipment');
    expect(
      await restoreEquipmentAction(id, archived.updatedAt.toISOString(), form({})),
    ).toMatchObject({ success: true });
    expect((await getEquipmentList()).map((row) => row.id)).toContain(id);
    expect((await getEquipmentById(id))?.purchase).toEqual(updated.purchase);
  }));

test('minimal nonpowered browser creation and safe domain errors', () =>
  fixture(async (tx) => {
    const signal = new Error('Redirect');
    vi.mocked(redirect).mockImplementation(() => {
      throw signal;
    });
    await expect(
      createEquipmentAction(initialEquipmentFormState, form({ name: 'Rack', usesPower: 'false' })),
    ).rejects.toBe(signal);
    const id = vi.mocked(redirect).mock.calls[0][0].split('/').at(-1)!;
    expect(await getEquipmentById(id)).toMatchObject({
      name: 'Rack',
      usesPower: false,
      category: 'Other',
      purchase: null,
    });
    const archived = await location(tx, true);
    const invalid = await createEquipmentAction(
      initialEquipmentFormState,
      form({ name: 'Light', usesPower: 'true', locationId: archived.id }),
    );
    expect(invalid.fieldErrors.locationId).toBeTruthy();
    const badDate = await createEquipmentAction(
      initialEquipmentFormState,
      form({ name: 'Light', usesPower: 'true', recordPurchase: 'on', purchaseDate: '2026-02-30' }),
    );
    expect(badDate.fieldErrors.purchaseDate).toBeTruthy();
  }));

test.each([true, false])(
  'creates minimal Equipment with explicit power %s and safe defaults',
  (usesPower) =>
    fixture(async () => {
      const saved = await createEquipment({ name: ' Rack ', usesPower });
      expect(saved).toMatchObject({
        name: 'Rack',
        usesPower,
        category: 'Other',
        brand: null,
        model: null,
        serialNumber: null,
        notes: null,
        location: null,
        purchase: null,
        archivedAt: null,
      });
      expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(saved.reference).toMatch(/^EQP-\d{4,}$/);
      expect(await getEquipmentById(saved.id)).toEqual(saved);
      expect(await getEquipmentList()).toContainEqual(expect.objectContaining({ id: saved.id }));
    }),
);
test('creates Location and optional Purchase atomically with exact null/zero/date/currency values', () =>
  fixture(async (tx) => {
    const place = await location(tx);
    const saved = await createEquipment({
      name: 'SF1000D',
      category: 'grow light',
      usesPower: true,
      brand: ' Spider Farmer ',
      model: ' SF1000D ',
      serialNumber: ' 1 ',
      notes: ' notes ',
      locationId: place.id,
      purchase: {
        seller: ' Seller ',
        orderReference: ' Order ',
        purchaseDate: '2024-02-29',
        equipmentPriceMinor: 12550,
        shippingCostMinor: 0,
        otherCostMinor: null,
        currency: ' gbp ',
      },
    });
    expect(saved).toMatchObject({
      category: 'Grow Light',
      brand: 'Spider Farmer',
      model: 'SF1000D',
      serialNumber: '1',
      notes: 'notes',
      location: place,
      purchase: {
        equipmentId: saved.id,
        seller: 'Seller',
        orderReference: 'Order',
        purchaseDate: new Date('2024-02-29T00:00:00.000Z'),
        equipmentPriceMinor: 12550,
        shippingCostMinor: 0,
        otherCostMinor: null,
        currency: 'GBP',
      },
    });
  }));
test('purchase absence differs from explicitly unknown purchase on creation', () =>
  fixture(async () => {
    expect((await createEquipment({ name: 'A', usesPower: false })).purchase).toBeNull();
    expect(
      (await createEquipment({ name: 'B', usesPower: false, purchase: {} })).purchase,
    ).toMatchObject({
      equipmentPriceMinor: null,
      shippingCostMinor: null,
      otherCostMinor: null,
      currency: 'GBP',
    });
  }));
test('new Location assignments reject missing or archived targets before allocation', () =>
  fixture(async (tx) => {
    const place = await location(tx, true);
    const before =
      await tx.$queryRaw`SELECT last_value, is_called FROM public.equipment_reference_sequence`;
    for (const locationId of [randomUUID(), place.id]) {
      await expect(
        createEquipment({ name: 'Light', usesPower: true, locationId }),
      ).rejects.toMatchObject({ code: 'LOCATION_UNAVAILABLE' });
    }
    expect(
      await tx.$queryRaw`SELECT last_value, is_called FROM public.equipment_reference_sequence`,
    ).toEqual(before);
  }));
test('normal editing preserves identity/history and omission while clearing explicit nullable fields', () =>
  fixture(async (tx) => {
    const original = await equipment(tx, {
      brand: 'Brand',
      model: 'Model',
      serialNumber: 'Serial',
      notes: 'Notes',
      archivedAt: new Date('2026-01-01'),
    });
    const saved = await updateEquipment(original.id, {
      ...token(original),
      name: ' Revised ',
      usesPower: false,
      category: 'Custom gear',
      brand: null,
      notes: ' ',
    });
    expect(saved).toMatchObject({
      id: original.id,
      reference: original.reference,
      createdAt: original.createdAt,
      archivedAt: original.archivedAt,
      model: 'Model',
      serialNumber: 'Serial',
      name: 'Revised',
      category: 'Custom gear',
      usesPower: false,
      brand: null,
      notes: null,
    });
    expect(saved.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
  }));
test('purchase {} creates unknown information, then preserves an existing record without rewriting it', () =>
  fixture(async (tx) => {
    const original = await equipment(tx);
    const saved = await updateEquipment(original.id, { ...token(original), purchase: {} });
    expect(saved.purchase).toMatchObject({
      equipmentPriceMinor: null,
      shippingCostMinor: null,
      otherCostMinor: null,
      currency: 'GBP',
    });
    const again = await updateEquipment(original.id, { ...token(saved), purchase: {} });
    expect(again.purchase).toEqual(saved.purchase);
    expect(again.updatedAt.getTime()).toBeGreaterThan(saved.updatedAt.getTime());
  }));
test('purchase patches preserve omissions, clear individual fields and keep zero; currency changes do not convert costs', () =>
  fixture(async (tx) => {
    let saved = await equipment(tx);
    await tx.equipmentPurchase.create({
      data: {
        equipmentId: saved.id,
        seller: 'Seller',
        orderReference: 'Order',
        purchaseDate: new Date('2024-02-29'),
        equipmentPriceMinor: 5000,
        shippingCostMinor: 200,
        otherCostMinor: 100,
      },
    });
    const revised = await updateEquipment(saved.id, {
      ...token(saved),
      purchase: {
        seller: null,
        purchaseDate: null,
        equipmentPriceMinor: 0,
        otherCostMinor: null,
        currency: 'EUR',
      },
    });
    expect(revised.purchase).toMatchObject({
      seller: null,
      orderReference: 'Order',
      purchaseDate: null,
      equipmentPriceMinor: 0,
      shippingCostMinor: 200,
      otherCostMinor: null,
      currency: 'EUR',
    });
    saved = revised;
    expect(
      (await updateEquipment(saved.id, { ...token(saved), notes: 'Updated' })).purchase,
    ).toEqual(revised.purchase);
  }));
test('rapid purchase-only saves strictly advance timestamps even when the server clock is behind', () =>
  fixture(async (tx) => {
    const original = await equipment(tx, { updatedAt: new Date('2099-01-01T00:00:00.000Z') });
    const a = await updateEquipment(original.id, { ...token(original), purchase: {} });
    const b = await updateEquipment(original.id, {
      ...token(a),
      purchase: { equipmentPriceMinor: 0 },
    });
    expect(a.updatedAt.getTime()).toBe(original.updatedAt.getTime() + 1);
    expect(b.updatedAt.getTime()).toBe(a.updatedAt.getTime() + 1);
  }));
test('stale callers cannot overwrite a newer edit or purchase', () =>
  fixture(async (tx) => {
    const original = await equipment(tx);
    const saved = await updateEquipment(original.id, {
      ...token(original),
      name: 'New',
      purchase: {},
    });
    await expect(
      updateEquipment(original.id, {
        ...token(original),
        name: 'Old',
        purchase: { seller: 'Stale' },
      }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
    expect(await getEquipmentById(original.id)).toEqual(saved);
  }));
test('Location can move/clear; current archived assignment can be retained but never newly assigned', () =>
  fixture(async (tx) => {
    const archived = await location(tx, true);
    const usable = await location(tx);
    const original = await equipment(tx, { locationId: archived.id });
    let saved = await updateEquipment(original.id, {
      ...token(original),
      notes: 'Preserve archived',
    });
    expect(saved.location).toEqual(archived);
    saved = await updateEquipment(original.id, { ...token(saved), locationId: archived.id });
    expect(saved.location).toEqual(archived);
    saved = await updateEquipment(original.id, { ...token(saved), locationId: usable.id });
    expect(saved.location).toEqual(usable);
    for (const locationId of [archived.id, randomUUID()]) {
      await expect(
        updateEquipment(original.id, { ...token(saved), locationId }),
      ).rejects.toMatchObject({ code: 'LOCATION_UNAVAILABLE' });
    }
    saved = await updateEquipment(original.id, { ...token(saved), locationId: null });
    expect(saved.location).toBeNull();
  }));

async function failPurchaseWrites(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe(
    `CREATE FUNCTION pg_temp.reject_equipment_purchase() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Equipment purchase fixture failure'; END $$`,
  );
  await tx.$executeRawUnsafe(
    `CREATE TRIGGER equipment_purchase_fixture_failure BEFORE INSERT OR UPDATE ON public."EquipmentPurchase" FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_equipment_purchase()`,
  );
}
test('failed related create rolls back the item but consumes its EQP allocation, never ANT', () =>
  fixture(async (tx) => {
    await failPurchaseWrites(tx);
    const name = randomUUID();
    await expect(createEquipment({ name, usesPower: true, purchase: {} })).rejects.toThrow();
    expect(await tx.equipment.count({ where: { name } })).toBe(0);
    const [failed] = await tx.$queryRaw<
      { last_value: bigint }[]
    >`SELECT last_value FROM public.equipment_reference_sequence`;
    const saved = await createEquipment({ name: 'After rollback', usesPower: false });
    expect(BigInt(saved.reference.slice(4))).toBeGreaterThan(failed.last_value);
  }));
test('failed related update rolls back Equipment fields and its timestamp', () =>
  fixture(async (tx) => {
    const original = await equipment(tx);
    const purchase = await tx.equipmentPurchase.create({
      data: { equipmentId: original.id, seller: 'Old' },
    });
    await failPurchaseWrites(tx);
    await expect(
      updateEquipment(original.id, {
        ...token(original),
        name: 'Must roll back',
        purchase: { seller: 'New' },
      }),
    ).rejects.toThrow();
    expect(await tx.equipment.findUnique({ where: { id: original.id } })).toEqual(original);
    expect(await tx.equipmentPurchase.findUnique({ where: { equipmentId: original.id } })).toEqual(
      purchase,
    );
  }));
test('archive and restore preserve all other data; repeated requests preserve original timestamps', () =>
  fixture(async (tx) => {
    const place = await location(tx);
    const original = await equipment(tx, {
      locationId: place.id,
      notes: 'History',
      usesPower: false,
    });
    const purchase = await tx.equipmentPurchase.create({
      data: { equipmentId: original.id, equipmentPriceMinor: 0 },
    });
    const sequenceBefore =
      await tx.$queryRaw`SELECT last_value, is_called FROM public.equipment_reference_sequence`;
    const archived = await archiveEquipment(original.id, token(original));
    expect(archived.changed).toBe(true);
    expect(archived.equipment.archivedAt).toBeInstanceOf(Date);
    expect(archived.equipment).toEqual({
      ...original,
      archivedAt: archived.equipment.archivedAt,
      updatedAt: archived.equipment.updatedAt,
    });
    expect(archived.equipment.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
    expect(await archiveEquipment(original.id, token(original))).toEqual({
      ...archived,
      changed: false,
    });
    expect(await getEquipmentById(original.id)).toMatchObject({
      ...archived.equipment,
      location: place,
      purchase,
    });
    expect((await getEquipmentList()).map((row) => row.id)).not.toContain(original.id);
    expect((await getArchivedEquipmentList()).map((row) => row.id)).toContain(original.id);
    const restored = await restoreEquipment(original.id, token(archived.equipment));
    expect(restored.equipment.archivedAt).toBeNull();
    expect(await restoreEquipment(original.id, token(original))).toEqual({
      ...restored,
      changed: false,
    });
    expect((await getEquipmentList()).map((row) => row.id)).toContain(original.id);
    expect((await getArchivedEquipmentList()).map((row) => row.id)).not.toContain(original.id);
    expect(await getEquipmentById(original.id)).toMatchObject({
      ...original,
      updatedAt: restored.equipment.updatedAt,
      location: place,
      purchase,
    });
    expect(
      await tx.$queryRaw`SELECT last_value, is_called FROM public.equipment_reference_sequence`,
    ).toEqual(sequenceBefore);
  }));
test('archive/restore reject stale tokens when the state would change', () =>
  fixture(async (tx) => {
    const original = await equipment(tx);
    const revised = await updateEquipment(original.id, { ...token(original), name: 'New' });
    await expect(archiveEquipment(original.id, token(original))).rejects.toMatchObject({
      code: 'STALE_UPDATE',
    });
    const archived = await archiveEquipment(original.id, token(revised));
    await expect(restoreEquipment(original.id, token(revised))).rejects.toMatchObject({
      code: 'STALE_UPDATE',
    });
    expect(await getEquipmentById(original.id)).toMatchObject(archived.equipment);
  }));
test('all mutations reject missing IDs; detail reads return null for missing or malformed IDs', () =>
  fixture(async () => {
    const id = randomUUID();
    const expectedUpdatedAt = '2026-08-31T00:00:00.000Z';
    for (const operation of [updateEquipment, archiveEquipment, restoreEquipment]) {
      await expect(operation(id, { expectedUpdatedAt })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
    expect(await getEquipmentById(id)).toBeNull();
    expect(await getEquipmentById('EQP-0001')).toBeNull();
  }));
test('active and archived queries use deterministic date then reference ordering', () =>
  fixture(async (tx) => {
    const suffix = randomUUID();
    const old = await equipment(tx, {
      reference: `old-${suffix}`,
      createdAt: new Date('2025-01-01'),
    });
    const b = await equipment(tx, { reference: `b-${suffix}`, createdAt: new Date('2026-01-01') });
    const a = await equipment(tx, { reference: `a-${suffix}`, createdAt: new Date('2026-01-01') });
    expect(
      (await getEquipmentList())
        .filter((row) => [a.id, b.id, old.id].includes(row.id))
        .map((row) => row.id),
    ).toEqual([a.id, b.id, old.id]);
    for (const row of [a, b])
      await tx.equipment.update({
        where: { id: row.id },
        data: { archivedAt: new Date('2026-02-01') },
      });
    await tx.equipment.update({
      where: { id: old.id },
      data: { archivedAt: new Date('2026-01-01') },
    });
    expect(
      (await getArchivedEquipmentList())
        .filter((row) => [a.id, b.id, old.id].includes(row.id))
        .map((row) => row.id),
    ).toEqual([a.id, b.id, old.id]);
  }));
test('Location options exclude archived Locations and label immediate parent information', () =>
  fixture(async (tx) => {
    const parent = await location(tx);
    const child = await tx.location.create({
      data: { name: `Shelf-${randomUUID()}`, parentLocationId: parent.id },
    });
    const archived = await location(tx, true);
    const options = await getEquipmentLocationOptions();
    expect(options).toContainEqual({ id: parent.id, label: parent.name });
    expect(options).toContainEqual({ id: child.id, label: `${parent.name} / ${child.name}` });
    expect(options.map((row) => row.id)).not.toContain(archived.id);
  }));

test('concurrent creations allocate distinct references; rolled back successful allocations are not reused', async () => {
  class FixtureResult extends Error {
    constructor(readonly record: EquipmentRecord) {
      super('Rollback concurrent fixture');
    }
  }
  let started = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transactionalCreate = async (
    operation: (tx: Prisma.TransactionClient) => Promise<EquipmentRecord>,
  ) => {
    try {
      return await realTransaction(
        async (tx) => {
          started += 1;
          if (started === 4) release();
          await ready;
          throw new FixtureResult(await operation(tx));
        },
        { timeout: 15000, maxWait: 5000 },
      );
    } catch (error) {
      if (error instanceof FixtureResult) return error.record;
      throw error;
    }
  };
  vi.spyOn(database, '$transaction').mockImplementation(
    transactionalCreate as typeof database.$transaction,
  );
  const created = await Promise.all(
    Array.from({ length: 4 }, () => createEquipment({ name: 'Concurrent', usesPower: true })),
  );
  expect(new Set(created.map((row) => row.reference)).size).toBe(4);
  expect(new Set(created.map((row) => row.id)).size).toBe(4);
  const next = await createEquipment({ name: 'After rollbacks', usesPower: false });
  expect(
    created.every((row) => BigInt(row.reference.slice(4)) < BigInt(next.reference.slice(4))),
  ).toBe(true);
});
