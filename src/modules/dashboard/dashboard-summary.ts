import {
  formatEnergyKwh,
  projectCurrentSettings,
  type PowerHistoryValue,
  type TariffHistoryValue,
} from '../energy/energy-calculations';
import { decimalToScaled, formatScaled } from '../energy/energy-input';

export type DashboardPlantStatus = 'GROWING' | 'QUARANTINE' | 'SOLD' | 'DECEASED';

export type DashboardPurchase = {
  currency: string;
  itemPriceMinor: number | null;
  shippingCostMinor: number | null;
  otherCostMinor: number | null;
};

export type DashboardPlantInput = {
  archivedAt: Date | null;
  status: DashboardPlantStatus;
  purchase: DashboardPurchase | null;
};

export type DashboardEquipmentInput = {
  archivedAt: Date | null;
  usesPower: boolean;
  purchase: DashboardPurchase | null;
  currentPowerPeriod: PowerHistoryValue | null;
};

export type DashboardCurrentTariff = {
  id: string;
  currency: string;
  unitRateMinorPerKwh: string;
  effectiveFrom: string;
};

export type DashboardRecentPlant = {
  id: string;
  reference: string;
  name: string | null;
  displayName: string;
  createdAt: Date;
  primaryPhoto: {
    id: string;
    derivativeRevision: string | null;
  } | null;
};

export type DashboardRecentEquipment = {
  id: string;
  reference: string;
  name: string;
  createdAt: Date;
  primaryPhoto: {
    id: string;
    derivativeRevision: string | null;
  } | null;
};

export type DashboardWateringAttention = {
  id: string;
  reference: string;
  displayName: string;
  status: 'OVERDUE' | 'DUE_TODAY' | 'NEEDS_FIRST_WATERING';
  daysUntilDue: number | null;
  nextDueDate: string | null;
  location: { id: string; name: string } | null;
  primaryPhoto: { id: string; derivativeRevision: string | null } | null;
};

export type DashboardWateringInput = {
  totalEligible: number;
  overdue: number;
  dueToday: number;
  needsFirstWatering: number;
  dueSoon: number;
  upcoming: number;
  notConfigured: number;
  attention: DashboardWateringAttention[];
};

const emptyWatering: DashboardWateringInput = {
  totalEligible: 0,
  overdue: 0,
  dueToday: 0,
  needsFirstWatering: 0,
  dueSoon: 0,
  upcoming: 0,
  notConfigured: 0,
  attention: [],
};

export type InvestmentCurrencySummary = {
  currency: string;
  knownItemPriceSubtotalMinor: number | null;
  knownAllocatedShippingSubtotalMinor: number | null;
  knownOtherCostSubtotalMinor: number | null;
  knownSpendSubtotalMinor: number | null;
  relevantRecordCount: number;
  completeCostRecordCount: number;
  coverageComplete: boolean;
};

export type InvestmentDomainSummary = {
  relevantRecordCount: number;
  completeCostRecordCount: number;
  unknownCurrencyRecordCount: number;
  coverageComplete: boolean;
  byCurrency: InvestmentCurrencySummary[];
};

export type DashboardSummary = {
  watering?: DashboardWateringInput;
  plants: {
    activeCount: number;
    growingCount: number;
    quarantineCount: number;
    soldCount: number;
    deceasedCount: number;
    archivedCount: number;
  };
  equipment: {
    activeCount: number;
    activeUsesPowerCount: number;
    activeDoesNotUsePowerCount: number;
    archivedCount: number;
  };
  investment: {
    plants: InvestmentDomainSummary;
    equipment: InvestmentDomainSummary;
    combinedByCurrency: InvestmentCurrencySummary[];
  };
  energy: {
    basis: 'Projection from current settings and rate; not measured consumption';
    activePoweredEquipmentCount: number;
    activePoweredEquipmentConfiguredTodayCount: number;
    archivedEquipmentWithOngoingSettingsTodayCount: number;
    configuredOperatingDrawWatts: string | null;
    estimatedKwh: {
      daily: string;
      days30: string;
      days365: string;
    } | null;
    knownEstimatedVariableCostPence: {
      daily: string;
      days30: string;
      days365: string;
    } | null;
    configurationCoverage: {
      relevantEquipmentCount: number;
      configuredEquipmentCount: number;
      complete: boolean;
    };
    costCoverage: {
      relevantEquipmentCount: number;
      knownCostEquipmentCount: number;
      complete: boolean;
    };
    currentTariff: DashboardCurrentTariff | null;
  };
  recentlyAdded: {
    plants: DashboardRecentPlant[];
    equipment: DashboardRecentEquipment[];
  };
};

type InvestmentAccumulator = {
  currency: string;
  itemPriceMinor: number;
  hasItemPrice: boolean;
  shippingCostMinor: number;
  hasShippingCost: boolean;
  otherCostMinor: number;
  hasOtherCost: boolean;
  knownSpendMinor: number;
  hasKnownSpend: boolean;
  relevantRecordCount: number;
  completeCostRecordCount: number;
};

