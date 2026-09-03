import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';
import { getWateringQueue } from '../../src/modules/watering/watering-queue-queries';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: () => binding ?? database }));

const url = getTestDatabaseUrl();
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 5000, max: 6 }),
});
const realTransaction = database.$transaction.bind(database);
const rollback = new Error('Rollback all watering queue fixtures');
let binding: object | undefined;
let baseline: unknown;

async function snapshot() {
  return database.$queryRaw`SELECT
    (SELECT jsonb_agg(t ORDER BY id) FROM "WateringEvent" t) watering_events,
    (SELECT jsonb_agg(t ORDER BY id) FROM "WateringSchedulePeriod" t) watering_schedules,
    (SELECT jsonb_agg(t ORDER BY id) FROM "Plant" t) plants,
    (SELECT jsonb_agg(t ORDER BY id) FROM "PlantPhoto" t) photos,
    (SELECT jsonb_agg(t ORDER BY id) FROM "Location" t) locations`;
}

beforeAll(async () => {
  const [target] = await database.$queryRaw<{ name: string; version: number }[]>`
    SELECT current_database() name, current_setting('server_version_num')::int version`;
  expect(target.name).toBe('anth_nursery_test');
  expect(target.name).toBe(decodeURIComponent(new URL(url).pathname.slice(1)));
  expect(target.version).toBeGreaterThanOrEqual(180000);
  expect(target.version).toBeLessThan(190000);
  baseline = await snapshot();
});

afterEach(async () => {
  binding = undefined;
  vi.restoreAllMocks();
  expect(await snapshot()).toEqual(baseline);
});

afterAll(() => database.$disconnect());

