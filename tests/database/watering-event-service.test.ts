import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';
import { updatePlant } from '../../src/modules/plants/plant-update-service';
import {
  getLatestQualifyingWateringEvent,
  getPlantWateringHistory,
} from '../../src/modules/watering/watering-event-queries';
import {
  correctWateringEvent,
  recordWateringEvent,
  voidWateringEvent,
} from '../../src/modules/watering/watering-event-service';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: () => binding ?? database }));

const url = getTestDatabaseUrl();
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 5000, max: 8 }),
});
const realTransaction = database.$transaction.bind(database);
const rollback = new Error('Rollback all watering event fixtures');
let binding: object | undefined;
let baseline: unknown;

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
          expect(['ReadCommitted', 'RepeatableRead']).toContain(options.isolationLevel);
          const run = pending.then(async () => {
            await tx.$executeRaw`SAVEPOINT watering_event_operation`;
            try {
              const result = await operation(tx);
              await tx.$executeRaw`RELEASE SAVEPOINT watering_event_operation`;
              return result;
            } catch (error) {
              await tx.$executeRaw`ROLLBACK TO SAVEPOINT watering_event_operation`;
              await tx.$executeRaw`RELEASE SAVEPOINT watering_event_operation`;
              throw error;
            }
          });
          pending = run.catch(() => undefined);
          return run;
        };
        binding = {
          plant: tx.plant,
          plantParentage: tx.plantParentage,
          plantPurchase: tx.plantPurchase,
          location: tx.location,
          wateringEvent: tx.wateringEvent,
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
  return tx.plant.create({ data: { reference: `watering-event-${randomUUID()}`, ...data } });
}

function token(event: { updatedAt: Date }) {
  return { expectedUpdatedAt: event.updatedAt.toISOString() };
}

const backdated = '2020-06-15T08:30:00.000Z';

test('active Growing and Quarantine Plants accept backdated and current events with optional notes', () =>
  fixture(async (tx) => {
    const growing = await plant(tx);
    const quarantine = await plant(tx, { status: 'QUARANTINE' });
    const first = await recordWateringEvent(growing.id, {
      wateredAt: backdated,
      notes: '  Morning watering  ',
    });
    const currentTime = new Date().toISOString();
    const second = await recordWateringEvent(quarantine.id, { wateredAt: currentTime });
    expect(first).toMatchObject({ plantId: growing.id, notes: 'Morning watering' });
    expect(first.wateredAt.toISOString()).toBe(backdated);
    expect(second).toMatchObject({ plantId: quarantine.id, notes: null });
    expect(second.wateredAt.toISOString()).toBe(currentTime);
  }));

test.each([
  ['archived', { archivedAt: new Date('2026-01-01') }],
  ['Sold', { status: 'SOLD' as const }],
  ['Deceased', { status: 'DECEASED' as const }],
])('%s Plant is ineligible for a new watering event', (_label, data) =>
  fixture(async (tx) => {
    const target = await plant(tx, data);
    await expect(recordWateringEvent(target.id, { wateredAt: backdated })).rejects.toMatchObject({
      code: 'PLANT_NOT_ELIGIBLE',
    });
    expect(await tx.wateringEvent.count({ where: { plantId: target.id } })).toBe(0);
  }),
);

