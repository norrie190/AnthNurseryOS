import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { PrismaClient } from '../../src/generated/prisma/client';

const connectionString = getTestDatabaseUrl();
const database = new Client({
  connectionString,
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
});
const tables = ['WateringEvent', 'WateringSchedulePeriod'] as const;
let plantId: string;
let baseline: unknown;

async function snapshot() {
  const counts = (
    await database.query(`SELECT
      (SELECT count(*)::int FROM "WateringEvent") AS watering_events,
      (SELECT count(*)::int FROM "WateringSchedulePeriod") AS watering_schedules,
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
  plantId = randomUUID();
  await database.query(
    'INSERT INTO "Plant" (id, reference, "updatedAt") VALUES ($1, $2, CURRENT_TIMESTAMP)',
    [plantId, `watering-schema-${randomUUID()}`],
  );
});

afterEach(async () => {
  await database.query('ROLLBACK');
  expect(await snapshot()).toEqual(baseline);
});

afterAll(async () => {
  await database.end();
});

type CommonInput = {
  plantId?: string;
  voided?: boolean;
  reason?: string | null;
};

async function insertEvent(
  input: CommonInput & { wateredAt?: string; notes?: string | null } = {},
) {
  const id = randomUUID();
  await database.query(
    `INSERT INTO "WateringEvent"
      (id, "plantId", "wateredAt", notes, "voidedAt", "correctionReason", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
    [
      id,
      input.plantId ?? plantId,
      input.wateredAt ?? '2026-09-03T08:30:00.000Z',
      input.notes ?? null,
      input.voided ? new Date() : null,
      input.reason ?? null,
    ],
  );
  return id;
}

async function insertSchedule(
  input: CommonInput & {
    intervalDays?: number;
    from?: string;
    to?: string | null;
    notes?: string | null;
  } = {},
) {
  const id = randomUUID();
  await database.query(
    `INSERT INTO "WateringSchedulePeriod"
      (id, "plantId", "intervalDays", "effectiveFrom", "effectiveTo", notes, "voidedAt", "correctionReason", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
    [
      id,
      input.plantId ?? plantId,
      input.intervalDays ?? 7,
      input.from ?? '2026-09-01',
      input.to === undefined ? '2026-10-01' : input.to,
      input.notes ?? null,
      input.voided ? new Date() : null,
      input.reason ?? null,
    ],
  );
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

test('reviewed migration, constraints, indexes and restrictive Plant FKs are installed', async () => {
  const name = '20260903000000_add_watering_history';
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

  const indexes = (
    await database.query(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY indexname",
      [tables],
    )
  ).rows;
  expect(indexes.map((row) => row.indexname)).toEqual([
    'WateringEvent_pkey',
    'WateringEvent_plantId_wateredAt_nonvoid_idx',
    'WateringSchedulePeriod_no_overlap',
    'WateringSchedulePeriod_pkey',
    'WateringSchedulePeriod_plantId_effectiveFrom_idx',
  ]);
  expect(
    indexes.find((row) => row.indexname === 'WateringEvent_plantId_wateredAt_nonvoid_idx')
      ?.indexdef,
  ).toContain('"wateredAt" DESC');
  expect(
    indexes.find((row) => row.indexname === 'WateringEvent_plantId_wateredAt_nonvoid_idx')
      ?.indexdef,
  ).toContain('WHERE ("voidedAt" IS NULL)');

  for (const table of tables) {
    const {
      rows: [fk],
    } = await database.query(
      'SELECT confdeltype, confupdtype FROM pg_constraint WHERE conname = $1',
      [`${table}_plantId_fkey`],
    );
    expect(fk).toEqual({ confdeltype: 'r', confupdtype: 'r' });
  }

  const {
    rows: [exclusion],
  } = await database.query(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'WateringSchedulePeriod_no_overlap'",
  );
  expect(exclusion.definition).toContain(
    'daterange("effectiveFrom", "effectiveTo", \'[)\'::text) WITH &&',
  );
  expect(exclusion.definition).toContain('"voidedAt" IS NULL');
});

test('WateringEvent stores an exact event and permits multiple events at the same instant', async () => {
  const wateredAt = '2026-09-03T08:30:00.123Z';
  const first = await insertEvent({ wateredAt, notes: 'Morning watering' });
  const second = await insertEvent({ wateredAt });
  const { rows } = await database.query(
    'SELECT id, "wateredAt", notes FROM "WateringEvent" WHERE id = ANY($1) ORDER BY id',
    [[first, second]],
  );
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.wateredAt.toISOString() === wateredAt)).toBe(true);
  expect(rows.map((row) => row.notes)).toEqual(expect.arrayContaining([null, 'Morning watering']));
});

test.each(['infinity', '-infinity'])(
  'WateringEvent rejects non-finite wateredAt %s',
  async (wateredAt) => {
    await rejects(() => insertEvent({ wateredAt }), '23514', 'WateringEvent_wateredAt_check');
  },
);

test('WateringEvent has a restrictive Plant relationship', async () => {
  await rejects(
    () => insertEvent({ plantId: randomUUID() }),
    '23503',
    'WateringEvent_plantId_fkey',
  );
  await insertEvent();
  await rejects(
    () => database.query('DELETE FROM "Plant" WHERE id = $1', [plantId]),
    '23001',
    'WateringEvent_plantId_fkey',
  );
  await rejects(
    () => database.query('UPDATE "Plant" SET id = $1 WHERE id = $2', [randomUUID(), plantId]),
    '23001',
    'WateringEvent_plantId_fkey',
  );
});

test('WateringSchedulePeriod stores valid lower and upper interval bounds', async () => {
  await insertSchedule({ intervalDays: 1 });
  await insertSchedule({ intervalDays: 365, from: '2026-10-01', to: null });
  expect(
    (
      await database.query(
        'SELECT "intervalDays" FROM "WateringSchedulePeriod" ORDER BY "effectiveFrom"',
      )
    ).rows,
  ).toEqual([{ intervalDays: 1 }, { intervalDays: 365 }]);
});

test.each([0, -1, 366])('WateringSchedulePeriod rejects intervalDays %s', async (intervalDays) => {
  await rejects(
    () => insertSchedule({ intervalDays }),
    '23514',
    'WateringSchedulePeriod_intervalDays_check',
  );
});

test.each([
  { from: '2026-09-01', to: '2026-09-01' },
  { from: '2026-09-01', to: '2026-08-31' },
  { from: '-infinity', to: null },
  { from: '2026-09-01', to: 'infinity' },
])('WateringSchedulePeriod rejects invalid interval $from to $to', async (input) => {
  await rejects(() => insertSchedule(input), '23514', 'WateringSchedulePeriod_interval_check');
});

test('WateringSchedulePeriod accepts adjacent half-open periods', async () => {
  await insertSchedule({ from: '2026-09-01', to: '2026-10-01' });
  await insertSchedule({ from: '2026-10-01', to: '2026-11-01' });
  await insertSchedule({ from: '2026-12-01', to: null });
});

test('WateringSchedulePeriod rejects overlapping non-void inserts and updates', async () => {
  await insertSchedule({ from: '2026-09-01', to: '2026-10-01' });
  await rejects(
    () => insertSchedule({ from: '2026-09-20', to: '2026-10-20' }),
    '23P01',
    'WateringSchedulePeriod_no_overlap',
  );
  const next = await insertSchedule({ from: '2026-10-01', to: null });
  await rejects(
    () =>
      database.query('UPDATE "WateringSchedulePeriod" SET "effectiveFrom" = $1 WHERE id = $2', [
        '2026-09-30',
        next,
      ]),
    '23P01',
    'WateringSchedulePeriod_no_overlap',
  );
});

test('a voided schedule remains in history and does not block a replacement', async () => {
  const voided = await insertSchedule({
    to: null,
    voided: true,
    reason: 'Incorrect schedule',
  });
  await insertSchedule({ to: null });
  expect(
    (
      await database.query(
        'SELECT "voidedAt", "correctionReason" FROM "WateringSchedulePeriod" WHERE id = $1',
        [voided],
      )
    ).rows[0],
  ).toMatchObject({ correctionReason: 'Incorrect schedule', voidedAt: expect.any(Date) });
});

test('WateringSchedulePeriod has a restrictive Plant relationship', async () => {
  await rejects(
    () => insertSchedule({ plantId: randomUUID() }),
    '23503',
    'WateringSchedulePeriod_plantId_fkey',
  );
  await insertSchedule();
  await rejects(
    () => database.query('DELETE FROM "Plant" WHERE id = $1', [plantId]),
    '23001',
    'WateringSchedulePeriod_plantId_fkey',
  );
});

for (const table of tables) {
  test.each([null, '', '   ', '\t\r\n'])(
    `${table} void rejects blank correctionReason %j`,
    async (reason) => {
      await rejects(
        () =>
          table === 'WateringEvent'
            ? insertEvent({ voided: true, reason })
            : insertSchedule({ voided: true, reason }),
        '23514',
        `${table}_void_reason_check`,
      );
    },
  );

  test(`${table} void check also protects updates`, async () => {
    const id = table === 'WateringEvent' ? await insertEvent() : await insertSchedule();
    await rejects(
      () =>
        database.query(`UPDATE "${table}" SET "voidedAt" = CURRENT_TIMESTAMP WHERE id = $1`, [id]),
      '23514',
      `${table}_void_reason_check`,
    );
  });
}

test('Prisma generated models expose Plant watering relations and defaults', async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const rollback = new Error('Rollback Prisma watering fixture');
  try {
    await expect(
      prisma.$transaction(async (tx) => {
        const plant = await tx.plant.create({
          data: {
            reference: `watering-${randomUUID()}`,
            wateringEvents: {
              create: { wateredAt: new Date('2026-09-03T08:30:00.000Z') },
            },
            wateringSchedulePeriods: {
              create: { intervalDays: 7, effectiveFrom: new Date('2026-09-03') },
            },
          },
          include: { wateringEvents: true, wateringSchedulePeriods: true },
        });
        expect(plant.wateringEvents[0]).toMatchObject({
          plantId: plant.id,
          notes: null,
          voidedAt: null,
          correctionReason: null,
        });
        expect(plant.wateringSchedulePeriods[0]).toMatchObject({
          plantId: plant.id,
          intervalDays: 7,
          effectiveTo: null,
          notes: null,
          voidedAt: null,
          correctionReason: null,
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  } finally {
    await prisma.$disconnect();
  }
});