function addKnown(
  accumulator: InvestmentAccumulator,
  field: 'itemPriceMinor' | 'shippingCostMinor' | 'otherCostMinor',
  hasField: 'hasItemPrice' | 'hasShippingCost' | 'hasOtherCost',
  value: number | null,
) {
  if (value === null) return;
  accumulator[field] += value;
  accumulator[hasField] = true;
  accumulator.knownSpendMinor += value;
  accumulator.hasKnownSpend = true;
}

function finishInvestmentCurrency(accumulator: InvestmentAccumulator): InvestmentCurrencySummary {
  return {
    currency: accumulator.currency,
    knownItemPriceSubtotalMinor: accumulator.hasItemPrice ? accumulator.itemPriceMinor : null,
    knownAllocatedShippingSubtotalMinor: accumulator.hasShippingCost
      ? accumulator.shippingCostMinor
      : null,
    knownOtherCostSubtotalMinor: accumulator.hasOtherCost ? accumulator.otherCostMinor : null,
    knownSpendSubtotalMinor: accumulator.hasKnownSpend ? accumulator.knownSpendMinor : null,
    relevantRecordCount: accumulator.relevantRecordCount,
    completeCostRecordCount: accumulator.completeCostRecordCount,
    coverageComplete: accumulator.completeCostRecordCount === accumulator.relevantRecordCount,
  };
}

function summarizeInvestment(
  records: readonly { purchase: DashboardPurchase | null }[],
): InvestmentDomainSummary {
  const groups = new Map<string, InvestmentAccumulator>();
  let completeCostRecordCount = 0;
  let unknownCurrencyRecordCount = 0;

  for (const record of records) {
    const purchase = record.purchase;
    if (!purchase) {
      unknownCurrencyRecordCount += 1;
      continue;
    }

    const complete =
      purchase.itemPriceMinor !== null &&
      purchase.shippingCostMinor !== null &&
      purchase.otherCostMinor !== null;
    if (complete) completeCostRecordCount += 1;

    const accumulator = groups.get(purchase.currency) ?? {
      currency: purchase.currency,
      itemPriceMinor: 0,
      hasItemPrice: false,
      shippingCostMinor: 0,
      hasShippingCost: false,
      otherCostMinor: 0,
      hasOtherCost: false,
      knownSpendMinor: 0,
      hasKnownSpend: false,
      relevantRecordCount: 0,
      completeCostRecordCount: 0,
    };
    accumulator.relevantRecordCount += 1;
    if (complete) accumulator.completeCostRecordCount += 1;
    addKnown(accumulator, 'itemPriceMinor', 'hasItemPrice', purchase.itemPriceMinor);
    addKnown(accumulator, 'shippingCostMinor', 'hasShippingCost', purchase.shippingCostMinor);
    addKnown(accumulator, 'otherCostMinor', 'hasOtherCost', purchase.otherCostMinor);
    groups.set(purchase.currency, accumulator);
  }

  return {
    relevantRecordCount: records.length,
    completeCostRecordCount,
    unknownCurrencyRecordCount,
    coverageComplete: completeCostRecordCount === records.length,
    byCurrency: [...groups.values()]
      .sort((left, right) => left.currency.localeCompare(right.currency))
      .map(finishInvestmentCurrency),
  };
}

function combineInvestmentCurrencies(
  plants: InvestmentDomainSummary,
  equipment: InvestmentDomainSummary,
): InvestmentCurrencySummary[] {
  const groups = new Map<string, InvestmentAccumulator>();

  for (const summary of [...plants.byCurrency, ...equipment.byCurrency]) {
    const accumulator = groups.get(summary.currency) ?? {
      currency: summary.currency,
      itemPriceMinor: 0,
      hasItemPrice: false,
      shippingCostMinor: 0,
      hasShippingCost: false,
      otherCostMinor: 0,
      hasOtherCost: false,
      knownSpendMinor: 0,
      hasKnownSpend: false,
      relevantRecordCount: 0,
      completeCostRecordCount: 0,
    };
    addKnown(accumulator, 'itemPriceMinor', 'hasItemPrice', summary.knownItemPriceSubtotalMinor);
    addKnown(
      accumulator,
      'shippingCostMinor',
      'hasShippingCost',
      summary.knownAllocatedShippingSubtotalMinor,
    );
    addKnown(accumulator, 'otherCostMinor', 'hasOtherCost', summary.knownOtherCostSubtotalMinor);
    accumulator.relevantRecordCount += summary.relevantRecordCount;
    accumulator.completeCostRecordCount += summary.completeCostRecordCount;
    groups.set(summary.currency, accumulator);
  }

  return [...groups.values()]
    .sort((left, right) => left.currency.localeCompare(right.currency))
    .map(finishInvestmentCurrency);
}

