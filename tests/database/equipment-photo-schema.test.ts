import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import type { Equipment, EquipmentPhoto } from '../../src/generated/prisma/client';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';

const migrationName = '20260901000000_add_equipment_photos';
const connectionString = getTestDatabaseUrl();
const database = new Client({
  connectionString,
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
});
let baseline: unknown;
let sequences: unknown;

async function rowCounts() {
  return (
    await database.query(`SELECT
      (SELECT count(*)::int FROM "Equipment") AS equipment,
      (SELECT count(*)::int FROM "EquipmentPhoto") AS equipment_photos,
      (SELECT count(*)::int FROM "Plant") AS plants,
      (SELECT count(*)::int FROM "PlantPhoto") AS plant_photos,
      (SELECT count(*)::int FROM "EquipmentPowerPeriod") AS power_periods,
      (SELECT count(*)::int FROM "ElectricityTariff") AS tariffs,
      (SELECT count(*)::int FROM "Location") AS locations`)
  ).rows;
}

async function sequenceStates() {
  return (
    await database.query(`SELECT 'ANT' AS kind, last_value::text, is_called
      FROM public.plant_reference_sequence
      UNION ALL
      SELECT 'EQP' AS kind, last_value::text, is_called
      FROM public.equipment_reference_sequence
      ORDER BY kind`)
  ).rows;
}

beforeAll(async () => {
  await database.connect();
  const {
    rows: [target],
  } = await database.query<{ name: string }>('SELECT current_database() AS name');
  expect(target.name).toBe(decodeURIComponent(new URL(connectionString).pathname.slice(1)));
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
  await database.end();
});

async function insertEquipment() {
  return (
    await database.query<Equipment>(
      'INSERT INTO "Equipment" (id, reference, name, "usesPower", "updatedAt") VALUES ($1, $2, $3, false, CURRENT_TIMESTAMP) RETURNING *',
      [randomUUID(), `equipment-photo-${randomUUID()}`, 'Photo owner'],
    )
  ).rows[0];
}

async function insertPhoto(
  equipmentId: string,
  data: Partial<
    Pick<
      EquipmentPhoto,
      | 'storageKey'
      | 'isPrimary'
      | 'sortOrder'
      | 'cropX'
      | 'cropY'
      | 'cropSize'
      | 'derivativeRevision'
    >
  > = {},
) {
  return (
    await database.query<EquipmentPhoto>(
      `INSERT INTO "EquipmentPhoto"
        (id, "equipmentId", "storageKey", "isPrimary", "sortOrder", "cropX", "cropY", "cropSize", "derivativeRevision", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        randomUUID(),
        equipmentId,
        data.storageKey ?? `equipment-photo/${randomUUID()}`,
        data.isPrimary ?? false,
        data.sortOrder ?? 0,
        data.cropX ?? null,
        data.cropY ?? null,
        data.cropSize ?? null,
        data.derivativeRevision ?? null,
      ],
    )
  ).rows[0];
}

async function expectDatabaseFailure(
  operation: () => Promise<unknown>,
  expected: { code: string; constraint?: string; column?: string },
) {
  await database.query('SAVEPOINT expected_equipment_photo_failure');
  try {
    await expect(operation()).rejects.toMatchObject(expected);
  } finally {
    await database.query('ROLLBACK TO SAVEPOINT expected_equipment_photo_failure');
    await database.query('RELEASE SAVEPOINT expected_equipment_photo_failure');
  }
}

test('reviewed EquipmentPhoto migration is applied with its committed checksum', async () => {
  const sql = readFileSync(
    new URL(`../../prisma/migrations/${migrationName}/migration.sql`, import.meta.url),
    'utf8',
  );
  const checksums = [
    sql,
    sql.replaceAll('\r\n', '\n'),
    sql.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'),
  ].map((source) => createHash('sha256').update(source).digest('hex'));
  const { rows } = await database.query(
    'SELECT checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations" WHERE migration_name = $1',
    [migrationName],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ finished: true, rolled_back: false });
  expect(checksums).toContain(rows[0].checksum);
});

test('EquipmentPhoto has only the approved keys, indexes and restrictive Equipment FK', async () => {
  const { rows: indexes } = await database.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'EquipmentPhoto' ORDER BY indexname`,
  );
  expect(indexes.map(({ indexname }) => indexname)).toEqual([
    'EquipmentPhoto_equipmentId_sortOrder_idx',
    'EquipmentPhoto_one_primary_per_equipment_key',
    'EquipmentPhoto_pkey',
    'EquipmentPhoto_storageKey_key',
  ]);
  expect(
    indexes.find(({ indexname }) => indexname === 'EquipmentPhoto_one_primary_per_equipment_key')
      ?.indexdef,
  ).toContain('WHERE ("isPrimary" = true)');

  const { rows: foreignKeys } = await database.query(
    `SELECT conname, confdeltype, confupdtype, convalidated
     FROM pg_constraint
     WHERE contype = 'f' AND conrelid = 'public."EquipmentPhoto"'::regclass`,
  );
  expect(foreignKeys).toEqual([
    {
      conname: 'EquipmentPhoto_equipmentId_fkey',
      confdeltype: 'r',
      confupdtype: 'r',
      convalidated: true,
    },
  ]);

  const { rows: checks } = await database.query(
    `SELECT conname, convalidated FROM pg_constraint
     WHERE contype = 'c' AND conrelid = 'public."EquipmentPhoto"'::regclass ORDER BY conname`,
  );
  expect(checks).toEqual([
    { conname: 'EquipmentPhoto_crop_consistency_check', convalidated: true },
    { conname: 'EquipmentPhoto_crop_ranges_check', convalidated: true },
  ]);
});

