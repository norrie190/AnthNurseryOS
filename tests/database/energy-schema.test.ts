import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';

const connectionString = getTestDatabaseUrl();
const database = new Client({
  connectionString,
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
});
type Table = 'EquipmentPowerPeriod' | 'ElectricityTariff';
const tables: Table[] = ['EquipmentPowerPeriod', 'ElectricityTariff'];
let equipmentId: string;
let baseline: unknown;

async function snapshot() {
  const counts = (
    await database.query(`SELECT
    (SELECT count(*)::int FROM "EquipmentPowerPeriod") AS periods,
    (SELECT count(*)::int FROM "ElectricityTariff") AS tariffs,
    (SELECT count(*)::int FROM "Equipment") AS equipment,
    (SELECT count(*)::int FROM "Plant") AS plants`)
  ).rows;
  const sequences = (
    await database.query(`SELECT 'ANT' AS kind, last_value::text, is_called FROM public.plant_reference_sequence
    UNION ALL SELECT 'EQP', last_value::text, is_called FROM public.equipment_reference_sequence ORDER BY kind`)
  ).rows;
  return { counts, sequences };
}

beforeAll(async () => {
  await database.connect();
  const {
    rows: [target],
  } = await database.query(
    "SELECT current_database() AS name, current_setting('server_version_num')::int AS version",
  );
  expect(target.name).toBe(decodeURIComponent(new URL(connectionString).pathname.slice(1)));
  expect(target.version).toBeGreaterThanOrEqual(180000);
  expect(target.version).toBeLessThan(190000);
  await database.query("SET search_path TO public; SET TIME ZONE 'UTC'");
  baseline = await snapshot();
});
beforeEach(async () => {
  await database.query('BEGIN');
  equipmentId = randomUUID();
  await database.query(
    'INSERT INTO "Equipment" (id, reference, name, "usesPower", "updatedAt") VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP)',
    [equipmentId, `energy-schema-${randomUUID()}`, 'Energy schema fixture'],
  );
});
afterEach(async () => {
  await database.query('ROLLBACK');
  expect(await snapshot()).toEqual(baseline);
});
afterAll(async () => {
  await database.end();
});

type PeriodInput = {
  equipmentId?: string;
  from?: string;
  to?: string | null;
  power?: string;
  hours?: string;
  rate?: string;
  currency?: string;
  voided?: boolean;
  reason?: string | null;
};

