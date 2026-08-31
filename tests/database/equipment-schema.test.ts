import 'dotenv/config';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import {
  PrismaClient,
  type Equipment,
  type EquipmentPurchase,
  type Location,
} from '../../src/generated/prisma/client';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';

const connectionString = getTestDatabaseUrl();
const database = new Client({
  connectionString,
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
});
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 5000 }),
});
let baseline: unknown;
let sequences: unknown;

async function rowCounts() {
  return (
    await database.query(`SELECT
    (SELECT count(*)::int FROM "Equipment") AS equipment,
    (SELECT count(*)::int FROM "EquipmentPurchase") AS purchases,
    (SELECT count(*)::int FROM "Plant") AS plants,
    (SELECT count(*)::int FROM "Location") AS locations`)
  ).rows;
}
async function sequenceStates() {
  // Read only: this schema checkpoint must not allocate either reference.
  return (
    await database.query(`SELECT 'ANT' AS kind, last_value::text, is_called FROM public.plant_reference_sequence
    UNION ALL SELECT 'EQP' AS kind, last_value::text, is_called FROM public.equipment_reference_sequence ORDER BY kind`)
  ).rows;
}
beforeAll(async () => {
  await database.connect();
  const {
    rows: [target],
  } = await database.query<{ name: string; version: number }>(
    "SELECT current_database() AS name, current_setting('server_version_num')::int AS version",
  );
  expect(target.name).toBe(decodeURIComponent(new URL(connectionString).pathname.slice(1)));
  expect(target.version).toBeGreaterThanOrEqual(180000);
  expect(target.version).toBeLessThan(190000);
  await database.query("SET search_path TO public; SET TIME ZONE 'UTC'");
  baseline = await rowCounts();
  sequences = await sequenceStates();
});
beforeEach(async () => {
  await database.query('BEGIN');
});
afterEach(async () => {
  await database.query('ROLLBACK');
  expect(await rowCounts()).toEqual(baseline);
  expect(await sequenceStates()).toEqual(sequences);
});
afterAll(async () => {
  await prisma.$disconnect();
  await database.end();
});

async function insertEquipment(
  usesPower = false,
  locationId: string | null = null,
  reference = `test-equipment-${randomUUID()}`,
) {
  return (
    await database.query<Equipment>(
      'INSERT INTO "Equipment" (id, reference, name, "usesPower", "locationId", "updatedAt") VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) RETURNING *',
      [randomUUID(), reference, 'Individual equipment fixture', usesPower, locationId],
    )
  ).rows[0];
}
async function insertLocation(parentLocationId: string | null = null) {
  return (
    await database.query<Location>(
      'INSERT INTO "Location" (id, name, "parentLocationId", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING *',
      [randomUUID(), `equipment-test-location-${randomUUID()}`, parentLocationId],
    )
  ).rows[0];
}
const costFields = ['equipmentPriceMinor', 'shippingCostMinor', 'otherCostMinor'] as const;
type Costs = Pick<EquipmentPurchase, (typeof costFields)[number]>;
async function insertPurchase(equipmentId: string, costs: Partial<Costs> = {}) {
  return (
    await database.query<EquipmentPurchase>(
      'INSERT INTO "EquipmentPurchase" (id, "equipmentId", "equipmentPriceMinor", "shippingCostMinor", "otherCostMinor", "updatedAt") VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) RETURNING *',
      [
        randomUUID(),
        equipmentId,
        costs.equipmentPriceMinor ?? null,
        costs.shippingCostMinor ?? null,
        costs.otherCostMinor ?? null,
      ],
    )
  ).rows[0];
}

test('both reviewed Equipment migrations are applied with matching SQL checksums', async () => {
  for (const name of [
    '20260831233000_init_equipment_inventory',
    '20260831233100_add_equipment_reference_sequence',
  ]) {
    const sql = readFileSync(
      new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url),
      'utf8',
    );
    const checksums = [
      sql,
      sql.replaceAll('\r\n', '\n'),
      sql.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'),
    ].map((source) => createHash('sha256').update(source).digest('hex'));
    const { rows } = await database.query(
      'SELECT checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations" WHERE migration_name = $1',
      [name],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ finished: true, rolled_back: false });
    expect(checksums).toContain(rows[0].checksum);
  }
});