test('EquipmentPhoto columns use the approved PostgreSQL types, nullability and defaults', async () => {
  const { rows } = await database.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
    datetime_precision: number | null;
  }>(
    `SELECT column_name, data_type, is_nullable, column_default, datetime_precision
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'EquipmentPhoto'
     ORDER BY ordinal_position`,
  );
  expect(rows.map(({ column_name }) => column_name)).toEqual([
    'id',
    'equipmentId',
    'storageKey',
    'originalFilename',
    'caption',
    'takenAt',
    'isPrimary',
    'sortOrder',
    'cropX',
    'cropY',
    'cropSize',
    'derivativeRevision',
    'createdAt',
    'updatedAt',
  ]);
  const field = (name: string) => rows.find(({ column_name }) => column_name === name)!;
  expect(
    rows.filter(({ is_nullable }) => is_nullable === 'NO').map(({ column_name }) => column_name),
  ).toEqual([
    'id',
    'equipmentId',
    'storageKey',
    'isPrimary',
    'sortOrder',
    'createdAt',
    'updatedAt',
  ]);
  for (const name of ['id', 'equipmentId', 'derivativeRevision'])
    expect(field(name)).toMatchObject({ data_type: 'uuid' });
  for (const name of ['cropX', 'cropY', 'cropSize'])
    expect(field(name)).toMatchObject({ data_type: 'double precision', column_default: null });
  expect(field('isPrimary')).toMatchObject({
    data_type: 'boolean',
    column_default: 'false',
  });
  expect(field('sortOrder')).toMatchObject({ data_type: 'integer', column_default: '0' });
  expect(field('createdAt')).toMatchObject({
    data_type: 'timestamp with time zone',
    datetime_precision: 3,
    column_default: 'CURRENT_TIMESTAMP',
  });
  expect(field('updatedAt')).toMatchObject({
    data_type: 'timestamp with time zone',
    datetime_precision: 3,
    column_default: null,
  });
  expect(field('takenAt')).toMatchObject({
    data_type: 'timestamp with time zone',
    datetime_precision: 3,
    column_default: null,
  });
});

test('Equipment owns multiple photos and default ordering/primary values are applied', async () => {
  const equipment = await insertEquipment();
  const first = (
    await database.query<EquipmentPhoto>(
      `INSERT INTO "EquipmentPhoto" (id, "equipmentId", "storageKey", "updatedAt")
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING *`,
      [randomUUID(), equipment.id, `equipment-photo/${randomUUID()}`],
    )
  ).rows[0];
  const second = await insertPhoto(equipment.id);
  expect(first).toMatchObject({ equipmentId: equipment.id, isPrimary: false, sortOrder: 0 });
  expect(second).toMatchObject({ equipmentId: equipment.id, isPrimary: false, sortOrder: 0 });
  expect(first.id).not.toBe(second.id);
});

test('Equipment ownership is required and missing Equipment is rejected', async () => {
  await expectDatabaseFailure(
    () =>
      database.query(
        'INSERT INTO "EquipmentPhoto" (id, "equipmentId", "storageKey", "updatedAt") VALUES ($1, NULL, $2, CURRENT_TIMESTAMP)',
        [randomUUID(), `equipment-photo/${randomUUID()}`],
      ),
    { code: '23502', column: 'equipmentId' },
  );
  await expectDatabaseFailure(() => insertPhoto(randomUUID()), {
    code: '23503',
    constraint: 'EquipmentPhoto_equipmentId_fkey',
  });
});

