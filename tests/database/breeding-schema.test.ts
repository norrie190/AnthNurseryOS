import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';

const url = getTestDatabaseUrl();
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 5000, max: 4 }),
});
const rollback = new Error('Rollback breeding schema fixture');

beforeAll(async () => {
  const rows = await database.$queryRawUnsafe<{ name: string }[]>('SELECT current_database() name');
  expect(rows[0]?.name).toBe(decodeURIComponent(new URL(url).pathname.slice(1)));
});

afterAll(async () => database.$disconnect());

async function fixture(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  await expect(
    database.$transaction(async (tx) => {
      await run(tx);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}

test('supports multiple inflorescences and a valid internal selfing attempt', async () => {
  await fixture(async (tx) => {
    const plant = await tx.plant.create({ data: { reference: 'BREED-' + randomUUID() } });
    const first = await tx.inflorescence.create({
      data: {
        plantId: plant.id,
        emergedOn: new Date('2026-09-01'),
        openedOn: new Date('2026-09-03'),
      },
    });
    await tx.inflorescence.create({ data: { plantId: plant.id, status: 'OPEN' } });
    const attempt = await tx.pollinationAttempt.create({
      data: {
        inflorescenceId: first.id,
        pollinatedOn: new Date('2026-09-03'),
        pollenSourceMode: 'INTERNAL',
        pollenParentPlantId: plant.id,
      },
    });
    expect(attempt.pollenParentPlantId).toBe(plant.id);
  });
});

test('supports external and unknown pollen sources', async () => {
  await fixture(async (tx) => {
    const plant = await tx.plant.create({ data: { reference: 'BREED-' + randomUUID() } });
    const inflorescence = await tx.inflorescence.create({ data: { plantId: plant.id } });
    const external = await tx.pollinationAttempt.create({
      data: {
        inflorescenceId: inflorescence.id,
        pollinatedOn: new Date('2026-09-03'),
        pollenSourceMode: 'EXTERNAL',
        pollenParentName: 'Unknown collector clone',
        pollenBreeder: 'Example Nursery',
      },
    });
    expect(external.pollenSourceMode).toBe('EXTERNAL');
    await tx.pollinationAttempt.update({
      where: { id: external.id },
      data: { voidedAt: new Date(), correctionReason: 'Entered as a duplicate.' },
    });
    const unknown = await tx.pollinationAttempt.create({
      data: {
        inflorescenceId: inflorescence.id,
        pollinatedOn: new Date('2026-09-04'),
        pollenSourceMode: 'UNKNOWN',
      },
    });
    expect(unknown.pollenParentPlantId).toBeNull();
  });
});

test('allows one live attempt, then allows replacement after voiding', async () => {
  await fixture(async (tx) => {
    const plant = await tx.plant.create({ data: { reference: 'BREED-' + randomUUID() } });
    const inflorescence = await tx.inflorescence.create({ data: { plantId: plant.id } });
    const data = {
      inflorescenceId: inflorescence.id,
      pollinatedOn: new Date('2026-09-03'),
      pollenSourceMode: 'UNKNOWN' as const,
    };
    const first = await tx.pollinationAttempt.create({ data });
    await tx.$executeRawUnsafe('SAVEPOINT breeding_attempt');
    await expect(tx.pollinationAttempt.create({ data })).rejects.toThrow();
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT breeding_attempt');
    await tx.pollinationAttempt.update({
      where: { id: first.id },
      data: { voidedAt: new Date(), correctionReason: 'Mistaken attempt.' },
    });
    const replacement = await tx.pollinationAttempt.create({ data });
    expect(replacement.id).not.toBe(first.id);
  });
});

test('enforces void reasons and safe date/count boundaries', async () => {
  await expect(
    database.inflorescence.create({
      data: {
        plantId: randomUUID(),
        openedOn: new Date('2026-09-01'),
        emergedOn: new Date('2026-09-02'),
      },
    }),
  ).rejects.toThrow();
  await expect(
    database.seedBatch.create({
      data: {
        pollinationAttemptId: randomUUID(),
        harvestedOn: new Date('2026-09-03'),
        seedCount: 2,
        germinatedCount: 3,
      },
    }),
  ).rejects.toThrow();
});

test('supports multiple seed batches and preserves unknown versus zero counts', async () => {
  await fixture(async (tx) => {
    const plant = await tx.plant.create({ data: { reference: 'BREED-' + randomUUID() } });
    const inflorescence = await tx.inflorescence.create({ data: { plantId: plant.id } });
    const attempt = await tx.pollinationAttempt.create({
      data: {
        inflorescenceId: inflorescence.id,
        pollinatedOn: new Date('2026-09-03'),
        pollenSourceMode: 'UNKNOWN',
      },
    });
    const unknown = await tx.seedBatch.create({
      data: { pollinationAttemptId: attempt.id, harvestedOn: new Date('2026-09-04') },
    });
    const zero = await tx.seedBatch.create({
      data: {
        pollinationAttemptId: attempt.id,
        harvestedOn: new Date('2026-09-05'),
        seedCount: 0,
        germinatedCount: 0,
        status: 'FAILED',
      },
    });
    expect(unknown.seedCount).toBeNull();
    expect(zero.seedCount).toBe(0);
  });
});
