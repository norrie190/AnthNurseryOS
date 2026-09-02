import { describe, expect, it } from 'vitest';
import {
  buildDashboardSummary,
  type DashboardCurrentTariff,
  type DashboardEquipmentInput,
  type DashboardPlantInput,
  type DashboardRecentEquipment,
  type DashboardRecentPlant,
} from './dashboard-summary';

const archivedAt = new Date('2026-01-01T00:00:00.000Z');

function plant(
  status: DashboardPlantInput['status'] = 'GROWING',
  overrides: Partial<DashboardPlantInput> = {},
): DashboardPlantInput {
  return { status, archivedAt: null, purchase: null, ...overrides };
}

function equipment(overrides: Partial<DashboardEquipmentInput> = {}): DashboardEquipmentInput {
  return {
    archivedAt: null,
    usesPower: false,
    purchase: null,
    currentPowerPeriod: null,
    ...overrides,
  };
}

function power(powerWatts: string, hoursPerDay: string) {
  return {
    id: 'power-' + powerWatts + '-' + hoursPerDay,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    powerWatts,
    hoursPerDay,
    voidedAt: null,
  };
}

const tariff: DashboardCurrentTariff = {
  id: 'tariff-1',
  currency: 'GBP',
  unitRateMinorPerKwh: '25.00000',
  effectiveFrom: '2026-01-01',
};

function summary(
  overrides: {
    plants?: DashboardPlantInput[];
    equipment?: DashboardEquipmentInput[];
    currentTariff?: DashboardCurrentTariff | null;
    recentPlants?: DashboardRecentPlant[];
    recentEquipment?: DashboardRecentEquipment[];
  } = {},
) {
  return buildDashboardSummary({
    plants: overrides.plants ?? [],
    equipment: overrides.equipment ?? [],
    currentTariff: overrides.currentTariff ?? null,
    recentPlants: overrides.recentPlants ?? [],
    recentEquipment: overrides.recentEquipment ?? [],
  });
}

