// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { getPrisma } from '../../lib/prisma';
import { getPlantWateringDetail } from './watering-schedule-queries';

vi.mock('server-only', () => ({}));
vi.mock('../../lib/prisma', () => ({ getPrisma: vi.fn() }));

const plantId = '12345678-1234-4234-8234-123456789abc';
const stamp = new Date('2026-09-01T08:00:00.000Z');
const plant = {
  id: plantId,
  reference: 'ANT-0001',
  name: null,
  status: 'GROWING' as const,
  archivedAt: null,
};
const schedule = {
  id: 'period',
  plantId,
  intervalDays: 7,
  effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
  effectiveTo: null,
  notes: null,
  voidedAt: null,
  correctionReason: null,
  createdAt: stamp,
  updatedAt: stamp,
};
const event = {
  id: 'event',
  plantId,
  wateredAt: stamp,
  notes: null,
  voidedAt: null,
  correctionReason: null,
  createdAt: stamp,
  updatedAt: stamp,
};

beforeEach(() => vi.resetAllMocks());

test('Plant detail coordination uses one Repeatable Read snapshot and fixed batched reads', async () => {
  const tx = {
    plant: { findUnique: vi.fn().mockResolvedValue(plant) },
    wateringSchedulePeriod: {
      findFirst: vi.fn().mockResolvedValue(schedule),
      findMany: vi.fn().mockResolvedValue([schedule]),
    },
    wateringEvent: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: event.id, wateredAt: event.wateredAt, updatedAt: stamp }),
      findMany: vi.fn().mockResolvedValue([event]),
    },
  };
  const transaction = vi.fn(async (callback) => callback(tx));
  vi.mocked(getPrisma).mockReturnValue({ $transaction: transaction } as never);

  const result = await getPlantWateringDetail(plantId, '2026-09-03');

  expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
  expect(tx.plant.findUnique).toHaveBeenCalledOnce();
  expect(tx.wateringSchedulePeriod.findFirst).toHaveBeenCalledOnce();
  expect(tx.wateringSchedulePeriod.findMany).toHaveBeenCalledOnce();
  expect(tx.wateringEvent.findFirst).toHaveBeenCalledOnce();
  expect(tx.wateringEvent.findMany).toHaveBeenCalledOnce();
  expect(result).toMatchObject({
    plant: { activeCareEligible: true },
    due: { status: 'UPCOMING', nextDueDate: '2026-09-08', daysUntilDue: 5 },
    events: [event],
    periods: [schedule],
  });
  expect(Object.keys(tx.plant)).toEqual(['findUnique']);
});
