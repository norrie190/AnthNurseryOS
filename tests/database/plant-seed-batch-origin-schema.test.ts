import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { dateToSql } from '../../src/lib/calendar-date';

vi.mock('server-only', () => ({}));
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: getTestDatabaseUrl(), max: 8 }),
});
const rollback = new Error('Rollback origin relation fixture');

beforeAll(async () => {
  const [target] = await database.$queryRaw<{ name: string }[]>`SELECT current_database() name`;
  expect(target.name).toBe(decodeURIComponent(new URL(getTestDatabaseUrl()).pathname.slice(1)));
});

afterAll(() => database.$disconnect());

test('supports nullable and shared SeedBatch origins with restrictive history semantics', async () => {
  try {
    await database.$transaction(async (tx) => {
      const ordinary = await tx.plant.create({
        data: { reference: `origin-ordinary-${randomUUID()}` },
      });
      expect(ordinary.originSeedBatchId).toBeNull();
      const parent = await tx.plant.create({
        data: { reference: `origin-parent-${randomUUID()}` },
      });
      const inflorescence = await tx.inflorescence.create({
        data: { plantId: parent.id, emergedOn: dateToSql('2026-01-01') },
      });
      const attempt = await tx.pollinationAttempt.create({
        data: {
          inflorescenceId: inflorescence.id,
          pollinatedOn: dateToSql('2026-01-02'),
          pollenSourceMode: 'INTERNAL',
          pollenParentPlantId: parent.id,
        },
      });
      const batch = await tx.seedBatch.create({
        data: { pollinationAttemptId: attempt.id, harvestedOn: dateToSql('2026-01-03') },
      });
      const first = await tx.plant.create({
        data: { reference: `origin-first-${randomUUID()}`, originSeedBatchId: batch.id },
      });
      const second = await tx.plant.create({
        data: { reference: `origin-second-${randomUUID()}`, originSeedBatchId: batch.id },
      });

      expect(await tx.plant.count({ where: { originSeedBatchId: batch.id } })).toBe(2);
      expect(
        (
          await tx.seedBatch.findUniqueOrThrow({
            where: { id: batch.id },
            include: { promotedPlants: true },
          })
        ).promotedPlants
          .map((plant) => plant.id)
          .sort(),
      ).toEqual([first.id, second.id].sort());
      await tx.plantParentage.create({ data: { plantId: first.id, seedParentPlantId: parent.id } });
      await tx.plant.update({
        where: { id: first.id },
        data: { status: 'SOLD', archivedAt: new Date() },
      });
      expect(
        (await tx.plant.findUniqueOrThrow({ where: { id: first.id } })).originSeedBatchId,
      ).toBe(batch.id);

      await expect(
        tx.plant.create({
          data: { reference: `origin-invalid-${randomUUID()}`, originSeedBatchId: randomUUID() },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
      await expect(tx.seedBatch.delete({ where: { id: batch.id } })).rejects.toMatchObject({
        code: expect.stringMatching(/^P20(?:03|39)$/),
      });
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});