async function fixture(check: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await realTransaction(
      async (tx) => {
        binding = {
          $transaction: async (
            operation: (client: Prisma.TransactionClient) => Promise<unknown>,
            options: { isolationLevel: string },
          ) => {
            expect(options.isolationLevel).toBe('RepeatableRead');
            return operation(tx);
          },
        };
        await check(tx);
        throw rollback;
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

function plant(
  tx: Prisma.TransactionClient,
  reference: string,
  data: Omit<Prisma.PlantUncheckedCreateInput, 'reference'> = {},
) {
  return tx.plant.create({ data: { reference, ...data } });
}

function schedule(
  tx: Prisma.TransactionClient,
  plantId: string,
  data: Partial<Prisma.WateringSchedulePeriodUncheckedCreateInput> = {},
) {
  return tx.wateringSchedulePeriod.create({
    data: { plantId, intervalDays: 7, effectiveFrom: new Date('2026-09-01'), ...data },
  });
}

function event(
  tx: Prisma.TransactionClient,
  plantId: string,
  wateredAt: string,
  data: Partial<Prisma.WateringEventUncheckedCreateInput> = {},
) {
  return tx.wateringEvent.create({ data: { plantId, wateredAt: new Date(wateredAt), ...data } });
}

test('reads a mixed real queue from persisted Plants, schedules, events, location and primary photo', () =>
  fixture(async (tx) => {
    const location = await tx.location.create({ data: { name: 'Queue greenhouse' } });
    const overdue = await plant(tx, 'queue-overdue', {
      name: 'Zulu',
      locationId: location.id,
    });
    const today = await plant(tx, 'queue-today', { name: 'Alpha', status: 'QUARANTINE' });
    const soon = await plant(tx, 'queue-soon', { name: 'Bravo' });
    const first = await plant(tx, 'queue-first', { name: 'Charlie' });
    const unconfigured = await plant(tx, 'queue-unconfigured', { name: 'Delta' });
    await plant(tx, 'queue-sold', { status: 'SOLD' });
    await plant(tx, 'queue-deceased', { status: 'DECEASED' });
    await plant(tx, 'queue-archived', { archivedAt: new Date('2026-09-01T00:00:00.000Z') });

    await schedule(tx, overdue.id, { intervalDays: 1 });
    await schedule(tx, today.id, { intervalDays: 7 });
    await schedule(tx, soon.id, { intervalDays: 7 });
    await schedule(tx, first.id, { intervalDays: 7 });
    await event(tx, overdue.id, '2026-09-01T09:00:00.000Z');
    await event(tx, today.id, '2026-09-03T09:00:00.000Z');
    await event(tx, soon.id, '2026-09-05T09:00:00.000Z');
    const primary = await tx.plantPhoto.create({
      data: {
        plantId: overdue.id,
        storageKey: 'queue-primary',
        isPrimary: true,
        cropX: 0,
        cropY: 0,
        cropSize: 1,
        derivativeRevision: '11111111-1111-4111-8111-111111111111',
      },
    });
    await tx.plantPhoto.create({ data: { plantId: overdue.id, storageKey: 'queue-secondary' } });

    const result = await getWateringQueue('2026-09-10');

    expect(result.nurseryDate).toBe('2026-09-10');
    expect(result.entries.map((entry) => [entry.plant.reference, entry.due.status])).toEqual([
      ['queue-overdue', 'OVERDUE'],
      ['queue-today', 'DUE_TODAY'],
      ['queue-first', 'NEEDS_FIRST_WATERING'],
      ['queue-soon', 'DUE_SOON'],
      ['queue-unconfigured', 'NOT_CONFIGURED'],
    ]);
    expect(result.counts).toEqual({
      totalEligible: 5,
      overdue: 1,
      dueToday: 1,
      dueSoon: 1,
      needsFirstWatering: 1,
      upcoming: 0,
      notConfigured: 1,
    });
    expect(result.entries[0]).toMatchObject({
      plant: {
        id: overdue.id,
        location: { id: location.id, name: 'Queue greenhouse' },
        primaryPhoto: { id: primary.id, derivativeRevision: primary.derivativeRevision },
      },
      due: { intervalDays: 1, latestWateredDate: '2026-09-01', nextDueDate: '2026-09-02' },
    });
    expect(result.entries[1].due).toMatchObject({ latestWateredDate: '2026-09-03' });
    expect(result.entries[3].due).toMatchObject({ latestWateredDate: '2026-09-05' });
  }));

test('uses persisted half-open periods, gaps, voids and nursery-day event boundary semantics', () =>
  fixture(async (tx) => {
    const adjacent = await plant(tx, 'boundary-adjacent', { name: 'Adjacent' });
    const gap = await plant(tx, 'boundary-gap', { name: 'Gap' });
    const voidedSchedule = await plant(tx, 'boundary-voided-schedule', { name: 'Voided schedule' });
    const voidedEvent = await plant(tx, 'boundary-voided-event', { name: 'Voided event' });
    const afterDay = await plant(tx, 'boundary-after-day', { name: 'After day' });

    await schedule(tx, adjacent.id, {
      intervalDays: 7,
      effectiveFrom: new Date('2026-09-01'),
      effectiveTo: new Date('2026-09-10'),
    });
    await schedule(tx, adjacent.id, { intervalDays: 3, effectiveFrom: new Date('2026-09-10') });
    await schedule(tx, gap.id, {
      effectiveFrom: new Date('2026-09-01'),
      effectiveTo: new Date('2026-09-10'),
    });
    await schedule(tx, gap.id, { effectiveFrom: new Date('2026-09-11') });
    await schedule(tx, voidedSchedule.id, {
      voidedAt: new Date('2026-09-09T12:00:00.000Z'),
      correctionReason: 'Incorrect plan',
    });
    await schedule(tx, voidedEvent.id);
    await schedule(tx, afterDay.id);
    const previous = await event(tx, voidedEvent.id, '2026-09-03T09:00:00.000Z');
    await event(tx, voidedEvent.id, '2026-09-09T09:00:00.000Z', {
      voidedAt: new Date('2026-09-09T10:00:00.000Z'),
      correctionReason: 'Duplicate entry',
    });
    await event(tx, afterDay.id, '2026-09-03T09:00:00.000Z');
    await event(tx, afterDay.id, '2026-09-10T23:30:00.000Z');

    const result = await getWateringQueue('2026-09-10');
    const byReference = new Map(result.entries.map((entry) => [entry.plant.reference, entry]));

    expect(byReference.get('boundary-adjacent')?.due).toMatchObject({
      status: 'NEEDS_FIRST_WATERING',
      intervalDays: 3,
    });
    expect(byReference.get('boundary-gap')?.due.status).toBe('NOT_CONFIGURED');
    expect(byReference.get('boundary-voided-schedule')?.due.status).toBe('NOT_CONFIGURED');
    expect(byReference.get('boundary-voided-event')?.due).toMatchObject({
      status: 'DUE_TODAY',
      latestWateredDate: '2026-09-03',
      nextDueDate: '2026-09-10',
    });
    expect(previous.id).toBeDefined();
    expect(byReference.get('boundary-after-day')?.due).toMatchObject({
      status: 'DUE_TODAY',
      latestWateredDate: '2026-09-03',
      nextDueDate: '2026-09-10',
    });
  }));