test('columns have the approved database types, nullability and defaults only', async () => {
  const { rows } = await database.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
    datetime_precision: number | null;
    character_maximum_length: number | null;
  }>(
    `SELECT table_name, column_name, data_type, is_nullable, column_default, datetime_precision, character_maximum_length
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('Equipment', 'EquipmentPurchase') ORDER BY table_name, ordinal_position`,
  );
  const equipment = rows.filter((column) => column.table_name === 'Equipment');
  const purchase = rows.filter((column) => column.table_name === 'EquipmentPurchase');
  expect(equipment.map((column) => column.column_name)).toEqual([
    'id',
    'reference',
    'name',
    'category',
    'brand',
    'model',
    'serialNumber',
    'notes',
    'usesPower',
    'locationId',
    'archivedAt',
    'createdAt',
    'updatedAt',
  ]);
  expect(purchase.map((column) => column.column_name)).toEqual([
    'id',
    'equipmentId',
    'seller',
    'orderReference',
    'purchaseDate',
    ...costFields,
    'currency',
    'createdAt',
    'updatedAt',
  ]);
  expect(
    equipment.filter((column) => column.is_nullable === 'NO').map((column) => column.column_name),
  ).toEqual(['id', 'reference', 'name', 'category', 'usesPower', 'createdAt', 'updatedAt']);
  expect(
    purchase.filter((column) => column.is_nullable === 'NO').map((column) => column.column_name),
  ).toEqual(['id', 'equipmentId', 'currency', 'createdAt', 'updatedAt']);
  const field = (table: string, name: string) =>
    rows.find((column) => column.table_name === table && column.column_name === name)!;
  expect(field('Equipment', 'usesPower')).toMatchObject({
    data_type: 'boolean',
    column_default: null,
  });
  expect(field('Equipment', 'reference')).toMatchObject({
    data_type: 'text',
    column_default: null,
  });
  expect(field('Equipment', 'category')).toMatchObject({
    data_type: 'text',
    column_default: "'Other'::text",
  });
  expect(field('EquipmentPurchase', 'purchaseDate')).toMatchObject({ data_type: 'date' });
  expect(field('EquipmentPurchase', 'currency')).toMatchObject({
    data_type: 'character varying',
    character_maximum_length: 3,
    column_default: "'GBP'::character varying",
  });
  for (const cost of costFields)
    expect(field('EquipmentPurchase', cost)).toMatchObject({
      data_type: 'integer',
      column_default: null,
    });
  for (const [table, names] of [
    ['Equipment', ['id', 'locationId']],
    ['EquipmentPurchase', ['id', 'equipmentId']],
  ] as const)
    for (const name of names)
      expect(field(table, name)).toMatchObject({ data_type: 'uuid', column_default: null });
  for (const column of rows.filter((column) =>
    ['createdAt', 'updatedAt', 'archivedAt'].includes(column.column_name),
  )) {
    expect(column).toMatchObject({ data_type: 'timestamp with time zone', datetime_precision: 3 });
    expect(column.column_default).toBe(
      column.column_name === 'createdAt' ? 'CURRENT_TIMESTAMP' : null,
    );
  }
});