test('record rejects missing Plants and future facts', () =>
  fixture(async (tx) => {
    const target = await plant(tx);
    await expect(recordWateringEvent(randomUUID(), { wateredAt: backdated })).rejects.toMatchObject(
      { code: 'PLANT_NOT_FOUND' },
    );
    await expect(
      recordWateringEvent(target.id, {
        wateredAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'FUTURE_WATERING' });
    expect(await tx.wateringEvent.count()).toBe(0);
  }));

test('multiple events, including identical timestamps, are retained without changing Plant.updatedAt', () =>
  fixture(async (tx) => {
    const target = await plant(tx);
    const before = target.updatedAt;
    await recordWateringEvent(target.id, { wateredAt: backdated });
    await recordWateringEvent(target.id, { wateredAt: backdated, notes: 'Second pass' });
    expect(await tx.wateringEvent.count({ where: { plantId: target.id } })).toBe(2);
    expect((await tx.plant.findUniqueOrThrow({ where: { id: target.id } })).updatedAt).toEqual(
      before,
    );
    const edited = await updatePlant(target.id, {
      expectedUpdatedAt: before.toISOString(),
      notes: 'Unrelated edit remains valid',
    });
    expect(edited.notes).toBe('Unrelated edit remains valid');
  }));

test('correction changes only approved fields, requires ownership/token and strictly advances its event token', () =>
  fixture(async (tx) => {
    const target = await plant(tx);
    const other = await plant(tx);
    const original = await recordWateringEvent(target.id, {
      wateredAt: backdated,
      notes: 'Original',
    });
    await expect(
      correctWateringEvent(other.id, original.id, {
        notes: 'Transfer',
        correctionReason: 'Wrong Plant',
        ...token(original),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });
    await expect(
      correctWateringEvent(target.id, original.id, {
        notes: 'Stale',
        correctionReason: 'Typo',
        expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });

    const corrected = await correctWateringEvent(target.id, original.id, {
      wateredAt: '2020-06-16T09:00:00.000Z',
      notes: null,
      correctionReason: '  Diary time was wrong  ',
      ...token(original),
    });
    expect(corrected).toMatchObject({
      id: original.id,
      plantId: target.id,
      notes: null,
      correctionReason: 'Diary time was wrong',
    });
    expect(corrected.wateredAt.toISOString()).toBe('2020-06-16T09:00:00.000Z');
    expect(corrected.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
  }));

test('correction rejects future times, blank reasons, protected Plant transfer and voided events', () =>
  fixture(async (tx) => {
    const target = await plant(tx);
    const original = await recordWateringEvent(target.id, { wateredAt: backdated });
    await expect(
      correctWateringEvent(target.id, original.id, {
        wateredAt: new Date(Date.now() + 60_000).toISOString(),
        correctionReason: 'Wrong time',
        ...token(original),
      }),
    ).rejects.toMatchObject({ code: 'FUTURE_WATERING' });
    await expect(
      correctWateringEvent(target.id, original.id, {
        notes: 'x',
        correctionReason: '  ',
        ...token(original),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      correctWateringEvent(target.id, original.id, {
        notes: 'x',
        correctionReason: 'Wrong Plant',
        ...token(original),
        plantId: randomUUID(),
      } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const voided = await voidWateringEvent(target.id, original.id, {
      correctionReason: 'Duplicate',
      ...token(original),
    });
    await expect(
      correctWateringEvent(target.id, original.id, {
        notes: 'Cannot change',
        correctionReason: 'Attempt',
        ...token(voided),
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_VOIDED' });
  }));

test.each([
  ['archived', { archivedAt: new Date('2026-01-01') }],
  ['Sold', { status: 'SOLD' as const }],
  ['Deceased', { status: 'DECEASED' as const }],
])('correction works for %s Plant without changing Plant.updatedAt', (_label, lifecycle) =>
  fixture(async (tx) => {
    const target = await plant(tx, lifecycle);
    const event = await tx.wateringEvent.create({
      data: { plantId: target.id, wateredAt: new Date(backdated) },
    });
    const plantBefore = await tx.plant.findUniqueOrThrow({ where: { id: target.id } });
    await correctWateringEvent(target.id, event.id, {
      notes: 'Historical correction',
      correctionReason: 'Paper log checked',
      ...token(event),
    });
    expect(await tx.plant.findUniqueOrThrow({ where: { id: target.id } })).toEqual(plantBefore);
  }),
);

test('void retains the event, records its reason, advances its token and rejects stale/second voids', () =>
  fixture(async (tx) => {
    const target = await plant(tx);
    const original = await recordWateringEvent(target.id, { wateredAt: backdated });
    const plantBefore = await tx.plant.findUniqueOrThrow({ where: { id: target.id } });
    await expect(
      voidWateringEvent(target.id, original.id, {
        correctionReason: 'Stale',
        expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
    const voided = await voidWateringEvent(target.id, original.id, {
      correctionReason: '  Duplicate diary entry  ',
      ...token(original),
    });
    expect(voided).toMatchObject({
      id: original.id,
      correctionReason: 'Duplicate diary entry',
      voidedAt: expect.any(Date),
    });
    expect(voided.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
    expect(await tx.wateringEvent.count({ where: { id: original.id } })).toBe(1);
    expect(await tx.plant.findUniqueOrThrow({ where: { id: target.id } })).toEqual(plantBefore);
    await expect(
      voidWateringEvent(target.id, original.id, {
        correctionReason: 'Again',
        ...token(voided),
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_VOIDED' });
  }));

test.each([
  ['archived', { archivedAt: new Date('2026-01-01') }],
  ['Sold', { status: 'SOLD' as const }],
  ['Deceased', { status: 'DECEASED' as const }],
])('void works for %s Plant without changing Plant.updatedAt', (_label, lifecycle) =>
  fixture(async (tx) => {
    const target = await plant(tx, lifecycle);
    const event = await tx.wateringEvent.create({
      data: { plantId: target.id, wateredAt: new Date(backdated) },
    });
    const plantBefore = await tx.plant.findUniqueOrThrow({ where: { id: target.id } });
    await voidWateringEvent(target.id, event.id, {
      correctionReason: 'Wrong entry',
      ...token(event),
    });
    expect(await tx.plant.findUniqueOrThrow({ where: { id: target.id } })).toEqual(plantBefore);
  }),
);

test('history is deterministic newest-first, includes voids, and isolates Plant ownership', () =>
  fixture(async (tx) => {
    const target = await plant(tx, { status: 'SOLD', archivedAt: new Date() });
    const other = await plant(tx);
    const common = {
      wateredAt: new Date('2020-06-15T08:30:00.000Z'),
      createdAt: new Date('2020-06-15T09:00:00.000Z'),
      updatedAt: new Date('2020-06-15T09:00:00.000Z'),
    };
    const lowId = '11111111-1111-4111-8111-111111111111';
    const highId = '22222222-2222-4222-8222-222222222222';
    await tx.wateringEvent.createMany({
      data: [
        { id: lowId, plantId: target.id, ...common },
        {
          id: highId,
          plantId: target.id,
          ...common,
          voidedAt: new Date('2020-06-16T00:00:00.000Z'),
          correctionReason: 'Duplicate',
        },
        {
          plantId: target.id,
          wateredAt: new Date('2020-06-16T08:30:00.000Z'),
          createdAt: new Date('2020-06-16T09:00:00.000Z'),
          updatedAt: new Date('2020-06-16T09:00:00.000Z'),
        },
        { plantId: other.id, ...common },
      ],
    });
    const history = await getPlantWateringHistory(target.id);
    expect(history.plant).toMatchObject({ id: target.id, status: 'SOLD' });
    expect(history.events).toHaveLength(3);
    expect(history.events.slice(1).map((event) => event.id)).toEqual([highId, lowId]);
    expect(history.events.some((event) => event.voidedAt !== null)).toBe(true);
    expect(history.events.every((event) => event.plantId === target.id)).toBe(true);
    expect((await getPlantWateringHistory(other.id)).events).toHaveLength(1);
  }));

test('latest qualifying event excludes voids and empty history returns null', () =>
  fixture(async (tx) => {
    const target = await plant(tx);
    expect(await getLatestQualifyingWateringEvent(target.id)).toBeNull();
    const qualifying = await tx.wateringEvent.create({
      data: { plantId: target.id, wateredAt: new Date('2020-06-15T08:30:00.000Z') },
    });
    await tx.wateringEvent.create({
      data: {
        plantId: target.id,
        wateredAt: new Date('2020-06-16T08:30:00.000Z'),
        voidedAt: new Date(),
        correctionReason: 'Wrong entry',
      },
    });
    expect(await getLatestQualifyingWateringEvent(target.id)).toMatchObject({
      id: qualifying.id,
      voidedAt: null,
    });
    await expect(getPlantWateringHistory(randomUUID())).rejects.toMatchObject({
      code: 'PLANT_NOT_FOUND',
    });
    await expect(getLatestQualifyingWateringEvent(randomUUID())).rejects.toMatchObject({
      code: 'PLANT_NOT_FOUND',
    });
  }));
