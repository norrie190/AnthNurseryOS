import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { dateToSql } from '../../src/lib/calendar-date';
import { createInflorescence } from '../../src/modules/breeding/inflorescence-service';
import {
  createPollinationAttempt,
  correctPollinationAttempt,
} from '../../src/modules/breeding/pollination-service';
import {
  closeSeedBatch,
  correctSeedBatch,
  recordSeedBatchGermination,
  recordSeedBatchHarvest,
  recordSeedBatchSowing,
  voidSeedBatch,
} from '../../src/modules/breeding/seed-batch-service';
import {
  getOwnedSeedBatchDetail,
  getPollinationSeedBatchHistory,
} from '../../src/modules/breeding/breeding-queries';

vi.mock('server-only', () => ({}));
const url = getTestDatabaseUrl();
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, max: 8, connectionTimeoutMillis: 5000 }),
});
let binding: object | undefined;
vi.mock('../../src/lib/prisma', () => ({ getPrisma: () => binding ?? database }));
const realTransaction = database.$transaction.bind(database);
let baseline: unknown;
const rollback = new Error('Rollback SeedBatch fixtures');

async function snapshot() {
  return database.$queryRaw`SELECT
    (SELECT jsonb_agg(t ORDER BY id) FROM "Plant" t) plants,
    (SELECT jsonb_agg(t ORDER BY id) FROM "Inflorescence" t) inflorescences,
    (SELECT jsonb_agg(t ORDER BY id) FROM "PollinationAttempt" t) attempts,
    (SELECT jsonb_agg(t ORDER BY id) FROM "SeedBatch" t) batches`;
}
beforeAll(async () => {
  const [target] = await database.$queryRaw<{ name: string }[]>`SELECT current_database() name`;
  expect(target.name).toBe(decodeURIComponent(new URL(url).pathname.slice(1)));
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
        ) => {
          const run = pending.then(async () => {
            await tx.$executeRaw`SAVEPOINT seed_batch_operation`;
            try {
              const result = await operation(tx);
              await tx.$executeRaw`RELEASE SAVEPOINT seed_batch_operation`;
              return result;
            } catch (error) {
              await tx.$executeRaw`ROLLBACK TO SAVEPOINT seed_batch_operation`;
              await tx.$executeRaw`RELEASE SAVEPOINT seed_batch_operation`;
              throw error;
            }
          });
          pending = run.catch(() => undefined);
          return run;
        };
        binding = {
          plant: tx.plant,
          inflorescence: tx.inflorescence,
          pollinationAttempt: tx.pollinationAttempt,
          seedBatch: tx.seedBatch,
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

function plant(tx: Prisma.TransactionClient, data: Partial<Prisma.PlantUncheckedCreateInput> = {}) {
  return tx.plant.create({ data: { reference: `seed-batch-${randomUUID()}`, ...data } });
}
async function attempt(
  tx: Prisma.TransactionClient,
  status: 'PENDING' | 'DEVELOPING' | 'FAILED' | 'HARVESTED' = 'PENDING',
) {
  const owner = await plant(tx);
  const inflorescence = await createInflorescence(owner.id, {});
  const row = await createPollinationAttempt(inflorescence.id, {
    pollinatedOn: '2026-01-01',
    pollenSource: { mode: 'UNKNOWN' },
  });
  if (status === 'DEVELOPING') {
    return {
      owner,
      inflorescence,
      attempt: await tx.pollinationAttempt.update({ where: { id: row.id }, data: { status } }),
    };
  }
  if (status === 'FAILED' || status === 'HARVESTED') {
    return {
      owner,
      inflorescence,
      attempt: await tx.pollinationAttempt.update({ where: { id: row.id }, data: { status } }),
    };
  }
  return { owner, inflorescence, attempt: row };
}

test('harvest is atomic, accepts pending attempts, advances only the attempt, and permits multiple batches', () =>
  fixture(async (tx) => {
    const context = await attempt(tx);
    const plantBefore = context.owner.updatedAt;
    const inflorescenceBefore = context.inflorescence.updatedAt;
    const first = await recordSeedBatchHarvest(context.attempt.id, {
      harvestedOn: '2026-01-01',
      seedCount: 20,
      expectedPollinationUpdatedAt: context.attempt.updatedAt.toISOString(),
      notes: 'First berry',
    });
    expect(first.batch.status).toBe('HARVESTED');
    expect(first.pollinationAttempt.status).toBe('HARVESTED');
    expect(first.pollinationAttempt.updatedAt.getTime()).toBeGreaterThan(
      context.attempt.updatedAt.getTime(),
    );
    expect(
      (await tx.plant.findUniqueOrThrow({ where: { id: context.owner.id } })).updatedAt,
    ).toEqual(plantBefore);
    expect(
      (await tx.inflorescence.findUniqueOrThrow({ where: { id: context.inflorescence.id } }))
        .updatedAt,
    ).toEqual(inflorescenceBefore);
    await expect(
      recordSeedBatchHarvest(context.attempt.id, {
        harvestedOn: '2026-01-02',
        expectedPollinationUpdatedAt: context.attempt.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
    const second = await recordSeedBatchHarvest(context.attempt.id, {
      harvestedOn: '2026-01-02',
      seedCount: 0,
      expectedPollinationUpdatedAt: first.pollinationAttempt.updatedAt.toISOString(),
    });
    expect(second.batch.seedCount).toBe(0);
    expect((await getPollinationSeedBatchHistory(context.attempt.id)).map((row) => row.id)).toEqual(
      [second.batch.id, first.batch.id],
    );
  }));

test('failed and voided attempts cannot be harvested, while historical lifecycle is allowed', () =>
  fixture(async (tx) => {
    const failed = await attempt(tx, 'FAILED');
    await expect(
      recordSeedBatchHarvest(failed.attempt.id, {
        harvestedOn: '2026-01-01',
        expectedPollinationUpdatedAt: failed.attempt.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'POLLINATION_ATTEMPT_NOT_HARVESTABLE' });
    const voided = await attempt(tx);
    const voidedAttempt = await tx.pollinationAttempt.update({
      where: { id: voided.attempt.id },
      data: { voidedAt: new Date(), correctionReason: 'Fixture void' },
    });
    await expect(
      recordSeedBatchHarvest(voided.attempt.id, {
        harvestedOn: '2026-01-01',
        expectedPollinationUpdatedAt: voidedAttempt.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'POLLINATION_ATTEMPT_VOIDED' });
  }));

test('sowing enforces dates, stale tokens, and the harvested to awaiting transition', () =>
  fixture(async (tx) => {
    const context = await attempt(tx);
    const harvested = await recordSeedBatchHarvest(context.attempt.id, {
      harvestedOn: '2026-01-01',
      seedCount: 10,
      expectedPollinationUpdatedAt: context.attempt.updatedAt.toISOString(),
    });
    await expect(
      recordSeedBatchSowing(harvested.batch.id, {
        sownOn: '2025-12-31',
        expectedUpdatedAt: harvested.batch.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const sown = await recordSeedBatchSowing(harvested.batch.id, {
      sownOn: '2026-02-01',
      expectedUpdatedAt: harvested.batch.updatedAt.toISOString(),
    });
    expect(sown.status).toBe('AWAITING_GERMINATION');
    await expect(
      recordSeedBatchSowing(sown.id, {
        sownOn: '2026-02-02',
        expectedUpdatedAt: sown.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'SEED_BATCH_ALREADY_SOWN' });
  }));

test('germination preserves unknown versus zero, is monotonic, and closes outcomes narrowly', () =>
  fixture(async (tx) => {
    const context = await attempt(tx);
    const harvested = await recordSeedBatchHarvest(context.attempt.id, {
      harvestedOn: '2026-01-01',
      seedCount: 10,
      expectedPollinationUpdatedAt: context.attempt.updatedAt.toISOString(),
    });
    await expect(
      recordSeedBatchGermination(harvested.batch.id, {
        germinatedCount: 0,
        expectedUpdatedAt: harvested.batch.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'SEED_BATCH_NOT_SOWN' });
    const sown = await recordSeedBatchSowing(harvested.batch.id, {
      sownOn: '2026-01-02',
      expectedUpdatedAt: harvested.batch.updatedAt.toISOString(),
    });
    const zero = await recordSeedBatchGermination(sown.id, {
      germinatedCount: 0,
      expectedUpdatedAt: sown.updatedAt.toISOString(),
    });
    expect(zero.status).toBe('AWAITING_GERMINATION');
    const positive = await recordSeedBatchGermination(zero.id, {
      germinatedCount: 3,
      expectedUpdatedAt: zero.updatedAt.toISOString(),
    });
    expect(positive.status).toBe('GERMINATING');
    await expect(
      recordSeedBatchGermination(positive.id, {
        germinatedCount: 2,
        expectedUpdatedAt: positive.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'GERMINATION_REGRESSION' });
    const exhausted = await closeSeedBatch(positive.id, {
      status: 'EXHAUSTED',
      expectedUpdatedAt: positive.updatedAt.toISOString(),
    });
    expect(exhausted.status).toBe('EXHAUSTED');
    await expect(
      closeSeedBatch(exhausted.id, {
        status: 'FAILED',
        expectedUpdatedAt: exhausted.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'SEED_BATCH_INVALID_TRANSITION' });
  }));

test('correction validates coherent historical state and void retains the row', () =>
  fixture(async (tx) => {
    const context = await attempt(tx);
    const harvested = await recordSeedBatchHarvest(context.attempt.id, {
      harvestedOn: '2026-01-01',
      expectedPollinationUpdatedAt: context.attempt.updatedAt.toISOString(),
    });
    const corrected = await correctSeedBatch(harvested.batch.id, {
      harvestedOn: '2025-12-01',
      seedCount: 5,
      correctionReason: 'Corrected harvest date',
      expectedUpdatedAt: harvested.batch.updatedAt.toISOString(),
    });
    expect(corrected.seedCount).toBe(5);
    await expect(
      correctSeedBatch(corrected.id, {
        status: 'GERMINATING',
        correctionReason: 'Invalid state',
        expectedUpdatedAt: corrected.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'SEED_BATCH_INVALID_TRANSITION' });
    const voided = await voidSeedBatch(corrected.id, {
      correctionReason: 'Entered in error',
      expectedUpdatedAt: corrected.updatedAt.toISOString(),
    });
    expect(voided.voidedAt).not.toBeNull();
    await expect(
      voidSeedBatch(voided.id, {
        correctionReason: 'Again',
        expectedUpdatedAt: voided.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'SEED_BATCH_VOIDED' });
  }));

test('live SeedBatch locks provenance correction, while owned queries stay neutral', () =>
  fixture(async (tx) => {
    const context = await attempt(tx);
    const harvested = await recordSeedBatchHarvest(context.attempt.id, {
      harvestedOn: '2026-01-01',
      expectedPollinationUpdatedAt: context.attempt.updatedAt.toISOString(),
    });
    await expect(
      correctPollinationAttempt(context.attempt.id, {
        pollinatedOn: '2026-01-02',
        correctionReason: 'Change source',
        expectedUpdatedAt: harvested.pollinationAttempt.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'PROVENANCE_LOCKED' });
    expect(await getOwnedSeedBatchDetail(context.attempt.id, harvested.batch.id)).not.toBeNull();
    expect(await getOwnedSeedBatchDetail(randomUUID(), harvested.batch.id)).toBeNull();
    const voided = await voidSeedBatch(harvested.batch.id, {
      correctionReason: 'Void dependent batch',
      expectedUpdatedAt: harvested.batch.updatedAt.toISOString(),
    });
    const corrected = await correctPollinationAttempt(context.attempt.id, {
      pollinatedOn: '2026-01-02',
      correctionReason: 'Change source after dependent void',
      expectedUpdatedAt: harvested.pollinationAttempt.updatedAt.toISOString(),
    });
    expect(corrected.pollinatedOn).toEqual(dateToSql('2026-01-02'));
    expect(voided.voidedAt).not.toBeNull();
  }));