test('only the approved keys/indexes exist and both foreign keys restrict delete and update', async () => {
  const { rows: indexes } = await database.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('Equipment', 'EquipmentPurchase') ORDER BY indexname`,
  );
  expect(indexes.map((index) => index.indexname)).toEqual([
    'EquipmentPurchase_equipmentId_key',
    'EquipmentPurchase_pkey',
    'Equipment_locationId_idx',
    'Equipment_pkey',
    'Equipment_reference_key',
  ]);
  const { rows: keys } =
    await database.query(`SELECT conname, confdeltype, confupdtype, convalidated FROM pg_constraint
    WHERE contype = 'f' AND conrelid IN ('public."Equipment"'::regclass, 'public."EquipmentPurchase"'::regclass) ORDER BY conname`);
  expect(keys).toEqual([
    {
      conname: 'EquipmentPurchase_equipmentId_fkey',
      confdeltype: 'r',
      confupdtype: 'r',
      convalidated: true,
    },
    {
      conname: 'Equipment_locationId_fkey',
      confdeltype: 'r',
      confupdtype: 'r',
      convalidated: true,
    },
  ]);
  const { rows: checks } = await database.query(
    `SELECT conname, convalidated FROM pg_constraint WHERE contype = 'c' AND conrelid = 'public."EquipmentPurchase"'::regclass ORDER BY conname`,
  );
  expect(checks).toEqual(
    costFields
      .map((name) => ({ conname: `EquipmentPurchase_${name}_nonnegative`, convalidated: true }))
      .sort((a, b) => a.conname.localeCompare(b.conname)),
  );
});

test('EQP sequence is independent BIGINT infrastructure with no column ownership or allocation', async () => {
  const { rows } =
    await database.query(`SELECT seqtypid::regtype::text AS type, seqstart::text, seqincrement::text, seqmin::text, seqmax::text, seqcache::text, seqcycle
    FROM pg_sequence WHERE seqrelid = 'public.equipment_reference_sequence'::regclass`);
  expect(rows).toEqual([
    {
      type: 'bigint',
      seqstart: '1',
      seqincrement: '1',
      seqmin: '1',
      seqmax: '9223372036854775807',
      seqcache: '1',
      seqcycle: false,
    },
  ]);
  const { rows: ownership } =
    await database.query(`SELECT 1 FROM pg_depend WHERE classid = 'pg_class'::regclass
    AND objid = 'public.equipment_reference_sequence'::regclass AND deptype IN ('a', 'i')`);
  expect(ownership).toEqual([]);
  expect(
    (
      await database.query(
        `SELECT 'public.equipment_reference_sequence'::regclass <> 'public.plant_reference_sequence'::regclass AS independent`,
      )
    ).rows,
  ).toEqual([{ independent: true }]);
  expect(
    (
      await database.query(
        `SELECT relpersistence FROM pg_class WHERE oid = 'public.equipment_reference_sequence'::regclass`,
      )
    ).rows,
  ).toEqual([{ relpersistence: 'p' }]);
});

test.each([false, true])(
  'minimal Equipment supports usesPower %s without optional groups',
  async (usesPower) => {
    const equipment = await insertEquipment(usesPower);
    expect(equipment).toMatchObject({
      category: 'Other',
      usesPower,
      brand: null,
      model: null,
      serialNumber: null,
      notes: null,
      locationId: null,
      archivedAt: null,
    });
    expect(equipment.createdAt).toBeInstanceOf(Date);
    expect(equipment.updatedAt).toBeInstanceOf(Date);
    expect(
      (
        await database.query('SELECT * FROM "EquipmentPurchase" WHERE "equipmentId" = $1', [
          equipment.id,
        ])
      ).rows,
    ).toEqual([]);
  },
);

test.each(['name', 'usesPower', 'reference'] as const)(
  'requires %s without silently inventing it',
  async (field) => {
    const equipment = await insertEquipment();
    await expect(
      database.query(`UPDATE "Equipment" SET "${field}" = NULL WHERE id = $1`, [equipment.id]),
    ).rejects.toMatchObject({ code: '23502', column: field });
  },
);
test('omitting usesPower on insert is rejected because there is no default', async () => {
  await expect(
    database.query(
      'INSERT INTO "Equipment" (id, reference, name, "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
      [randomUUID(), `test-${randomUUID()}`, 'Unknown power capability'],
    ),
  ).rejects.toMatchObject({ code: '23502', column: 'usesPower' });
});
test('distinct physical items may share name, brand, model, serial and a custom category', async () => {
  const first = await insertEquipment(true);
  const second = await insertEquipment(true);
  const result = await database.query(
    'UPDATE "Equipment" SET brand = $1, model = $2, "serialNumber" = $3, category = $4 WHERE id = ANY($5::uuid[]) RETURNING *',
    [
      'Fixture brand',
      'Same model',
      'Not globally unique',
      'Custom drying rack',
      [first.id, second.id],
    ],
  );
  expect(result.rows).toHaveLength(2);
  expect(first.id).not.toBe(second.id);
  expect(first.reference).not.toBe(second.reference);
});
test('duplicate references remain rejected even when the original item is archived', async () => {
  const equipment = await insertEquipment();
  await database.query('UPDATE "Equipment" SET "archivedAt" = CURRENT_TIMESTAMP WHERE id = $1', [
    equipment.id,
  ]);
  await expect(insertEquipment(false, null, equipment.reference)).rejects.toMatchObject({
    code: '23505',
    constraint: 'Equipment_reference_key',
  });
});
test('each Equipment has at most one purchase', async () => {
  const equipment = await insertEquipment();
  await insertPurchase(equipment.id);
  await expect(insertPurchase(equipment.id)).rejects.toMatchObject({
    code: '23505',
    constraint: 'EquipmentPurchase_equipmentId_key',
  });
});
test.each([null, 0, 12550, 2_147_483_647])(
  'all purchase costs accept %s distinctly',
  async (value) => {
    const equipment = await insertEquipment();
    const purchase = await insertPurchase(equipment.id, {
      equipmentPriceMinor: value,
      shippingCostMinor: value,
      otherCostMinor: value,
    });
    expect(purchase).toMatchObject({
      equipmentPriceMinor: value,
      shippingCostMinor: value,
      otherCostMinor: value,
      currency: 'GBP',
      seller: null,
      orderReference: null,
      purchaseDate: null,
    });
  },
);
test.each(costFields)('negative %s is rejected on insert', async (field) => {
  const equipment = await insertEquipment();
  await expect(insertPurchase(equipment.id, { [field]: -1 })).rejects.toMatchObject({
    code: '23514',
    constraint: `EquipmentPurchase_${field}_nonnegative`,
  });
});
test.each(costFields)('negative %s is rejected on update', async (field) => {
  const equipment = await insertEquipment();
  const purchase = await insertPurchase(equipment.id);
  await expect(
    database.query(`UPDATE "EquipmentPurchase" SET "${field}" = -1 WHERE id = $1`, [purchase.id]),
  ).rejects.toMatchObject({ code: '23514', constraint: `EquipmentPurchase_${field}_nonnegative` });
});
test.each(costFields)('%s rejects integer overflow', async (field) => {
  const equipment = await insertEquipment();
  await expect(insertPurchase(equipment.id, { [field]: 2_147_483_648 })).rejects.toMatchObject({
    code: '22003',
  });
});
test('calendar purchase dates, non GBP currency and repeated order references are supported', async () => {
  const first = await insertEquipment();
  const second = await insertEquipment();
  const firstPurchase = await insertPurchase(first.id, { shippingCostMinor: 250 });
  const secondPurchase = await insertPurchase(second.id, { shippingCostMinor: 750 });
  await database.query(
    'UPDATE "EquipmentPurchase" SET "orderReference" = $1, "purchaseDate" = $2, currency = $3 WHERE id = ANY($4::uuid[])',
    ['SHARED-ORDER', '2026-08-13', 'EUR', [firstPurchase.id, secondPurchase.id]],
  );
  await database.query("SET LOCAL TIME ZONE 'Pacific/Auckland'");
  expect(
    (
      await database.query(
        'SELECT "purchaseDate"::text AS date, currency, "shippingCostMinor" AS shipping FROM "EquipmentPurchase" WHERE id = ANY($1::uuid[]) ORDER BY "shippingCostMinor"',
        [[firstPurchase.id, secondPurchase.id]],
      )
    ).rows,
  ).toEqual([
    { date: '2026-08-13', currency: 'EUR', shipping: 250 },
    { date: '2026-08-13', currency: 'EUR', shipping: 750 },
  ]);
});
test('currency storage is limited to three characters', async () => {
  const equipment = await insertEquipment();
  const purchase = await insertPurchase(equipment.id);
  await expect(
    database.query('UPDATE "EquipmentPurchase" SET currency = $1 WHERE id = $2', [
      'GBPX',
      purchase.id,
    ]),
  ).rejects.toMatchObject({ code: '22001' });
});
test('impossible calendar dates are rejected', async () => {
  const equipment = await insertEquipment();
  const purchase = await insertPurchase(equipment.id);
  await expect(
    database.query('UPDATE "EquipmentPurchase" SET "purchaseDate" = $1 WHERE id = $2', [
      '2026-02-30',
      purchase.id,
    ]),
  ).rejects.toMatchObject({ code: '22008' });
});
test('Plants and several Equipment items reuse the same existing Location hierarchy', async () => {
  const root = await insertLocation();
  const shelf = await insertLocation(root.id);
  const first = await insertEquipment(false, shelf.id);
  const second = await insertEquipment(true, shelf.id);
  const plantId = randomUUID();
  await database.query(
    'INSERT INTO "Plant" (id, reference, "locationId", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
    [plantId, `equipment-location-test-${randomUUID()}`, shelf.id],
  );
  expect(first.locationId).toBe(shelf.id);
  expect(second.locationId).toBe(shelf.id);
  expect(
    (await database.query('SELECT "locationId" FROM "Plant" WHERE id = $1', [plantId])).rows,
  ).toEqual([{ locationId: shelf.id }]);
  expect(
    (await database.query('SELECT "parentLocationId" FROM "Location" WHERE id = $1', [shelf.id]))
      .rows,
  ).toEqual([{ parentLocationId: root.id }]);
});
test('archive fields preserve purchase and Location references without cascade or power changes', async () => {
  const location = await insertLocation();
  const equipment = await insertEquipment(true, location.id);
  const purchase = await insertPurchase(equipment.id, { equipmentPriceMinor: 0 });
  await database.query('UPDATE "Equipment" SET "archivedAt" = CURRENT_TIMESTAMP WHERE id = $1', [
    equipment.id,
  ]);
  await database.query('UPDATE "Location" SET "archivedAt" = CURRENT_TIMESTAMP WHERE id = $1', [
    location.id,
  ]);
  const archived = (
    await database.query<Equipment>('SELECT * FROM "Equipment" WHERE id = $1', [equipment.id])
  ).rows[0];
  expect(archived.archivedAt).toBeInstanceOf(Date);
  expect({ ...archived, archivedAt: null }).toEqual(equipment);
  expect(
    (await database.query('SELECT * FROM "EquipmentPurchase" WHERE id = $1', [purchase.id]))
      .rows[0],
  ).toEqual(purchase);
  await database.query('UPDATE "Equipment" SET "archivedAt" = NULL WHERE id = $1', [equipment.id]);
  expect(
    (await database.query('SELECT * FROM "Equipment" WHERE id = $1', [equipment.id])).rows[0],
  ).toEqual(equipment);
});
test('missing Location is rejected', async () => {
  await expect(insertEquipment(true, randomUUID())).rejects.toMatchObject({
    code: '23503',
    constraint: 'Equipment_locationId_fkey',
  });
});
test('a purchase cannot reference missing Equipment', async () => {
  await expect(insertPurchase(randomUUID())).rejects.toMatchObject({
    code: '23503',
    constraint: 'EquipmentPurchase_equipmentId_fkey',
  });
});
test.each(['delete', 'update'] as const)(
  'restricts %s of a referenced Location',
  async (operation) => {
    const location = await insertLocation();
    await insertEquipment(false, location.id);
    await expect(
      database.query(
        operation === 'delete'
          ? 'DELETE FROM "Location" WHERE id = $1'
          : 'UPDATE "Location" SET id = $2 WHERE id = $1',
        operation === 'delete' ? [location.id] : [location.id, randomUUID()],
      ),
    ).rejects.toMatchObject({
      code: '23001',
      constraint: 'Equipment_locationId_fkey',
    });
  },
);
test.each(['delete', 'update'] as const)(
  'restricts %s of Equipment referenced by its purchase',
  async (operation) => {
    const equipment = await insertEquipment();
    await insertPurchase(equipment.id);
    await expect(
      database.query(
        operation === 'delete'
          ? 'DELETE FROM "Equipment" WHERE id = $1'
          : 'UPDATE "Equipment" SET id = $2 WHERE id = $1',
        operation === 'delete' ? [equipment.id] : [equipment.id, randomUUID()],
      ),
    ).rejects.toMatchObject({
      code: '23001',
      constraint: 'EquipmentPurchase_equipmentId_fkey',
    });
  },
);

test('generated Prisma models supply UUIDs/timestamps and read both Location directions', async () => {
  const rollback = new Error('Roll back generated client fixture');
  await expect(
    prisma.$transaction(async (tx) => {
      const equipment = await tx.equipment.create({
        data: {
          reference: `test-prisma-equipment-${randomUUID()}`,
          name: 'Prisma schema fixture',
          usesPower: false,
          location: { create: { name: `equipment-prisma-location-${randomUUID()}` } },
          purchase: { create: { equipmentPriceMinor: 0 } },
        },
        include: { location: true, purchase: true },
      });
      expect(equipment.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(equipment.createdAt).toBeInstanceOf(Date);
      expect(equipment.updatedAt).toBeInstanceOf(Date);
      expect(equipment.purchase?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(equipment.purchase?.currency).toBe('GBP');
      expect(equipment.category).toBe('Other');
      const location = await tx.location.findUniqueOrThrow({
        where: { id: equipment.locationId! },
        include: { equipment: true, plants: true },
      });
      expect(location.equipment.map((item) => item.id)).toEqual([equipment.id]);
      expect(location.plants).toEqual([]);
      expect(
        await tx.equipmentPurchase.findUnique({ where: { equipmentId: equipment.id } }),
      ).toEqual(equipment.purchase);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});
