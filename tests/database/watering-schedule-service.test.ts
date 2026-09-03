import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';
import {
  getCurrentWateringSchedule,
  getPlantWateringDueState,
  getPlantWateringScheduleHistory,
  getWateringScheduleForDate,
} from '../../src/modules/watering/watering-schedule-queries';
import {
  changeWateringSchedule,
  correctWateringSchedulePeriod,
  voidWateringSchedulePeriod,
} from '../../src/modules/watering/watering-schedule-service';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: () => binding ?? database }));

const url = getTestDatabaseUrl();
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 5000, max: 8 }),
});
const realTransaction = database.$transaction.bind(database);
const rollback = new Error('Rollback all watering schedule fixtures');
let binding: object | undefined;
let baseline: unknown;
let transactionLevels: string[] = [];

async function snapshot() {
  return database.$queryRaw`SELECT
    (SELECT jsonb_agg(t ORDER BY id) FROM "WateringEvent" t) watering_events,
    (SELECT jsonb_agg(t ORDER BY id) FROM "WateringSchedulePeriod" t) watering_schedules,
    (SELECT jsonb_agg(t ORDER BY id) FROM "Plant" t) plants,
    (SELECT jsonb_agg(t ORDER BY id) FROM "PlantPurchase" t) purchases,
    (SELECT jsonb_agg(t ORDER BY id) FROM "PlantParentage" t) parentage,
    (SELECT jsonb_agg(t ORDER BY id) FROM "PlantPhoto" t) photos,
    (SELECT jsonb_build_object('last_value', last_value::text, 'is_called', is_called) FROM public.plant_reference_sequence) ant,
    (SELECT jsonb_build_object('last_value', last_value::text, 'is_called', is_called) FROM public.equipment_reference_sequence) eqp`;
}

beforeAll(async () => {
  const [target] = await database.$queryRaw<
    { name: string; version: number }[]
  >`SELECT current_database() name, current_setting('server_version_num')::int version`;
  expect(target.name).toBe(decodeURIComponent(new URL(url).pathname.slice(1)));
  expect(target.version).toBeGreaterThanOrEqual(180000);
  expect(target.version).toBeLessThan(190000);
  baseline = await snapshot();
});

afterEach(async () => {
  binding = undefined;
  transactionLevels = [];
  vi.restoreAllMocks();
  expect(await snapshot()).toEqual(baseline);
});

afterAll(() => database.$disconnect());

