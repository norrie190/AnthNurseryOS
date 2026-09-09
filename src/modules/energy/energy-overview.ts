import 'server-only';

import { Prisma } from '../../generated/prisma/client';
import { dateToSql, nurseryToday, sqlToDate } from '../../lib/calendar-date';
import { getPrisma } from '../../lib/prisma';
import {
  formatEnergyKwh,
  formatGbp,
  projectCurrentSettings,
  type PowerHistoryValue,
  type TariffHistoryValue,
} from './energy-calculations';
import { decimalToScaled, formatScaled } from './energy-input';
import { includesDate } from './energy-periods';

export type EnergyOverviewItem = {
  id: string;
  reference: string;
  name: string;
  primaryPhoto: { id: string; derivativeRevision: string | null } | null;
  current: {
    powerWatts: string;
    hoursPerDay: string;
    estimatedKwhPerDay: string;
    estimatedCostPerDay: string | null;
    knownZero: boolean;
  } | null;
  nextSettingFrom: string | null;
};

export type EnergyOverview = {
  today: string;
  equipmentCount: number;
  configuredCount: number;
  archivedOngoingCount: number;
  currentTariff: {
    unitRateMinorPerKwh: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  } | null;
  nextTariff: {
    unitRateMinorPerKwh: string;
    effectiveFrom: string;
  } | null;
  totals: {
    configuredOperatingDrawWatts: string | null;
    estimatedKwhPerDay: string | null;
    estimatedCostPerDay: string | null;
    estimatedCost30Days: string | null;
    estimatedCost365Days: string | null;
    energyCoverageComplete: boolean;
    costCoverageComplete: boolean;
  };
  equipment: EnergyOverviewItem[];
};

const currentOrFuture = (today: string) => ({
  voidedAt: null,
  OR: [{ effectiveTo: null }, { effectiveTo: { gt: dateToSql(today) } }],
});

function powerValue(row: {
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  powerWatts: Prisma.Decimal;
  hoursPerDay: Prisma.Decimal;
}): PowerHistoryValue {
  return {
    id: row.id,
    effectiveFrom: sqlToDate(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? sqlToDate(row.effectiveTo) : null,
    powerWatts: row.powerWatts.toFixed(2),
    hoursPerDay: row.hoursPerDay.toFixed(2),
  };
}

function tariffValue(row: {
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  unitRateMinorPerKwh: Prisma.Decimal;
}): TariffHistoryValue {
  return {
    id: row.id,
    effectiveFrom: sqlToDate(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? sqlToDate(row.effectiveTo) : null,
    unitRateMinorPerKwh: row.unitRateMinorPerKwh.toFixed(5),
  };
}

export async function getEnergyOverview(today = nurseryToday()): Promise<EnergyOverview> {
  return getPrisma().$transaction(
    async (tx) => {
      const equipmentRows = await tx.equipment.findMany({
        where: { archivedAt: null, usesPower: true },
        orderBy: [{ reference: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          reference: true,
          name: true,
          powerPeriods: {
            where: currentOrFuture(today),
            orderBy: [{ effectiveFrom: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              effectiveFrom: true,
              effectiveTo: true,
              powerWatts: true,
              hoursPerDay: true,
            },
          },
          photos: {
            where: { isPrimary: true },
            take: 1,
            select: { id: true, derivativeRevision: true },
          },
        },
      });
      const tariffRows = await tx.electricityTariff.findMany({
        where: currentOrFuture(today),
        orderBy: [{ effectiveFrom: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          effectiveFrom: true,
          effectiveTo: true,
          unitRateMinorPerKwh: true,
        },
      });
      const archivedOngoingCount = await tx.equipment.count({
        where: {
          archivedAt: { not: null },
          powerPeriods: {
            some: {
              voidedAt: null,
              effectiveFrom: { lte: dateToSql(today) },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: dateToSql(today) } }],
            },
          },
        },
      });

      const tariffs = tariffRows.map(tariffValue);
      const currentTariff = tariffs.find((row) => includesDate(row, today)) ?? null;
      const nextTariff = tariffs.find((row) => row.effectiveFrom > today) ?? null;
      let drawScaled = 0n;
      let dailyKwhScaled = 0n;
      let dailyCostScaled = 0n;
      let configuredCount = 0;
      let knownCostCount = 0;

      const equipment = equipmentRows.map<EnergyOverviewItem>((item) => {
        const periods = item.powerPeriods.map(powerValue);
        const current = periods.find((row) => includesDate(row, today)) ?? null;
        const nextSetting = periods.find((row) => row.effectiveFrom > today) ?? null;
        let currentView: EnergyOverviewItem['current'] = null;

        if (current) {
          configuredCount += 1;
          const projection = projectCurrentSettings(current, currentTariff ?? undefined);
          drawScaled += decimalToScaled(projection.configuredOperatingWatts, 2);
          dailyKwhScaled += projection.daily.kwhScaled;
          if (projection.daily.penceScaled !== null) {
            knownCostCount += 1;
            dailyCostScaled += projection.daily.penceScaled;
          }
          currentView = {
            powerWatts: current.powerWatts,
            hoursPerDay: current.hoursPerDay,
            estimatedKwhPerDay: formatEnergyKwh(projection.daily.kwhScaled),
            estimatedCostPerDay:
              projection.daily.penceScaled === null
                ? null
                : formatGbp(projection.daily.penceScaled),
            knownZero: projection.daily.kwhScaled === 0n,
          };
        }

        return {
          id: item.id,
          reference: item.reference,
          name: item.name,
          primaryPhoto: item.photos[0] ?? null,
          current: currentView,
          nextSettingFrom: nextSetting?.effectiveFrom ?? null,
        };
      });

      const hasConfigured = configuredCount > 0;
      const energyCoverageComplete = configuredCount === equipmentRows.length;
      const costCoverageComplete = energyCoverageComplete && knownCostCount === configuredCount;

      return {
        today,
        equipmentCount: equipmentRows.length,
        configuredCount,
        archivedOngoingCount,
        currentTariff: currentTariff
          ? {
              unitRateMinorPerKwh: currentTariff.unitRateMinorPerKwh,
              effectiveFrom: currentTariff.effectiveFrom,
              effectiveTo: currentTariff.effectiveTo,
            }
          : null,
        nextTariff: nextTariff
          ? {
              unitRateMinorPerKwh: nextTariff.unitRateMinorPerKwh,
              effectiveFrom: nextTariff.effectiveFrom,
            }
          : null,
        totals: {
          configuredOperatingDrawWatts: hasConfigured ? formatScaled(drawScaled, 2) : null,
          estimatedKwhPerDay: hasConfigured ? formatEnergyKwh(dailyKwhScaled) : null,
          estimatedCostPerDay: knownCostCount > 0 ? formatGbp(dailyCostScaled) : null,
          estimatedCost30Days: knownCostCount > 0 ? formatGbp(dailyCostScaled * 30n) : null,
          estimatedCost365Days: knownCostCount > 0 ? formatGbp(dailyCostScaled * 365n) : null,
          energyCoverageComplete,
          costCoverageComplete,
        },
        equipment,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