async function insert(table: Table, input: PeriodInput = {}) {
  const id = randomUUID();
  const common = [
    id,
    input.from ?? '2026-09-01',
    input.to === undefined ? '2026-10-01' : input.to,
    input.voided ? new Date() : null,
    input.reason ?? null,
  ];
  if (table === 'EquipmentPowerPeriod') {
    await database.query(
      `INSERT INTO "EquipmentPowerPeriod"
      (id, "effectiveFrom", "effectiveTo", "voidedAt", "correctionReason", "equipmentId", "powerWatts", "hoursPerDay", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
      [...common, input.equipmentId ?? equipmentId, input.power ?? '65.75', input.hours ?? '12.50'],
    );
  } else {
    await database.query(
      `INSERT INTO "ElectricityTariff"
      (id, "effectiveFrom", "effectiveTo", "voidedAt", "correctionReason", "unitRateMinorPerKwh", currency, "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
      [...common, input.rate ?? '24.56789', input.currency ?? 'GBP'],
    );
  }
  return id;
}

async function rejects(operation: () => Promise<unknown>, code: string, constraint?: string) {
  await database.query('SAVEPOINT rejected_write');
  try {
    await expect(operation()).rejects.toMatchObject({
      code,
      ...(constraint ? { constraint } : {}),
    });
  } finally {
    await database.query('ROLLBACK TO SAVEPOINT rejected_write');
    await database.query('RELEASE SAVEPOINT rejected_write');
  }
}

test('reviewed migration checksum, extension, indexes and FK are installed', async () => {
  const name = '20260831235000_add_equipment_energy_history';
  const sql = readFileSync(
    new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url),
    'utf8',
  );
  const checksums = [
    sql,
    sql.replaceAll('\r\n', '\n'),
    sql.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'),
  ].map((value) => createHash('sha256').update(value).digest('hex'));
  const {
    rows: [migration],
  } = await database.query(
    'SELECT checksum, finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name = $1',
    [name],
  );
  expect(checksums).toContain(migration.checksum);
  expect(migration.finished_at).not.toBeNull();
  expect(migration.rolled_back_at).toBeNull();
  expect(
    (await database.query("SELECT extname FROM pg_extension WHERE extname = 'btree_gist'")).rows,
  ).toHaveLength(1);
  const indexes = (
    await database.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY indexname",
      [tables],
    )
  ).rows.map((row) => row.indexname);
  expect(indexes).toEqual([
    'ElectricityTariff_no_overlap',
    'ElectricityTariff_pkey',
    'EquipmentPowerPeriod_equipmentId_effectiveFrom_idx',
    'EquipmentPowerPeriod_no_overlap',
    'EquipmentPowerPeriod_pkey',
  ]);
  const {
    rows: [fk],
  } = await database.query(
    "SELECT confdeltype, confupdtype FROM pg_constraint WHERE conname = 'EquipmentPowerPeriod_equipmentId_fkey'",
  );
  expect(fk).toEqual({ confdeltype: 'r', confupdtype: 'r' });
  expect(
    (
      await database.query(
        "SELECT conname FROM pg_constraint WHERE conrelid = '\"ElectricityTariff\"'::regclass AND contype = 'f'",
      )
    ).rows,
  ).toEqual([]);
  for (const table of tables) {
    const {
      rows: [exclusion],
    } = await database.query(
      'SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = $1',
      [`${table}_no_overlap`],
    );
    expect(exclusion.definition).toContain(
      'daterange("effectiveFrom", "effectiveTo", \'[)\'::text) WITH &&',
    );
    expect(exclusion.definition).toContain('"voidedAt" IS NULL');
  }
});

