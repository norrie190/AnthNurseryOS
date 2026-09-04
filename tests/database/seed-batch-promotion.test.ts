import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { promoteSeedBatchPlants } from '../../src/modules/breeding/promotion-service';
import { correctSeedBatch, voidSeedBatch } from '../../src/modules/breeding/seed-batch-service';
import { updatePlant } from '../../src/modules/plants/plant-update-service';

vi.mock('server-only', () => ({}));
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: getTestDatabaseUrl(), max: 8 }),
});
let binding: object | undefined;
vi.mock('../../src/lib/prisma', () => ({ getPrisma: () => binding ?? database }));
const realTransaction = database.$transaction.bind(database);
const rollback = new Error('Rollback promotion fixtures');
let baseline: unknown;

async function snapshot() {
  return database.$queryRaw`
    SELECT (SELECT count(*) FROM "Plant") AS plants,
           (SELECT count(*) FROM "PlantParentage") AS parentage,
           (SELECT count(*) FROM "SeedBatch") AS batches`;
}

beforeAll(async () => {
  baseline = await snapshot();
});
afterEach(async () => {
  binding = undefined;
  vi.restoreAllMocks();
  expect(await snapshot()).toEqual(baseline);
});
afterAll(() => database.$disconnect());

async function fixture(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await realTransaction(async (tx) => {
      let pending: Promise<unknown> = Promise.resolve();
      const operationTransaction = (
        operation: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => {
        const result = pending.then(async () => {
          await tx.$executeRaw`SAVEPOINT promotion_operation`;
          try {
            const value = await operation(tx);
            await tx.$executeRaw`RELEASE SAVEPOINT promotion_operation`;
            return value;
          } catch (error) {
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT promotion_operation`;
            await tx.$executeRaw`RELEASE SAVEPOINT promotion_operation`;
            throw error;
          }
        });
        pending = result.catch(() => undefined);
        return result;
      };
      binding = {
        plant: tx.plant,
        plantParentage: tx.plantParentage,
        seedBatch: tx.seedBatch,
        $transaction: operationTransaction,
      };
      await run(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function context(
  tx: Prisma.TransactionClient,
  source: 'INTERNAL' | 'EXTERNAL' | 'UNKNOWN' = 'INTERNAL',
) {
  const seedParent = await tx.plant.create({
    data: { reference: `promotion-seed-${randomUUID()}` },
  });
  const pollen = await tx.plant.create({ data: { reference: `promotion-pollen-${randomUUID()}` } });
  const inflorescence = await tx.inflorescence.create({ data: { plantId: seedParent.id } });
  const attempt = await tx.pollinationAttempt.create({
    data: {
      inflorescenceId: inflorescence.id,
      pollinatedOn: new Date('2026-01-01'),
      pollenSourceMode: source,
      pollenParentPlantId: source === 'INTERNAL' ? pollen.id : null,
      pollenParentName: source === 'EXTERNAL' ? 'External parent' : null,
    },
  });
  const batch = await tx.seedBatch.create({
    data: {
      pollinationAttemptId: attempt.id,
      harvestedOn: new Date('2026-01-02'),
      sownOn: new Date('2026-01-03'),
      seedCount: 5,
      germinatedCount: 3,
      status: 'GERMINATING',
    },
  });
  return { seedParent, pollen, attempt, batch };
}

test('promotes multiple Plants atomically with derived parentage and origin', () =>
  fixture(async (tx) => {
    const { seedParent, pollen, batch } = await context(tx);
    const result = await promoteSeedBatchPlants(batch.id, {
      quantity: 2,
      expectedUpdatedAt: batch.updatedAt.toISOString(),
    });
    expect(result.createdPlants).toHaveLength(2);
    expect(new Set(result.createdPlants.map((plant) => plant.reference)).size).toBe(2);
    const created = await tx.plant.findMany({
      where: { originSeedBatchId: batch.id },
      include: { parentage: true, purchase: true },
      orderBy: { reference: 'asc' },
    });
    expect(created).toHaveLength(2);
    expect(created.every((plant) => plant.status === 'GROWING' && plant.name === null)).toBe(true);
    expect(created.every((plant) => plant.purchase === null)).toBe(true);
    expect(
      created.map((plant) => [
        plant.parentage?.seedParentPlantId,
        plant.parentage?.pollenParentPlantId,
      ]),
    ).toEqual([
      [seedParent.id, pollen.id],
      [seedParent.id, pollen.id],
    ]);
    const updatedBatch = await tx.seedBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(updatedBatch.status).toBe('GERMINATING');
    expect(updatedBatch.updatedAt.getTime()).toBeGreaterThan(batch.updatedAt.getTime());
  }));

test('derives external and unknown pollen without copying richer provenance', () =>
  fixture(async (tx) => {
    const external = await context(tx, 'EXTERNAL');
    const unknown = await context(tx, 'UNKNOWN');
    const externalResult = await promoteSeedBatchPlants(external.batch.id, {
      quantity: 1,
      expectedUpdatedAt: external.batch.updatedAt.toISOString(),
    });
    const unknownResult = await promoteSeedBatchPlants(unknown.batch.id, {
      quantity: 1,
      expectedUpdatedAt: unknown.batch.updatedAt.toISOString(),
    });
    const parentages = await tx.plantParentage.findMany({
      where: {
        plantId: { in: [externalResult.createdPlants[0].id, unknownResult.createdPlants[0].id] },
      },
      orderBy: { plantId: 'asc' },
    });
    expect(parentages).toHaveLength(2);
    expect(
      parentages.find((parentage) => parentage.plantId === externalResult.createdPlants[0].id),
    ).toMatchObject({
      seedParentPlantId: external.seedParent.id,
      pollenParentPlantId: null,
      pollenParentName: 'External parent',
    });
    expect(
      parentages.find((parentage) => parentage.plantId === unknownResult.createdPlants[0].id),
    ).toMatchObject({
      seedParentPlantId: unknown.seedParent.id,
      pollenParentPlantId: null,
      pollenParentName: null,
    });
  }));

test('rejects over-capacity and protects origin parentage and batch history', () =>
  fixture(async (tx) => {
    const { batch } = await context(tx);
    const first = await promoteSeedBatchPlants(batch.id, {
      quantity: 2,
      status: 'QUARANTINE',
      expectedUpdatedAt: batch.updatedAt.toISOString(),
    });
    const current = await tx.seedBatch.findUniqueOrThrow({ where: { id: batch.id } });
    await expect(
      promoteSeedBatchPlants(batch.id, {
        quantity: 2,
        expectedUpdatedAt: current.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'PROMOTION_CAPACITY_EXCEEDED' });
    await expect(
      updatePlant(first.createdPlants[0].id, {
        expectedUpdatedAt: (
          await tx.plant.findUniqueOrThrow({ where: { id: first.createdPlants[0].id } })
        ).updatedAt.toISOString(),
        parentage: { seedParent: { kind: 'unknown' } },
      }),
    ).rejects.toMatchObject({ code: 'ORIGIN_PARENTAGE_LOCKED' });
    await expect(
      voidSeedBatch(batch.id, {
        correctionReason: 'test',
        expectedUpdatedAt: current.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'PROVENANCE_LOCKED' });
    await correctSeedBatch(batch.id, {
      germinatedCount: 2,
      correctionReason: 'test correction',
      expectedUpdatedAt: current.updatedAt.toISOString(),
    }).catch((error) => expect(error).toMatchObject({ code: 'PROVENANCE_LOCKED' }));
  }));
