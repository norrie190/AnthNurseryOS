// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Prisma } from '../../src/generated/prisma/client';
import { getPrisma } from '../../src/lib/prisma';
import { getWateringQueue } from '../../src/modules/watering/watering-queue-queries';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: vi.fn() }));

describe('watering queue query architecture', () => {
  beforeEach(() => vi.resetAllMocks());
  test('uses one Repeatable Read transaction and three fixed reads', async () => {
    const plants = [
      {
        id: 'p',
        reference: 'ANT-0001',
        name: null,
        status: 'GROWING' as const,
        location: null,
        photos: [],
      },
    ];
    const tx = {
      plant: { findMany: vi.fn().mockResolvedValue(plants) },
      wateringSchedulePeriod: { findMany: vi.fn().mockResolvedValue([]) },
      wateringEvent: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const transaction = vi.fn(async (callback) => callback(tx));
    vi.mocked(getPrisma).mockReturnValue({ $transaction: transaction } as never);
    const result = await getWateringQueue('2026-09-03');
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(tx.plant.findMany).toHaveBeenCalledOnce();
    expect(tx.wateringSchedulePeriod.findMany).toHaveBeenCalledOnce();
    expect(tx.wateringEvent.findMany).toHaveBeenCalledOnce();
    expect(result.counts).toMatchObject({ totalEligible: 1, notConfigured: 1 });
  });

  test('batches due inputs and returns only minimal location/photo metadata', async () => {
    const plants = [
      {
        id: 'p1',
        reference: 'ANT-0002',
        name: 'Aloe',
        status: 'GROWING' as const,
        location: { id: 'loc', name: 'Shelf A' },
        photos: [{ id: 'photo', derivativeRevision: 'r3' }],
      },
      {
        id: 'p2',
        reference: 'ANT-0003',
        name: null,
        status: 'QUARANTINE' as const,
        location: null,
        photos: [],
      },
    ];
    const tx = {
      plant: { findMany: vi.fn().mockResolvedValue(plants) },
      wateringSchedulePeriod: {
        findMany: vi.fn().mockResolvedValue([{ plantId: 'p1', intervalDays: 7 }]),
      },
      wateringEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            plantId: 'p1',
            wateredAt: new Date('2026-09-01T09:00:00.000Z'),
            voidedAt: null,
            createdAt: new Date('2026-09-01T09:00:00.000Z'),
            id: 'event',
          },
        ]),
      },
    };
    vi.mocked(getPrisma).mockReturnValue({
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as never);

    const result = await getWateringQueue('2026-09-03');
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({
      plant: {
        id: 'p1',
        location: { id: 'loc', name: 'Shelf A' },
        primaryPhoto: { id: 'photo', derivativeRevision: 'r3' },
      },
      due: { status: 'UPCOMING' },
    });
    expect(result.entries[1]).toMatchObject({
      plant: { id: 'p2', reference: 'ANT-0003', location: null, primaryPhoto: null },
      due: { status: 'NOT_CONFIGURED' },
    });
    expect(result.counts).toEqual({
      totalEligible: 2,
      overdue: 0,
      dueToday: 0,
      dueSoon: 0,
      needsFirstWatering: 0,
      upcoming: 1,
      notConfigured: 1,
    });
    expect(tx.wateringSchedulePeriod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ voidedAt: null }) }),
    );
    expect(tx.wateringEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ voidedAt: null }) }),
    );
  });
});
