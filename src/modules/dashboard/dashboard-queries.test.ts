import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';

const { getPrismaMock } = vi.hoisted(() => ({ getPrismaMock: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('../../lib/prisma', () => ({ getPrisma: getPrismaMock }));

import { getDashboardSummary } from './dashboard-queries';

describe('getDashboardSummary query plan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses one Repeatable Read transaction with fixed, minimal batched reads', async () => {
    const plantFindMany = vi
      .fn()
      .mockResolvedValueOnce([{ status: 'GROWING', archivedAt: null, purchase: null }])
      .mockResolvedValueOnce([
        {
          id: 'plant-1',
          reference: 'ANT-0001',
          name: null,
          createdAt: new Date('2026-08-01T10:00:00.000Z'),
          photos: [{ id: 'plant-photo-1', derivativeRevision: 'revision-1' }],
        },
      ]);
    const equipmentFindMany = vi
      .fn()
      .mockResolvedValueOnce([
        {
          usesPower: true,
          archivedAt: null,
          purchase: null,
          powerPeriods: [
            {
              id: 'period-1',
              effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
              effectiveTo: null,
              powerWatts: new Prisma.Decimal('100.00'),
              hoursPerDay: new Prisma.Decimal('12.00'),
            },
          ],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'equipment-1',
          reference: 'EQP-0001',
          name: 'Grow light',
          createdAt: new Date('2026-08-01T10:00:00.000Z'),
          photos: [{ id: 'equipment-photo-1', derivativeRevision: null }],
        },
      ]);
    const tariffFindFirst = vi.fn().mockResolvedValue({
      id: 'tariff-1',
      currency: 'GBP',
      unitRateMinorPerKwh: new Prisma.Decimal('25.00000'),
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
    });
    const tx = {
      plant: { findMany: plantFindMany },
      equipment: { findMany: equipmentFindMany },
      electricityTariff: { findFirst: tariffFindFirst },
    };
    const transaction = vi.fn(async (operation, options) => {
      expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return operation(tx);
    });
    getPrismaMock.mockReturnValue({ $transaction: transaction });

    const result = await getDashboardSummary('2026-08-15');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(plantFindMany).toHaveBeenCalledTimes(2);
    expect(equipmentFindMany).toHaveBeenCalledTimes(2);
    expect(tariffFindFirst).toHaveBeenCalledTimes(1);
    const equipmentSummaryQuery = equipmentFindMany.mock.calls[0]?.[0];
    expect(equipmentSummaryQuery.select.powerPeriods).toMatchObject({
      where: {
        voidedAt: null,
        effectiveFrom: { lte: new Date('2026-08-15T00:00:00.000Z') },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date('2026-08-15T00:00:00.000Z') } }],
      },
      take: 1,
      select: {
        id: true,
        effectiveFrom: true,
        effectiveTo: true,
        powerWatts: true,
        hoursPerDay: true,
      },
    });
    expect(tariffFindFirst.mock.calls[0]?.[0].select).toEqual({
      id: true,
      currency: true,
      unitRateMinorPerKwh: true,
      effectiveFrom: true,
    });
    for (const recentQuery of [
      plantFindMany.mock.calls[1]?.[0],
      equipmentFindMany.mock.calls[1]?.[0],
    ]) {
      expect(recentQuery).toMatchObject({
        where: { archivedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 4,
      });
      expect(recentQuery.select.photos).toMatchObject({
        where: { isPrimary: true },
        take: 1,
        select: { id: true, derivativeRevision: true },
      });
      expect(recentQuery.select.photos.select).not.toHaveProperty('storageKey');
    }
    expect(result.recentlyAdded.plants[0]).toMatchObject({
      displayName: 'Unnamed Plant',
      primaryPhoto: { id: 'plant-photo-1', derivativeRevision: 'revision-1' },
    });
    expect(result.energy.estimatedKwh?.daily).toBe('1.2000000');
  });
});