function summarizeEnergy(
  equipment: readonly DashboardEquipmentInput[],
  currentTariff: DashboardCurrentTariff | null,
): DashboardSummary['energy'] {
  const activePowered = equipment.filter((item) => item.archivedAt === null && item.usesPower);
  const configured = activePowered.filter(
    (item): item is DashboardEquipmentInput & { currentPowerPeriod: PowerHistoryValue } =>
      item.currentPowerPeriod !== null,
  );
  const tariff: TariffHistoryValue | undefined = currentTariff
    ? {
        id: currentTariff.id,
        effectiveFrom: currentTariff.effectiveFrom,
        effectiveTo: null,
        unitRateMinorPerKwh: currentTariff.unitRateMinorPerKwh,
      }
    : undefined;
  const projections = configured.map((item) =>
    projectCurrentSettings(item.currentPowerPeriod, tariff),
  );
  const activePoweredEquipmentCount = activePowered.length;
  const hasEstimate = projections.length > 0;
  const sumProjection = (
    period: 'daily' | 'days30' | 'days365',
    field: 'kwhScaled' | 'penceScaled',
  ) =>
    projections.reduce<bigint | null>((sum, projection) => {
      const value = projection[period][field];
      if (value === null) return sum;
      return (sum ?? 0n) + value;
    }, null);
  const knownCostEquipmentCount = projections.filter(
    (projection) => projection.daily.penceScaled !== null,
  ).length;
  const configuredOperatingWatts = hasEstimate
    ? formatScaled(
        projections.reduce(
          (sum, projection) => sum + decimalToScaled(projection.configuredOperatingWatts, 2),
          0n,
        ),
        2,
      )
    : null;
  const kwhDaily = sumProjection('daily', 'kwhScaled');
  const kwhDays30 = sumProjection('days30', 'kwhScaled');
  const kwhDays365 = sumProjection('days365', 'kwhScaled');
  const costDaily = sumProjection('daily', 'penceScaled');
  const costDays30 = sumProjection('days30', 'penceScaled');
  const costDays365 = sumProjection('days365', 'penceScaled');

  return {
    basis: 'Projection from current settings and rate; not measured consumption',
    activePoweredEquipmentCount,
    activePoweredEquipmentConfiguredTodayCount: configured.length,
    archivedEquipmentWithOngoingSettingsTodayCount: equipment.filter(
      (item) => item.archivedAt !== null && item.currentPowerPeriod !== null,
    ).length,
    configuredOperatingDrawWatts: configuredOperatingWatts,
    estimatedKwh:
      kwhDaily !== null && kwhDays30 !== null && kwhDays365 !== null
        ? {
            daily: formatEnergyKwh(kwhDaily),
            days30: formatEnergyKwh(kwhDays30),
            days365: formatEnergyKwh(kwhDays365),
          }
        : null,
    knownEstimatedVariableCostPence:
      costDaily !== null && costDays30 !== null && costDays365 !== null
        ? {
            daily: formatScaled(costDaily, 12),
            days30: formatScaled(costDays30, 12),
            days365: formatScaled(costDays365, 12),
          }
        : null,
    configurationCoverage: {
      relevantEquipmentCount: activePoweredEquipmentCount,
      configuredEquipmentCount: configured.length,
      complete: configured.length === activePoweredEquipmentCount,
    },
    costCoverage: {
      relevantEquipmentCount: activePoweredEquipmentCount,
      knownCostEquipmentCount,
      complete: knownCostEquipmentCount === activePoweredEquipmentCount,
    },
    currentTariff,
  };
}

export function buildDashboardSummary(input: {
  plants: readonly DashboardPlantInput[];
  equipment: readonly DashboardEquipmentInput[];
  currentTariff: DashboardCurrentTariff | null;
  recentPlants: readonly DashboardRecentPlant[];
  recentEquipment: readonly DashboardRecentEquipment[];
  watering?: DashboardWateringInput;
}): DashboardSummary {
  const activePlants = input.plants.filter((plant) => plant.archivedAt === null);
  const activeEquipment = input.equipment.filter((item) => item.archivedAt === null);
  const plantInvestment = summarizeInvestment(input.plants);
  const equipmentInvestment = summarizeInvestment(input.equipment);

  return {
    watering: input.watering ?? emptyWatering,
    plants: {
      activeCount: activePlants.length,
      growingCount: activePlants.filter((plant) => plant.status === 'GROWING').length,
      quarantineCount: activePlants.filter((plant) => plant.status === 'QUARANTINE').length,
      soldCount: activePlants.filter((plant) => plant.status === 'SOLD').length,
      deceasedCount: activePlants.filter((plant) => plant.status === 'DECEASED').length,
      archivedCount: input.plants.length - activePlants.length,
    },
    equipment: {
      activeCount: activeEquipment.length,
      activeUsesPowerCount: activeEquipment.filter((item) => item.usesPower).length,
      activeDoesNotUsePowerCount: activeEquipment.filter((item) => !item.usesPower).length,
      archivedCount: input.equipment.length - activeEquipment.length,
    },
    investment: {
      plants: plantInvestment,
      equipment: equipmentInvestment,
      combinedByCurrency: combineInvestmentCurrencies(plantInvestment, equipmentInvestment),
    },
    energy: summarizeEnergy(input.equipment, input.currentTariff),
    recentlyAdded: {
      plants: input.recentPlants.slice(0, 4),
      equipment: input.recentEquipment.slice(0, 4),
    },
  };
}