test('approved precision, dates, text fields and nullable metadata are represented', async () => {
  const { rows } = await database.query(
    `SELECT table_name, column_name, data_type, numeric_precision, numeric_scale, is_nullable, column_default, datetime_precision
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [tables],
  );
  for (const [table, field, precision, scale] of [
    ['EquipmentPowerPeriod', 'powerWatts', 8, 2],
    ['EquipmentPowerPeriod', 'hoursPerDay', 4, 2],
    ['ElectricityTariff', 'unitRateMinorPerKwh', 9, 5],
  ] as const) {
    expect(rows.find((row) => row.table_name === table && row.column_name === field)).toMatchObject(
      {
        data_type: 'numeric',
        numeric_precision: precision,
        numeric_scale: scale,
        is_nullable: 'NO',
        column_default: null,
      },
    );
  }
  for (const table of tables) {
    const column = (name: string) =>
      rows.find((row) => row.table_name === table && row.column_name === name);
    expect(column('id')).toMatchObject({
      data_type: 'uuid',
      is_nullable: 'NO',
      column_default: null,
    });
    expect(column('effectiveFrom')).toMatchObject({ data_type: 'date', is_nullable: 'NO' });
    expect(column('effectiveTo')).toMatchObject({ data_type: 'date', is_nullable: 'YES' });
    for (const field of ['notes', 'correctionReason'])
      expect(column(field)).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    for (const field of ['voidedAt', 'createdAt', 'updatedAt'])
      expect(column(field)).toMatchObject({
        data_type: 'timestamp with time zone',
        datetime_precision: 3,
      });
  }
});

test('missing Equipment is rejected and referenced Equipment cannot be deleted or reidentified', async () => {
  await rejects(
    () => insert('EquipmentPowerPeriod', { equipmentId: randomUUID() }),
    '23503',
    'EquipmentPowerPeriod_equipmentId_fkey',
  );
  await insert('EquipmentPowerPeriod');
  await rejects(
    () => database.query('DELETE FROM "Equipment" WHERE id = $1', [equipmentId]),
    '23001',
    'EquipmentPowerPeriod_equipmentId_fkey',
  );
  await rejects(
    () =>
      database.query('UPDATE "Equipment" SET id = $1 WHERE id = $2', [randomUUID(), equipmentId]),
    '23001',
    'EquipmentPowerPeriod_equipmentId_fkey',
  );
});

test.each(['-0.01', '100000.01', 'NaN'])('invalid power %s is rejected', async (power) => {
  await rejects(
    () => insert('EquipmentPowerPeriod', { power }),
    '23514',
    'EquipmentPowerPeriod_powerWatts_check',
  );
});
test.each(['-0.01', '24.01', 'NaN'])('invalid hours %s are rejected', async (hours) => {
  await rejects(
    () => insert('EquipmentPowerPeriod', { hours }),
    '23514',
    'EquipmentPowerPeriod_hoursPerDay_check',
  );
});
test.each([
  ['0', '24'],
  ['100000', '0'],
  ['65.75', '12.50'],
])('power %s and hours %s are valid', async (power, hours) => {
  const id = await insert('EquipmentPowerPeriod', { power, hours });
  const {
    rows: [row],
  } = await database.query(
    'SELECT "powerWatts"::text AS power, "hoursPerDay"::text AS hours FROM "EquipmentPowerPeriod" WHERE id=$1',
    [id],
  );
  expect(row).toEqual({ power: Number(power).toFixed(2), hours: Number(hours).toFixed(2) });
});
test.each(['-0.00001', '1000.00001', 'NaN'])('invalid tariff %s is rejected', async (rate) => {
  await rejects(
    () => insert('ElectricityTariff', { rate }),
    '23514',
    'ElectricityTariff_rate_check',
  );
});
test.each(['0.00000', '24.56789', '1000.00000'])('rate %s is stored exactly', async (rate) => {
  const id = await insert('ElectricityTariff', { rate });
  expect(
    (
      await database.query(
        'SELECT "unitRateMinorPerKwh"::text AS rate FROM "ElectricityTariff" WHERE id=$1',
        [id],
      )
    ).rows[0].rate,
  ).toBe(rate);
});
test.each(['USD', 'EUR', 'gbp', ''])('non GBP currency %s is rejected', async (currency) => {
  await rejects(
    () => insert('ElectricityTariff', { currency }),
    '23514',
    'ElectricityTariff_currency_check',
  );
});

for (const table of tables) {
  test.each([
    { from: '2026-09-01', to: '2026-09-01' },
    { from: '2026-09-01', to: '2026-08-31' },
    { from: '-infinity', to: null },
    { from: '2026-09-01', to: 'infinity' },
  ])(`${table} rejects invalid interval %j`, async (input) => {
    await rejects(() => insert(table, input), '23514', `${table}_interval_check`);
  });
  test(`${table} rejects impossible calendar dates`, async () => {
    await rejects(() => insert(table, { from: '2026-02-30' }), '22008');
  });
  test(`${table} allows adjacent periods and gaps`, async () => {
    await insert(table);
    await insert(table, { from: '2026-10-01', to: '2026-11-01' });
    await insert(table, { from: '2026-12-01', to: null });
  });
  test(`${table} rejects overlapping inserts and updates`, async () => {
    await insert(table);
    await rejects(
      () => insert(table, { from: '2026-09-20', to: '2026-10-20' }),
      '23P01',
      `${table}_no_overlap`,
    );
    const next = await insert(table, { from: '2026-10-01', to: null });
    await rejects(
      () =>
        database.query(`UPDATE "${table}" SET "effectiveFrom" = '2026-09-30' WHERE id = $1`, [
          next,
        ]),
      '23P01',
      `${table}_no_overlap`,
    );
  });
  test(`${table} open periods exclude future overlapping periods`, async () => {
    await insert(table, { to: null });
    await rejects(
      () => insert(table, { from: '2099-01-01', to: null }),
      '23P01',
      `${table}_no_overlap`,
    );
  });
  test(`${table} void retains history and permits a replacement`, async () => {
    const id = await insert(table, { to: null });
    await database.query(
      `UPDATE "${table}" SET "voidedAt" = CURRENT_TIMESTAMP, "correctionReason" = 'Wrong record' WHERE id = $1`,
      [id],
    );
    await insert(table, { to: null });
    expect(
      (
        await database.query(
          `SELECT "voidedAt", "correctionReason" FROM "${table}" WHERE id = $1`,
          [id],
        )
      ).rows[0],
    ).toMatchObject({ correctionReason: 'Wrong record', voidedAt: expect.any(Date) });
    await rejects(
      () => database.query(`UPDATE "${table}" SET "voidedAt" = NULL WHERE id = $1`, [id]),
      '23P01',
      `${table}_no_overlap`,
    );
  });
  test.each([null, '', '   ', '\t\r\n'])(
    `${table} void rejects blank reason %j`,
    async (reason) => {
      await rejects(
        () => insert(table, { voided: true, reason }),
        '23514',
        `${table}_void_reason_check`,
      );
    },
  );
  test(`${table} void checks also protect updates`, async () => {
    const id = await insert(table);
    await rejects(
      () =>
        database.query(`UPDATE "${table}" SET "voidedAt" = CURRENT_TIMESTAMP WHERE id = $1`, [id]),
      '23514',
      `${table}_void_reason_check`,
    );
  });
  test(`${table} numeric infinity is rejected`, async () => {
    const field = table === 'EquipmentPowerPeriod' ? 'power' : 'rate';
    await rejects(() => insert(table, { [field]: 'Infinity' }), '22003');
  });
}

test('different Equipment may have overlapping dates and archive does not change periods', async () => {
  const first = await insert('EquipmentPowerPeriod');
  const other = randomUUID();
  await database.query(
    'INSERT INTO "Equipment" (id, reference, name, "usesPower", "updatedAt") VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP)',
    [other, `energy-${other}`, 'Other'],
  );
  await insert('EquipmentPowerPeriod', { equipmentId: other });
  const before = (
    await database.query('SELECT * FROM "EquipmentPowerPeriod" WHERE id = $1', [first])
  ).rows;
  await database.query('UPDATE "Equipment" SET "archivedAt" = CURRENT_TIMESTAMP WHERE id = $1', [
    equipmentId,
  ]);
  expect(
    (await database.query('SELECT * FROM "EquipmentPowerPeriod" WHERE id = $1', [first])).rows,
  ).toEqual(before);
});

test('Prisma generated models preserve decimal values, defaults and reverse relationship', async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const rollback = new Error('Rollback Prisma energy fixture');
  try {
    await expect(
      prisma.$transaction(async (tx) => {
        const equipment = await tx.equipment.create({
          data: {
            reference: `energy-${randomUUID()}`,
            name: 'Prisma fixture',
            usesPower: true,
            powerPeriods: {
              create: {
                powerWatts: '65.75',
                hoursPerDay: '12.50',
                effectiveFrom: new Date('2026-09-01'),
              },
            },
          },
          include: { powerPeriods: true },
        });
        expect(equipment.powerPeriods[0].powerWatts.toString()).toBe('65.75');
        expect(equipment.powerPeriods[0]).toMatchObject({
          effectiveTo: null,
          voidedAt: null,
          notes: null,
          correctionReason: null,
          id: expect.any(String),
          updatedAt: expect.any(Date),
        });
        const tariff = await tx.electricityTariff.create({
          data: { unitRateMinorPerKwh: '24.56789', effectiveFrom: new Date('2026-09-01') },
        });
        expect(tariff.currency).toBe('GBP');
        expect(tariff.unitRateMinorPerKwh.toString()).toBe('24.56789');
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  } finally {
    await prisma.$disconnect();
  }
});
