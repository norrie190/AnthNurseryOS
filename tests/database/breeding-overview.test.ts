import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { dateToSql } from '../../src/lib/calendar-date';
import { getBreedingOverview } from '../../src/modules/breeding/breeding-overview-queries';

vi.mock('server-only', () => ({}));
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: getTestDatabaseUrl(), max: 8 }),
});
let binding: Record<string, unknown> | undefined;
vi.mock('../../src/lib/prisma', () => ({ getPrisma: () => binding ?? database }));
const rollback = new Error('Rollback overview fixtures');

beforeAll(async () => {
  const [target] = await database.$queryRaw<{ name: string }[]>`SELECT current_database() name`;
  expect(target.name).toBe(decodeURIComponent(new URL(getTestDatabaseUrl()).pathname.slice(1)));
});

afterAll(() => database.$disconnect());

test('returns persisted lifecycle counts, provenance and deterministic attention ordering', async () => {
  try {
    await database.$transaction(async (tx) => {
      binding = {
        inflorescence: tx.inflorescence,
        pollinationAttempt: tx.pollinationAttempt,
        seedBatch: tx.seedBatch,
        $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx),
      };
      const owner = await tx.plant.create({ data: { reference: `overview-${randomUUID()}` } });
      const makeInflorescence = (
        status: 'OBSERVED' | 'OPEN' | 'FINISHED' | 'ABORTED',
        day: string,
      ) =>
        tx.inflorescence.create({
          data: { plantId: owner.id, status, emergedOn: dateToSql(day), openedOn: dateToSql(day) },
        });
      const observed = await makeInflorescence('OBSERVED', '2026-01-01');
      const open = await makeInflorescence('OPEN', '2026-01-02');
      await makeInflorescence('OPEN', '2025-12-01');
      const finished = await makeInflorescence('FINISHED', '2026-01-03');
      const aborted = await makeInflorescence('ABORTED', '2026-01-04');
      await tx.inflorescence.create({
        data: {
          plantId: owner.id,
          status: 'OPEN',
          emergedOn: dateToSql('2026-01-05'),
          voidedAt: new Date('2026-01-05T12:00:00Z'),
          correctionReason: 'Test void',
        },
      });
      const attemptStatuses = ['PENDING', 'DEVELOPING', 'FAILED', 'HARVESTED'] as const;
      const attempts = [];
      for (const [index, status] of attemptStatuses.entries()) {
        const inflorescence = [observed, finished, aborted, open][index];
        attempts.push(
          await tx.pollinationAttempt.create({
            data: {
              inflorescenceId: inflorescence.id,
              pollinatedOn: dateToSql(`2026-02-0${index + 1}`),
              status,
              pollenSourceMode: 'INTERNAL',
              pollenParentPlantId: owner.id,
            },
          }),
        );
      }
      const batchStatuses = [
        'HARVESTED',
        'AWAITING_GERMINATION',
        'GERMINATING',
        'EXHAUSTED',
        'FAILED',
      ] as const;
      for (const [index, status] of batchStatuses.entries()) {
        await tx.seedBatch.create({
          data: {
            pollinationAttemptId: attempts[3].id,
            harvestedOn: dateToSql(`2026-03-0${index + 1}`),
            sownOn: status === 'HARVESTED' ? null : dateToSql(`2026-03-1${index + 1}`),
            seedCount: 10,
            germinatedCount: status === 'GERMINATING' ? 2 : 0,
            status,
          },
        });
      }
      await tx.plant.update({ where: { id: owner.id }, data: { status: 'SOLD' } });
      const overview = await getBreedingOverview();
      expect(overview.inflorescences).toEqual({ OBSERVED: 1, OPEN: 2, FINISHED: 1, ABORTED: 1 });
      expect(overview.activeInflorescences).toBe(3);
      expect(overview.pollinationAttempts).toEqual({
        PENDING: 1,
        DEVELOPING: 1,
        FAILED: 1,
        HARVESTED: 1,
      });
      expect(overview.activePollinations).toBe(2);
      expect(overview.seedBatches).toEqual({
        HARVESTED: 1,
        AWAITING_GERMINATION: 1,
        GERMINATING: 1,
        EXHAUSTED: 1,
        FAILED: 1,
      });
      expect(overview.awaitingSowing).toBe(1);
      expect(overview.awaitingGermination).toBe(1);
      expect(overview.activelyGerminating).toBe(1);
      expect(overview.attention.map((item) => item.type)).toEqual([
        'INFLORESCENCE',
        'POLLINATION',
        'POLLINATION',
        'SEED_BATCH',
        'SEED_BATCH',
        'SEED_BATCH',
      ]);
      expect(overview.attention[0]).toMatchObject({ type: 'INFLORESCENCE', status: 'OPEN' });
      expect(overview.attention[1]).toMatchObject({ type: 'POLLINATION', status: 'PENDING' });
      expect(overview.attention[2]).toMatchObject({ type: 'POLLINATION', status: 'DEVELOPING' });
      expect(overview.attention[3]).toMatchObject({ type: 'SEED_BATCH', status: 'HARVESTED' });
      const harvestItem = overview.attention.find(
        (item) => item.type === 'SEED_BATCH' && item.status === 'HARVESTED',
      );
      expect(harvestItem).toMatchObject({ cross: `${owner.reference} × ${owner.reference}` });
      expect(overview.attention.every((item) => item.plant.status === 'SOLD')).toBe(true);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    binding = undefined;
  }
});