describe('buildDashboardSummary', () => {
  it('represents an empty dashboard without inventing spend or energy', () => {
    const result = summary();

    expect(result.plants).toEqual({
      activeCount: 0,
      growingCount: 0,
      quarantineCount: 0,
      soldCount: 0,
      deceasedCount: 0,
      archivedCount: 0,
    });
    expect(result.equipment).toEqual({
      activeCount: 0,
      activeUsesPowerCount: 0,
      activeDoesNotUsePowerCount: 0,
      archivedCount: 0,
    });
    expect(result.investment.plants).toEqual({
      relevantRecordCount: 0,
      completeCostRecordCount: 0,
      unknownCurrencyRecordCount: 0,
      coverageComplete: true,
      byCurrency: [],
    });
    expect(result.investment.combinedByCurrency).toEqual([]);
    expect(result.energy).toMatchObject({
      activePoweredEquipmentCount: 0,
      activePoweredEquipmentConfiguredTodayCount: 0,
      archivedEquipmentWithOngoingSettingsTodayCount: 0,
      configuredOperatingDrawWatts: null,
      estimatedKwh: null,
      knownEstimatedVariableCostPence: null,
      configurationCoverage: {
        relevantEquipmentCount: 0,
        configuredEquipmentCount: 0,
        complete: true,
      },
      costCoverage: { relevantEquipmentCount: 0, knownCostEquipmentCount: 0, complete: true },
      currentTariff: null,
    });
  });

  it('counts active plant statuses and keeps archived plants separate', () => {
    const result = summary({
      plants: [
        plant('GROWING'),
        plant('QUARANTINE'),
        plant('SOLD'),
        plant('DECEASED'),
        plant('GROWING', { archivedAt }),
        plant('SOLD', { archivedAt }),
      ],
    });

    expect(result.plants).toEqual({
      activeCount: 4,
      growingCount: 1,
      quarantineCount: 1,
      soldCount: 1,
      deceasedCount: 1,
      archivedCount: 2,
    });
  });

  it('counts active and archived equipment and power capability', () => {
    const result = summary({
      equipment: [
        equipment({ usesPower: true }),
        equipment({ usesPower: false }),
        equipment({ archivedAt, usesPower: true }),
      ],
    });

    expect(result.equipment).toEqual({
      activeCount: 2,
      activeUsesPowerCount: 1,
      activeDoesNotUsePowerCount: 1,
      archivedCount: 1,
    });
  });

  it('preserves null versus zero and includes archived acquisition spend', () => {
    const result = summary({
      plants: [
        plant(),
        plant('GROWING', {
          purchase: {
            currency: 'GBP',
            itemPriceMinor: 100,
            shippingCostMinor: null,
            otherCostMinor: 0,
          },
        }),
        plant('SOLD', {
          archivedAt,
          purchase: {
            currency: 'GBP',
            itemPriceMinor: 200,
            shippingCostMinor: 20,
            otherCostMinor: 5,
          },
        }),
      ],
    });

    expect(result.investment.plants).toEqual({
      relevantRecordCount: 3,
      completeCostRecordCount: 1,
      unknownCurrencyRecordCount: 1,
      coverageComplete: false,
      byCurrency: [
        {
          currency: 'GBP',
          knownItemPriceSubtotalMinor: 300,
          knownAllocatedShippingSubtotalMinor: 20,
          knownOtherCostSubtotalMinor: 5,
          knownSpendSubtotalMinor: 325,
          relevantRecordCount: 2,
          completeCostRecordCount: 1,
          coverageComplete: false,
        },
      ],
    });
  });

  it('combines only matching currencies and exposes no cross-currency total', () => {
    const completePurchase = (currency: string, itemPriceMinor: number) => ({
      currency,
      itemPriceMinor,
      shippingCostMinor: 0,
      otherCostMinor: 0,
    });
    const result = summary({
      plants: [
        plant('GROWING', { purchase: completePurchase('GBP', 100) }),
        plant('GROWING', { purchase: completePurchase('EUR', 250) }),
      ],
      equipment: [
        equipment({ purchase: completePurchase('GBP', 300) }),
        equipment({ purchase: completePurchase('USD', 400) }),
      ],
    });

    expect(result.investment.combinedByCurrency).toEqual([
      expect.objectContaining({
        currency: 'EUR',
        knownSpendSubtotalMinor: 250,
        relevantRecordCount: 1,
      }),
      expect.objectContaining({
        currency: 'GBP',
        knownSpendSubtotalMinor: 400,
        relevantRecordCount: 2,
      }),
      expect.objectContaining({
        currency: 'USD',
        knownSpendSubtotalMinor: 400,
        relevantRecordCount: 1,
      }),
    ]);
    expect(result.investment).not.toHaveProperty('grandTotal');
  });

  it('projects complete current energy through the established calculator', () => {
    const result = summary({
      equipment: [equipment({ usesPower: true, currentPowerPeriod: power('100.00', '12.00') })],
      currentTariff: tariff,
    });

    expect(result.energy).toEqual({
      basis: 'Projection from current settings and rate; not measured consumption',
      activePoweredEquipmentCount: 1,
      activePoweredEquipmentConfiguredTodayCount: 1,
      archivedEquipmentWithOngoingSettingsTodayCount: 0,
      configuredOperatingDrawWatts: '100.00',
      estimatedKwh: { daily: '1.2000000', days30: '36.0000000', days365: '438.0000000' },
      knownEstimatedVariableCostPence: {
        daily: '30.000000000000',
        days30: '900.000000000000',
        days365: '10950.000000000000',
      },
      configurationCoverage: {
        relevantEquipmentCount: 1,
        configuredEquipmentCount: 1,
        complete: true,
      },
      costCoverage: { relevantEquipmentCount: 1, knownCostEquipmentCount: 1, complete: true },
      currentTariff: tariff,
    });
  });

  it('keeps mixed configuration coverage and archived ongoing settings distinct', () => {
    const result = summary({
      equipment: [
        equipment({ usesPower: true, currentPowerPeriod: power('10.00', '2.00') }),
        equipment({ usesPower: true }),
        equipment({ usesPower: true, archivedAt, currentPowerPeriod: power('500.00', '24.00') }),
      ],
      currentTariff: tariff,
    });

    expect(result.energy.activePoweredEquipmentCount).toBe(2);
    expect(result.energy.activePoweredEquipmentConfiguredTodayCount).toBe(1);
    expect(result.energy.archivedEquipmentWithOngoingSettingsTodayCount).toBe(1);
    expect(result.energy.configuredOperatingDrawWatts).toBe('10.00');
    expect(result.energy.configurationCoverage).toEqual({
      relevantEquipmentCount: 2,
      configuredEquipmentCount: 1,
      complete: false,
    });
    expect(result.energy.costCoverage.complete).toBe(false);
  });

  it('keeps positive energy cost unknown without a tariff', () => {
    const result = summary({
      equipment: [equipment({ usesPower: true, currentPowerPeriod: power('50.00', '4.00') })],
    });

    expect(result.energy.estimatedKwh?.daily).toBe('0.2000000');
    expect(result.energy.knownEstimatedVariableCostPence).toBeNull();
    expect(result.energy.costCoverage).toEqual({
      relevantEquipmentCount: 1,
      knownCostEquipmentCount: 0,
      complete: false,
    });
  });

  it.each([
    ['zero watts', '0.00', '12.00'],
    ['zero hours', '100.00', '0.00'],
  ])('keeps %s as known zero even without a tariff', (_label, watts, hours) => {
    const result = summary({
      equipment: [equipment({ usesPower: true, currentPowerPeriod: power(watts, hours) })],
    });

    expect(result.energy.estimatedKwh?.daily).toBe('0.0000000');
    expect(result.energy.knownEstimatedVariableCostPence?.daily).toBe('0.000000000000');
    expect(result.energy.costCoverage.complete).toBe(true);
  });

  it('accepts an explicit zero tariff as known zero cost', () => {
    const result = summary({
      equipment: [equipment({ usesPower: true, currentPowerPeriod: power('100.00', '1.00') })],
      currentTariff: { ...tariff, unitRateMinorPerKwh: '0.00000' },
    });

    expect(result.energy.knownEstimatedVariableCostPence?.daily).toBe('0.000000000000');
    expect(result.energy.costCoverage.complete).toBe(true);
  });

  it('limits recent items to four while retaining only supplied display metadata', () => {
    const at = (day: number) =>
      new Date('2026-02-' + String(day).padStart(2, '0') + 'T12:00:00.000Z');
    const recentPlants = Array.from({ length: 5 }, (_, index): DashboardRecentPlant => ({
      id: 'plant-' + index,
      reference: 'ANT-' + index,
      name: index === 0 ? null : 'Plant ' + index,
      displayName: index === 0 ? 'Unnamed Plant' : 'Plant ' + index,
      createdAt: at(10 - index),
      primaryPhoto: index === 0 ? { id: 'photo-1', derivativeRevision: 'rev-1' } : null,
    }));
    const recentEquipment = Array.from({ length: 5 }, (_, index): DashboardRecentEquipment => ({
      id: 'equipment-' + index,
      reference: 'EQP-' + index,
      name: 'Equipment ' + index,
      createdAt: at(10 - index),
      primaryPhoto: index === 0 ? { id: 'equipment-photo-1', derivativeRevision: null } : null,
    }));
    const result = summary({ recentPlants, recentEquipment });

    expect(result.recentlyAdded.plants).toHaveLength(4);
    expect(result.recentlyAdded.equipment).toHaveLength(4);
    expect(result.recentlyAdded.plants[0]).toEqual(recentPlants[0]);
    expect(result.recentlyAdded.equipment[0]).toEqual(recentEquipment[0]);
  });
});
