import {
  calculateEquipmentEnergy,
  formatEnergyKwh,
  formatGbp,
  projectCurrentSettings,
} from './energy-calculations';
import { compactDecimal, currentMonth, type EnergyRow } from './energy-browser';
import { includesDate } from './energy-periods';

export function equipmentEnergyView(input: {
  equipmentId: string;
  usesPower: boolean;
  token: string;
  rows: EnergyRow[];
  tariffs: EnergyRow[];
  today: string;
}) {
  const powerPeriods = input.rows.map((row) => ({
    ...row,
    powerWatts: row.powerWatts!,
    hoursPerDay: row.hoursPerDay!,
  }));
  const tariffs = input.tariffs.map((row) => ({
    ...row,
    unitRateMinorPerKwh: row.unitRateMinorPerKwh!,
  }));
  const power = powerPeriods.find((row) => !row.voidedAt && includesDate(row, input.today));
  const tariff = tariffs.find((row) => !row.voidedAt && includesDate(row, input.today));
  const projection = power ? projectCurrentSettings(power, tariff) : null;
  const report = calculateEquipmentEnergy({
    range: currentMonth(input.today),
    powerPeriods,
    tariffs,
    usesPower: input.usesPower,
  });
  const cost = (value: bigint | null) =>
    value === null ? 'Unknown — tariff missing' : formatGbp(value);
  return {
    equipmentId: input.equipmentId,
    usesPower: input.usesPower,
    token: input.token,
    rows: input.rows,
    today: input.today,
    hasOngoingPowerPeriod: !!power,
    current:
      power && projection
        ? {
            watts: compactDecimal(power.powerWatts),
            hours: compactDecimal(power.hoursPerDay),
            kwh: compactDecimal(formatEnergyKwh(projection.daily.kwhScaled)),
            tariff: tariff ? compactDecimal(tariff.unitRateMinorPerKwh) : null,
            daily: cost(projection.daily.penceScaled),
            days30: cost(projection.days30.penceScaled),
            days365: cost(projection.days365.penceScaled),
            knownZero: projection.daily.kwhScaled === 0n,
          }
        : null,
    report: {
      applicable: report.applicable,
      range: report.range,
      energyComplete: report.energyComplete,
      costComplete: report.costComplete,
      kwh: compactDecimal(formatEnergyKwh(report.knownSubtotal.kwhScaled)),
      cost: formatGbp(report.knownSubtotal.penceScaled),
      missingPower: report.missingPower,
      missingTariff: report.missingTariff,
    },
  };
}
export type EquipmentEnergyView = ReturnType<typeof equipmentEnergyView>;
