import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { dateToSql } from '../../src/lib/calendar-date';
import {
  changeInflorescenceStatus,
  correctInflorescence,
  createInflorescence,
  voidInflorescence,
} from '../../src/modules/breeding/inflorescence-service';
import {
  changePollinationAttemptStatus,
  correctPollinationAttempt,
  createPollinationAttempt,
  voidPollinationAttempt,
} from '../../src/modules/breeding/pollination-service';
import {
  getOwnedInflorescenceDetail,
  getPlantInflorescenceHistory,
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
const rollback = new Error('Rollback breeding fixtures');

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
            await tx.$executeRaw`SAVEPOINT breeding_operation`;
            try {
              const result = await operation(tx);
              await tx.$executeRaw`RELEASE SAVEPOINT breeding_operation`;
              return result;
            } catch (error) {
              await tx.$executeRaw`ROLLBACK TO SAVEPOINT breeding_operation`;
              await tx.$executeRaw`RELEASE SAVEPOINT breeding_operation`;
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
  return tx.plant.create({ data: { reference: `breeding-${randomUUID()}`, ...data } });
}
const date = '2026-01-01';

test('creates eligible inflorescences, preserves Plant timestamp, and reads deterministic owned history', () =>
  fixture(async (tx) => {
    const owner = await plant(tx);
    const before = owner.updatedAt;
    const first = await createInflorescence(owner.id, { emergedOn: date, notes: '  observed ' });
    const second = await createInflorescence(owner.id, {});
    expect(first.status).toBe('OBSERVED');
    expect(first.notes).toBe('observed');
    expect((await tx.plant.findUniqueOrThrow({ where: { id: owner.id } })).updatedAt).toEqual(
      before,
    );
    expect((await getPlantInflorescenceHistory(owner.id)).map((row) => row.id)).toEqual([
      second.id,
      first.id,
    ]);
  }));

test('rejects inactive or future inflorescence creation', () =>
  fixture(async (tx) => {
    for (const status of ['SOLD', 'DECEASED'] as const) {
      const owner = await plant(tx, { status });
      await expect(createInflorescence(owner.id, {})).rejects.toMatchObject({
        code: 'PLANT_NOT_ELIGIBLE',
      });
    }
    const owner = await plant(tx);
    await expect(createInflorescence(owner.id, { emergedOn: '2999-01-01' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  }));

test('status, correction, stale protection and retained void semantics work', () =>
  fixture(async (tx) => {
    const owner = await plant(tx);
    const row = await createInflorescence(owner.id, { emergedOn: date });
    const opened = await changeInflorescenceStatus(row.id, {
      status: 'OPEN',
      expectedUpdatedAt: row.updatedAt.toISOString(),
    });
    expect(opened.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
    const corrected = await correctInflorescence(row.id, {
      openedOn: date,
      notes: 'fixed',
      correctionReason: 'Corrected entry',
      expectedUpdatedAt: opened.updatedAt.toISOString(),
    });
    await expect(
      changeInflorescenceStatus(row.id, {
        status: 'OBSERVED',
        expectedUpdatedAt: corrected.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    const voided = await voidInflorescence(row.id, {
      correctionReason: 'Entered in error',
      expectedUpdatedAt: corrected.updatedAt.toISOString(),
    });
    expect(voided.voidedAt).not.toBeNull();
    await expect(
      correctInflorescence(row.id, {
        correctionReason: 'again',
        expectedUpdatedAt: voided.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'INFLORESCENCE_VOIDED' });
    await expect(
      voidInflorescence(row.id, {
        correctionReason: 'again',
        expectedUpdatedAt: voided.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      changeInflorescenceStatus(row.id, {
        status: 'OPEN',
        expectedUpdatedAt: row.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
    expect(corrected.notes).toBe('fixed');
    expect((await getOwnedInflorescenceDetail(owner.id, row.id))?.voidedAt).not.toBeNull();
  }));

test('creates internal, external, unknown and selfing attempts, deriving the seed owner', () =>
  fixture(async (tx) => {
    const owner = await plant(tx);
    const other = await plant(tx);
    const a = await createInflorescence(owner.id, {});
    const internal = await createPollinationAttempt(a.id, {
      pollinatedOn: date,
      pollenSource: { mode: 'INTERNAL', pollenParentPlantId: owner.id },
    });
    expect(internal.pollenParentPlantId).toBe(owner.id);
    expect(internal.inflorescenceId).toBe(a.id);
    const b = await createInflorescence(other.id, {});
    const external = await createPollinationAttempt(b.id, {
      pollinatedOn: date,
      pollenSource: { mode: 'EXTERNAL', pollenParentName: 'Parent', pollenBreeder: 'Breeder' },
    });
    expect(external.pollenParentName).toBe('Parent');
    const c = await createInflorescence(owner.id, {});
    const unknown = await createPollinationAttempt(c.id, {
      pollinatedOn: date,
      pollenSource: { mode: 'UNKNOWN' },
    });
    expect(unknown.pollenParentPlantId).toBeNull();
    expect(await getOwnedInflorescenceDetail(owner.id, a.id)).not.toBeNull();
  }));

test('attempt lifecycle, replacement, correction and SeedBatch provenance guard work', () =>
  fixture(async (tx) => {
    const owner = await plant(tx);
    const source = await plant(tx, { status: 'SOLD', archivedAt: new Date('2026-02-01') });
    const inflorescence = await createInflorescence(owner.id, {});
    const attempt = await createPollinationAttempt(inflorescence.id, {
      pollinatedOn: date,
      pollenSource: { mode: 'INTERNAL', pollenParentPlantId: source.id },
    });
    await expect(
      createPollinationAttempt(inflorescence.id, {
        pollinatedOn: date,
        pollenSource: { mode: 'UNKNOWN' },
      }),
    ).rejects.toMatchObject({ code: 'POLLINATION_ATTEMPT_EXISTS' });
    const developing = await changePollinationAttemptStatus(attempt.id, {
      status: 'DEVELOPING',
      expectedUpdatedAt: attempt.updatedAt.toISOString(),
    });
    const failed = await changePollinationAttemptStatus(attempt.id, {
      status: 'FAILED',
      expectedUpdatedAt: developing.updatedAt.toISOString(),
    });
    await expect(
      changePollinationAttemptStatus(attempt.id, {
        status: 'HARVESTED' as never,
        expectedUpdatedAt: failed.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const corrected = await correctPollinationAttempt(attempt.id, {
      pollenSource: { mode: 'UNKNOWN' },
      correctionReason: 'Source was not recorded',
      expectedUpdatedAt: failed.updatedAt.toISOString(),
    });
    const voided = await voidPollinationAttempt(corrected.id, {
      correctionReason: 'Mistaken attempt',
      expectedUpdatedAt: corrected.updatedAt.toISOString(),
    });
    const replacement = await createPollinationAttempt(inflorescence.id, {
      pollinatedOn: date,
      pollenSource: { mode: 'UNKNOWN' },
    });
    expect(voided.voidedAt).not.toBeNull();
    expect(replacement.id).not.toBe(attempt.id);
  }));

test('live child provenance blocks inflorescence void and live SeedBatch blocks attempt void', () =>
  fixture(async (tx) => {
    const owner = await plant(tx);
    const inflorescence = await createInflorescence(owner.id, {});
    const attempt = await createPollinationAttempt(inflorescence.id, {
      pollinatedOn: date,
      pollenSource: { mode: 'UNKNOWN' },
    });
    await expect(
      voidInflorescence(inflorescence.id, {
        correctionReason: 'Cannot remove history',
        expectedUpdatedAt: inflorescence.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const batch = await tx.seedBatch.create({
      data: { pollinationAttemptId: attempt.id, harvestedOn: dateToSql(date) },
    });
    expect(batch.pollinationAttemptId).toBe(attempt.id);
    await expect(
      voidPollinationAttempt(attempt.id, {
        correctionReason: 'Cannot remove provenance',
        expectedUpdatedAt: attempt.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'SEED_BATCH_PROVENANCE' });
  }));