test('storageKey is unique across all Equipment photos', async () => {
  const firstOwner = await insertEquipment();
  const secondOwner = await insertEquipment();
  const storageKey = `equipment-photo/${randomUUID()}`;
  await insertPhoto(firstOwner.id, { storageKey });
  await expectDatabaseFailure(() => insertPhoto(secondOwner.id, { storageKey }), {
    code: '23505',
    constraint: 'EquipmentPhoto_storageKey_key',
  });
});

test('zero or one primary per Equipment is allowed while non-primary photos remain unrestricted', async () => {
  const firstOwner = await insertEquipment();
  const secondOwner = await insertEquipment();
  await insertPhoto(firstOwner.id);
  await insertPhoto(firstOwner.id);
  await insertPhoto(firstOwner.id, { isPrimary: true });
  await insertPhoto(secondOwner.id, { isPrimary: true });
  await insertPhoto(secondOwner.id);
  await expectDatabaseFailure(() => insertPhoto(firstOwner.id, { isPrimary: true }), {
    code: '23505',
    constraint: 'EquipmentPhoto_one_primary_per_equipment_key',
  });
  expect(
    (
      await database.query(
        'SELECT "equipmentId", count(*)::int AS count FROM "EquipmentPhoto" WHERE "isPrimary" = true GROUP BY "equipmentId" ORDER BY "equipmentId"',
      )
    ).rows,
  ).toEqual(
    [firstOwner.id, secondOwner.id].sort().map((equipmentId) => ({ equipmentId, count: 1 })),
  );
});

test('all-null and fully populated crop metadata are accepted at their valid boundaries', async () => {
  const equipment = await insertEquipment();
  expect(await insertPhoto(equipment.id)).toMatchObject({
    cropX: null,
    cropY: null,
    cropSize: null,
    derivativeRevision: null,
  });
  const lower = await insertPhoto(equipment.id, {
    cropX: 0,
    cropY: 0,
    cropSize: Number.MIN_VALUE,
    derivativeRevision: randomUUID(),
  });
  expect(lower.cropX).toBe(0);
  expect(lower.cropY).toBe(0);
  expect(lower.cropSize).toBeGreaterThan(0);
  const upper = await insertPhoto(equipment.id, {
    cropX: 1 - Number.EPSILON,
    cropY: 1 - Number.EPSILON,
    cropSize: 1,
    derivativeRevision: randomUUID(),
  });
  expect(upper.cropX).toBeLessThan(1);
  expect(upper.cropY).toBeLessThan(1);
  expect(upper.cropSize).toBe(1);
});

test('every partial crop metadata combination is rejected', async () => {
  const equipment = await insertEquipment();
  const fields = ['cropX', 'cropY', 'cropSize', 'derivativeRevision'] as const;
  for (let mask = 1; mask < 15; mask++) {
    const data = Object.fromEntries(
      fields
        .filter((_, index) => mask & (1 << index))
        .map((field) => [
          field,
          field === 'derivativeRevision' ? randomUUID() : field === 'cropSize' ? 1 : 0,
        ]),
    );
    await expectDatabaseFailure(() => insertPhoto(equipment.id, data), {
      code: '23514',
      constraint: 'EquipmentPhoto_crop_consistency_check',
    });
  }
});

test.each([
  ['cropX', '-0.1'],
  ['cropX', '1'],
  ['cropY', '-0.1'],
  ['cropY', '1'],
  ['cropSize', '0'],
  ['cropSize', '1.01'],
  ...['cropX', 'cropY', 'cropSize'].flatMap((field) =>
    ['NaN', 'Infinity', '-Infinity'].map((value) => [field, value]),
  ),
])('crop range rejects %s = %s', async (field, value) => {
  const equipment = await insertEquipment();
  const photo = await insertPhoto(equipment.id, {
    cropX: 0,
    cropY: 0,
    cropSize: 1,
    derivativeRevision: randomUUID(),
  });
  await expectDatabaseFailure(
    () =>
      database.query(
        `UPDATE "EquipmentPhoto" SET "${field}" = $1::double precision WHERE id = $2::uuid`,
        [value, photo.id],
      ),
    { code: '23514', constraint: 'EquipmentPhoto_crop_ranges_check' },
  );
});

test('Equipment cannot be deleted while its photos exist', async () => {
  const equipment = await insertEquipment();
  await insertPhoto(equipment.id);
  await expectDatabaseFailure(
    () => database.query('DELETE FROM "Equipment" WHERE id = $1', [equipment.id]),
    { code: '23001', constraint: 'EquipmentPhoto_equipmentId_fkey' },
  );
  expect(
    (
      await database.query(
        'SELECT count(*)::int AS count FROM "EquipmentPhoto" WHERE "equipmentId" = $1',
        [equipment.id],
      )
    ).rows,
  ).toEqual([{ count: 1 }]);
});
