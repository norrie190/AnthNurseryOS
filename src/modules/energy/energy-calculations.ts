import { calendarOrdinal } from '../../lib/calendar-date';
import {
  decimalToScaled,
  formatScaled,
  hoursPerDaySchema,
  parseEnergy,
  powerWattsSchema,
  reportRangeSchema,
  tariffRateSchema,
  type ReportRange,
} from './energy-input';
import { includesDate, validateTimeline, type EnergyInterval } from './energy-periods';

export type PowerHistoryValue = EnergyInterval & {
  powerWatts: string;
  hoursPerDay: string;
  voidedAt?: string | null;
};
export type TariffHistoryValue = EnergyInterval & {
  unitRateMinorPerKwh: string;
  voidedAt?: string | null;
};
// kWh numerator / 10^7; pence numerator / 10^12. No rounding within the engine.
export type ExactEnergy = { kwhScaled: bigint; penceScaled: bigint };
export type EnergySegment = ReportRange & {
  days: number;
  powerPeriodId: string | null;
  tariffId: string | null;
  kwhScaled: bigint | null;
  penceScaled: bigint | null;
};
export type EnergyReport = {
  range: ReportRange;
  applicable: boolean;
  knownSubtotal: ExactEnergy;
  energyComplete: boolean;
  costComplete: boolean;
  missingPower: ReportRange[];
  missingTariff: ReportRange[];
  missingCost: ReportRange[];
  segments: EnergySegment[];
};
function appendRange(ranges: ReportRange[], range: ReportRange) {
  const previous = ranges.at(-1);
  if (previous?.to === range.from) previous.to = range.to;
  else ranges.push({ ...range });
}
function daily(power: PowerHistoryValue, tariff?: TariffHistoryValue) {
  const watts = decimalToScaled(parseEnergy(powerWattsSchema, power.powerWatts), 2);
  const hours = decimalToScaled(parseEnergy(hoursPerDaySchema, power.hoursPerDay), 2);
  const rate = tariff
    ? decimalToScaled(parseEnergy(tariffRateSchema, tariff.unitRateMinorPerKwh), 5)
    : null;
  return {
    kwhScaled: watts * hours,
    penceScaled: rate !== null ? watts * hours * rate : watts * hours === 0n ? 0n : null,
  };
}

export function calculateEquipmentEnergy(input: {
  range: ReportRange;
  powerPeriods: readonly PowerHistoryValue[];
  tariffs: readonly TariffHistoryValue[];
  usesPower: boolean;
  hasPowerHistory?: boolean;
}): EnergyReport {
  const range = parseEnergy(reportRangeSchema, input.range);
  const periods = input.powerPeriods.filter((period) => !period.voidedAt);
  const tariffs = input.tariffs.filter((tariff) => !tariff.voidedAt);
  validateTimeline(periods);
  validateTimeline(tariffs);
  const applicable = input.usesPower || input.hasPowerHistory === true || periods.length > 0;
  const result: EnergyReport = {
    range,
    applicable,
    knownSubtotal: { kwhScaled: 0n, penceScaled: 0n },
    energyComplete: true,
    costComplete: true,
    missingPower: [],
    missingTariff: [],
    missingCost: [],
    segments: [],
  };
  if (!applicable) return result;
  const boundaries = new Set([range.from, range.to]);
  for (const period of [...periods, ...tariffs]) {
    for (const date of [period.effectiveFrom, period.effectiveTo])
      if (date && date > range.from && date < range.to) boundaries.add(date);
  }
  const ordered = [...boundaries].sort();
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const segmentRange = { from: ordered[index], to: ordered[index + 1] };
    const days = calendarOrdinal(segmentRange.to) - calendarOrdinal(segmentRange.from);
    const power = periods.find((period) => includesDate(period, segmentRange.from));
    const tariff = tariffs.find((period) => includesDate(period, segmentRange.from));
    const values = power ? daily(power, tariff) : null;
    const kwhScaled = values ? values.kwhScaled * BigInt(days) : null;
    const penceScaled =
      values?.penceScaled === null || !values ? null : values.penceScaled * BigInt(days);
    result.segments.push({
      ...segmentRange,
      days,
      powerPeriodId: power?.id ?? null,
      tariffId: tariff?.id ?? null,
      kwhScaled,
      penceScaled,
    });
    if (kwhScaled === null) appendRange(result.missingPower, segmentRange);
    else result.knownSubtotal.kwhScaled += kwhScaled;
    if (!tariff) appendRange(result.missingTariff, segmentRange);
    if (penceScaled === null) appendRange(result.missingCost, segmentRange);
    else result.knownSubtotal.penceScaled += penceScaled;
  }
  result.energyComplete = result.missingPower.length === 0;
  result.costComplete = result.missingCost.length === 0;
  return result;
}

export function formatEnergyKwh(value: bigint): string {
  return formatScaled(value, 7);
}
export function formatExactGbp(penceScaled: bigint): string {
  return formatScaled(penceScaled, 14);
}
export function formatGbp(penceScaled: bigint): string {
  const pennies = (penceScaled + 500_000_000_000n) / 1_000_000_000_000n;
  return `£${formatScaled(pennies, 2)}`;
}
export function combineEnergyReports(reports: readonly EnergyReport[]) {
  return {
    knownSubtotal: reports.reduce(
      (sum, report) => ({
        kwhScaled: sum.kwhScaled + report.knownSubtotal.kwhScaled,
        penceScaled: sum.penceScaled + report.knownSubtotal.penceScaled,
      }),
      { kwhScaled: 0n, penceScaled: 0n },
    ),
    energyComplete: reports.every((report) => report.energyComplete),
    costComplete: reports.every((report) => report.costComplete),
  };
}
export function projectCurrentSettings(power: PowerHistoryValue, tariff?: TariffHistoryValue) {
  const values = daily(power, tariff);
  const projection = (days: bigint) => ({
    kwhScaled: values.kwhScaled * days,
    penceScaled: values.penceScaled === null ? null : values.penceScaled * days,
  });
  return {
    basis: 'Projection from current settings and rate; not measured consumption' as const,
    configuredOperatingWatts: parseEnergy(powerWattsSchema, power.powerWatts),
    daily: projection(1n),
    days30: projection(30n),
    days365: projection(365n),
  };
}