async function fixture(check: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await realTransaction(
      async (tx) => {
        let pending: Promise<unknown> = Promise.resolve();
        const operationTransaction = (
          operation: (client: Prisma.TransactionClient) => Promise<unknown>,
          options: { isolationLevel: string },
        ) => {
          transactionLevels.push(options.isolationLevel);
          const run = pending.then(async () => {
            await tx.$executeRaw`SAVEPOINT watering_schedule_operation`;
            try {
              const result = await operation(tx);
              await tx.$executeRaw`RELEASE SAVEPOINT watering_schedule_operation`;
              return result;
            } catch (error) {
              await tx.$executeRaw`ROLLBACK TO SAVEPOINT watering_schedule_operation`;
              await tx.$executeRaw`RELEASE SAVEPOINT watering_schedule_operation`;
              throw error;
            }
          });
          pending = run.catch(() => undefined);
          return run;
        };
        binding = {
          plant: tx.plant,
          wateringEvent: tx.wateringEvent,
          wateringSchedulePeriod: tx.wateringSchedulePeriod,
          $queryRaw: tx.$queryRaw.bind(tx),
          $transaction: operationTransaction,
        };
        await check(tx);
        throw rollback;
      },
      { timeout: 20000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

function plant(
  tx: Prisma.TransactionClient,
  data: Omit<Prisma.PlantUncheckedCreateInput, 'reference'> = {},
) {
  return tx.plant.create({ data: { reference: `watering-schedule-${randomUUID()}`, ...data } });
}

function schedule(
  tx: Prisma.TransactionClient,
  plantId: string,
  data: Partial<Prisma.WateringSchedulePeriodUncheckedCreateInput> = {},
) {
  return tx.wateringSchedulePeriod.create({
    data: {
      plantId,
      intervalDays: 7,
      effectiveFrom: new Date('2026-09-01'),
      ...data,
    },
  });
}

const token = (period: { updatedAt: Date }) => ({
  expectedUpdatedAt: period.updatedAt.toISOString(),
});

test.each(['GROWING', 'QUARANTINE'] as const)(
  '%s Plant can receive its first schedule without changing Plant.updatedAt',
  (status) =>
    fixture(async (tx) => {
      const target = await plant(tx, { status });
      const created = await changeWateringSchedule(target.id, {
        intervalDays: 7,
        effectiveFrom: '2026-09-01',
        notes: '  Summer target  ',
      });
      expect(created).toMatchObject({
        plantId: target.id,
        intervalDays: 7,
        notes: 'Summer target',
      });
      expect((await tx.plant.findUniqueOrThrow({ where: { id: target.id } })).updatedAt).toEqual(
        target.updatedAt,
      );
      expect(transactionLevels).toContain('ReadCommitted');
    }),
);

test.each([
  ['archived', { archivedAt: new Date('2026-01-01') }],
  ['Sold', { status: 'SOLD' as const }],
  ['Deceased', { status: 'DECEASED' as const }],
])('%s Plant rejects normal schedule changes', (_label, lifecycle) =>
  fixture(async (tx) => {
    const target = await plant(tx, lifecycle);
    await expect(
      changeWateringSchedule(target.id, { intervalDays: 7, effectiveFrom: '2026-09-01' }),
    ).rejects.toMatchObject({ code: 'PLANT_NOT_ELIGIBLE' });
    expect(await tx.wateringSchedulePeriod.count({ where: { plantId: target.id } })).toBe(0);
  }),
);

test('normal changes split bounded/open periods and preserve a future successor', () =>
  fixture(async (tx) => {
    const target = await plant(tx);
    const first = await schedule(tx, target.id, { effectiveTo: new Date('2026-10-01') });
    const successor = await schedule(tx, target.id, {
      intervalDays: 10,
      effectiveFrom: new Date('2026-10-01'),
    });
    const created = await changeWateringSchedule(target.id, {
      intervalDays: 5,
      effectiveFrom: '2026-09-20',
    });
    expect(created).toMatchObject({ intervalDays: 5, effectiveTo: new Date('2026-10-01') });
    expect(
      (await tx.wateringSchedulePeriod.findUniqueOrThrow({ where: { id: first.id } })).effectiveTo,
    ).toEqual(new Date('2026-09-20'));
    expect(
      await tx.wateringSchedulePeriod.findUniqueOrThrow({ where: { id: successor.id } }),
    ).toEqual(successor);
    const openPlant = await plant(tx);
    const open = await schedule(tx, openPlant.id);
    const openChange = await changeWateringSchedule(openPlant.id, {
      intervalDays: 4,
      effectiveFrom: '2026-09-20',
    });
    expect(openChange.effectiveTo).toBeNull();
    expect(
      (await tx.wateringSchedulePeriod.findUniqueOrThrow({ where: { id: open.id } })).effectiveTo,
    ).toEqual(new Date('2026-09-20'));
  }));

test('normal change in a genuine gap stops at the successor and exact starts require correction', () =>
  fixture(async (tx) => {
    const target = await plant(tx);
    await schedule(tx, target.id, { effectiveTo: new Date('2026-09-10') });
    const successor = await schedule(tx, target.id, { effectiveFrom: new Date('2026-10-01') });
    const inserted = await changeWateringSchedule(target.id, {
      intervalDays: 6,
      effectiveFrom: '2026-09-20',
    });
    expect(inserted.effectiveTo).toEqual(new Date('2026-10-01'));
    await expect(
      changeWateringSchedule(target.id, { intervalDays: 9, effectiveFrom: '2026-10-01' }),
    ).rejects.toMatchObject({ code: 'SCHEDULE_CONFLICT' });
    expect(
      await tx.wateringSchedulePeriod.findUniqueOrThrow({ where: { id: successor.id } }),
    ).toEqual(successor);
  }));

test('correction changes interval/notes with a strict target token and no Plant timestamp write', () =>
  fixture(async (tx) => {
    const target = await plant(tx);
    const original = await schedule(tx, target.id);
    await expect(
      correctWateringSchedulePeriod(target.id, original.id, {
        intervalDays: 9,
        correctionReason: 'Stale',
        expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
    const corrected = await correctWateringSchedulePeriod(target.id, original.id, {
      intervalDays: 9,
      notes: '  Corrected target  ',
      correctionReason: '  Paper plan checked  ',
      ...token(original),
    });
    expect(corrected).toMatchObject({
      intervalDays: 9,
      notes: 'Corrected target',
      correctionReason: 'Paper plan checked',
    });
    expect(corrected.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
    expect((await tx.plant.findUniqueOrThrow({ where: { id: target.id } })).updatedAt).toEqual(
      target.updatedAt,
    );
  }));

test('safe shared-boundary correction is atomic; implicit or non-adjacent overlap is rejected', () =>
  fixture(async (tx) => {
    const target = await plant(tx);
    const left = await schedule(tx, target.id, { effectiveTo: new Date('2026-10-01') });
    const right = await schedule(tx, target.id, { effectiveFrom: new Date('2026-10-01') });
    await expect(
      correctWateringSchedulePeriod(target.id, right.id, {
        effectiveFrom: '2026-09-20',
        correctionReason: 'Boundary',
        ...token(right),
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULE_CONFLICT' });
    const corrected = await correctWateringSchedulePeriod(target.id, right.id, {
      effectiveFrom: '2026-09-20',
      correctionReason: 'Boundary copied incorrectly',
      adjacentAdjustments: [{ periodId: left.id, effectiveTo: '2026-09-20' }],
      ...token(right),
    });
    expect(corrected.effectiveFrom).toEqual(new Date('2026-09-20'));
    const adjusted = await tx.wateringSchedulePeriod.findUniqueOrThrow({ where: { id: left.id } });
    expect(adjusted.effectiveTo).toEqual(new Date('2026-09-20'));
    expect(adjusted.correctionReason).toBe('Boundary copied incorrectly');
  }));

test.each([
  ['archived', { archivedAt: new Date('2026-01-01') }],
  ['Sold', { status: 'SOLD' as const }],
  ['Deceased', { status: 'DECEASED' as const }],
])('correction and void work for %s Plant and preserve Plant.updatedAt', (_label, lifecycle) =>
  fixture(async (tx) => {
    const target = await plant(tx, lifecycle);
    const original = await schedule(tx, target.id);
    const corrected = await correctWateringSchedulePeriod(target.id, original.id, {
      intervalDays: 8,
      correctionReason: 'Correct interval',
      ...token(original),
    });
    const voided = await voidWateringSchedulePeriod(target.id, original.id, {
      correctionReason: 'Schedule did not apply',
      ...token(corrected),
    });
    expect(voided.voidedAt).toBeInstanceOf(Date);
    expect((await tx.plant.findUniqueOrThrow({ where: { id: target.id } })).updatedAt).toEqual(
      target.updatedAt,
    );
  }),
);

test('correction enforces reason, ownership, interval bounds and rejects a voided target', () =>
  fixture(async (tx) => {
    const target = await plant(tx);
    const other = await plant(tx);
    const original = await schedule(tx, target.id);
    await expect(
      correctWateringSchedulePeriod(other.id, original.id, {
        intervalDays: 8,
        correctionReason: 'Wrong owner',
        ...token(original),
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULE_NOT_FOUND' });
    for (const intervalDays of [0, 366]) {
      await expect(
        correctWateringSchedulePeriod(target.id, original.id, {
          intervalDays,
          correctionReason: 'Invalid',
          ...token(original),
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    await expect(
      correctWateringSchedulePeriod(target.id, original.id, {
        intervalDays: 8,
        correctionReason: '  ',
        ...token(original),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const voided = await voidWateringSchedulePeriod(target.id, original.id, {
      correctionReason: 'Wrong schedule',
      ...token(original),
    });
    await expect(
      correctWateringSchedulePeriod(target.id, original.id, {
        intervalDays: 8,
        correctionReason: 'Cannot correct',
        ...token(voided),
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_VOIDED' });
  }));

test('void retains its row, advances its token, rejects stale/blank/second void and leaves a gap', () =>
  fixture(async (tx) => {
    const target = await plant(tx);
    const left = await schedule(tx, target.id, { effectiveTo: new Date('2026-09-10') });
    const middle = await schedule(tx, target.id, {
      effectiveFrom: new Date('2026-09-10'),
      effectiveTo: new Date('2026-09-20'),
    });
    const right = await schedule(tx, target.id, { effectiveFrom: new Date('2026-09-20') });
    await expect(
      voidWateringSchedulePeriod(target.id, middle.id, {
        correctionReason: '',
        ...token(middle),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      voidWateringSchedulePeriod(target.id, middle.id, {
        correctionReason: 'Stale',
        expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
    const voided = await voidWateringSchedulePeriod(target.id, middle.id, {
      correctionReason: '  Entered for wrong season  ',
      ...token(middle),
    });
    expect(voided).toMatchObject({
      correctionReason: 'Entered for wrong season',
      voidedAt: expect.any(Date),
    });
    expect(voided.updatedAt.getTime()).toBeGreaterThan(middle.updatedAt.getTime());
    expect(await tx.wateringSchedulePeriod.count({ where: { id: middle.id } })).toBe(1);
    expect(await tx.wateringSchedulePeriod.findUniqueOrThrow({ where: { id: left.id } })).toEqual(
      left,
    );
    expect(await tx.wateringSchedulePeriod.findUniqueOrThrow({ where: { id: right.id } })).toEqual(
      right,
    );
    expect(await getWateringScheduleForDate(target.id, '2026-09-15')).toBeNull();
    await expect(
      voidWateringSchedulePeriod(target.id, middle.id, {
        correctionReason: 'Again',
        ...token(voided),
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_VOIDED' });
  }));

test('schedule history is chronological, includes voids and date lookup obeys half-open boundaries', () =>
  fixture(async (tx) => {
    const target = await plant(tx);
    const first = await schedule(tx, target.id, { effectiveTo: new Date('2026-10-01') });
    const second = await schedule(tx, target.id, { effectiveFrom: new Date('2026-10-01') });
    await voidWateringSchedulePeriod(target.id, first.id, {
      correctionReason: 'Retain historical mistake',
      ...token(first),
    });
    const history = await getPlantWateringScheduleHistory(target.id);
    expect(history.periods.map((period) => period.id)).toEqual([first.id, second.id]);
    expect(history.periods[0].voidedAt).not.toBeNull();
    expect(await getWateringScheduleForDate(target.id, '2026-09-30')).toBeNull();
    expect(await getWateringScheduleForDate(target.id, '2026-10-01')).toMatchObject({
      id: second.id,
    });
    expect(transactionLevels).toContain('RepeatableRead');
    const currentPlant = await plant(tx);
    const alwaysCurrent = await schedule(tx, currentPlant.id, {
      effectiveFrom: new Date('2000-01-01'),
    });
    expect(await getCurrentWateringSchedule(currentPlant.id)).toMatchObject({
      id: alwaysCurrent.id,
    });
  }));

test('per-Plant due read uses one Repeatable Read snapshot and keeps lifecycle separate from maths', () =>
  fixture(async (tx) => {
    const target = await plant(tx, { status: 'SOLD' });
    await schedule(tx, target.id, { intervalDays: 7 });
    const qualifying = await tx.wateringEvent.create({
      data: { plantId: target.id, wateredAt: new Date('2026-09-01T09:00:00.000Z') },
    });
    await tx.wateringEvent.create({
      data: { plantId: target.id, wateredAt: new Date('2026-09-11T09:00:00.000Z') },
    });
    const before = await snapshot();
    transactionLevels = [];
    const result = await getPlantWateringDueState(target.id, '2026-09-10');
    expect(result.plant).toMatchObject({ status: 'SOLD', activeCareEligible: false });
    expect(result.latestWateringEvent?.id).toBe(qualifying.id);
    expect(result.due).toMatchObject({
      status: 'OVERDUE',
      latestWateredDate: '2026-09-01',
      nextDueDate: '2026-09-08',
      daysUntilDue: -2,
    });
    expect(transactionLevels).toEqual(['RepeatableRead']);
    expect(await snapshot()).toEqual(before);
  }));
