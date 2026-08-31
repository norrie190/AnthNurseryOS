import 'server-only';
import {
  Prisma,
  type ElectricityTariff,
  type Equipment,
  type EquipmentPowerPeriod,
} from '../../generated/prisma/client';
import { getPrisma } from '../../lib/prisma';
import { calendarDateSchema, dateToSql, nurseryToday } from '../../lib/calendar-date';
import {
  calculateEquipmentEnergy,
  combineEnergyReports,
  projectCurrentSettings,
} from './energy-calculations';
import { EnergyError } from './energy-errors';
import { energyIdSchema, parseEnergy, reportRangeSchema, type ReportRange } from './energy-input';
import { intervalValues, tariffTimelineToken } from './energy-persistence';

const order = [{ effectiveFrom: 'asc' }, { id: 'asc' }] as const;
function powerValues(row: EquipmentPowerPeriod) {
  return {
    ...intervalValues(row),
    powerWatts: row.powerWatts.toFixed(2),
    hoursPerDay: row.hoursPerDay.toFixed(2),
    voidedAt: row.voidedAt?.toISOString() ?? null,
  };
}
function tariffValues(row: ElectricityTariff) {
  return {
    ...intervalValues(row),
    unitRateMinorPerKwh: row.unitRateMinorPerKwh.toFixed(5),
    voidedAt: row.voidedAt?.toISOString() ?? null,
  };
}
const covering = (on: string) => ({
  voidedAt: null,
  effectiveFrom: { lte: dateToSql(on) },
  OR: [{ effectiveTo: null }, { effectiveTo: { gt: dateToSql(on) } }],
});
const intersecting = (range: ReportRange) => ({
  voidedAt: null,
  effectiveFrom: { lt: dateToSql(range.to) },
  OR: [{ effectiveTo: null }, { effectiveTo: { gt: dateToSql(range.from) } }],
});

export async function getEquipmentPowerHistory(equipmentId: string) {
  const id = parseEnergy(energyIdSchema, equipmentId);
  return getPrisma().$transaction(
    async (tx) => {
      const equipment = await tx.equipment.findUnique({
        where: { id },
        select: {
          id: true,
          updatedAt: true,
          archivedAt: true,
          usesPower: true,
          powerPeriods: { orderBy: [...order] },
        },
      });
      if (!equipment) throw new EnergyError('NOT_FOUND', 'This Equipment could not be found.');
      const today = dateToSql(nurseryToday());
      return {
        ...equipment,
        hasOngoingPowerPeriod: equipment.powerPeriods.some(
          (row) =>
            !row.voidedAt &&
            row.effectiveFrom <= today &&
            (!row.effectiveTo || row.effectiveTo > today),
        ),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function getElectricityTariffHistory() {
  const tariffs = await getPrisma().electricityTariff.findMany({ orderBy: [...order] });
  return { tariffs, timelineToken: tariffTimelineToken(tariffs) };
}
export async function getCurrentEquipmentPowerPeriod(equipmentId: string, on = nurseryToday()) {
  const id = parseEnergy(energyIdSchema, equipmentId);
  const date = parseEnergy(calendarDateSchema, on);
  return getPrisma().equipmentPowerPeriod.findFirst({
    where: { equipmentId: id, ...covering(date) },
  });
}
export async function getCurrentElectricityTariff(on = nurseryToday()) {
  const date = parseEnergy(calendarDateSchema, on);
  return getPrisma().electricityTariff.findFirst({ where: covering(date) });
}

function summarySelect(range: ReportRange) {
  return {
    id: true,
    reference: true,
    name: true,
    archivedAt: true,
    usesPower: true,
    powerPeriods: { where: intersecting(range), orderBy: [...order] },
    _count: { select: { powerPeriods: { where: { voidedAt: null } } } },
  } satisfies Prisma.EquipmentSelect;
}
type SummaryEquipment = Pick<
  Equipment,
  'id' | 'reference' | 'name' | 'archivedAt' | 'usesPower'
> & {
  powerPeriods: EquipmentPowerPeriod[];
  _count: { powerPeriods: number };
};
function summary(equipment: SummaryEquipment, range: ReportRange, tariffs: ElectricityTariff[]) {
  const { powerPeriods, _count, ...identity } = equipment;
  return {
    equipment: identity,
    ...calculateEquipmentEnergy({
      range,
      usesPower: equipment.usesPower,
      hasPowerHistory: _count.powerPeriods > 0,
      powerPeriods: powerPeriods.map(powerValues),
      tariffs: tariffs.map(tariffValues),
    }),
  };
}
export async function getEquipmentEnergySummary(equipmentId: string, input: ReportRange) {
  const id = parseEnergy(energyIdSchema, equipmentId);
  const range = parseEnergy(reportRangeSchema, input);
  return getPrisma().$transaction(
    async (tx) => {
      const tariffs = await tx.electricityTariff.findMany({
        where: intersecting(range),
        orderBy: [...order],
      });
      const equipment = await tx.equipment.findUnique({
        where: { id },
        select: summarySelect(range),
      });
      if (!equipment) throw new EnergyError('NOT_FOUND', 'This Equipment could not be found.');
      return summary(equipment, range, tariffs);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function getNurseryEnergySummary(input: ReportRange) {
  const range = parseEnergy(reportRangeSchema, input);
  return getPrisma().$transaction(
    async (tx) => {
      // No archive or usesPower filter: historical consumption must not disappear.
      const items = await tx.equipment.findMany({
        select: summarySelect(range),
        orderBy: [{ reference: 'asc' }, { id: 'asc' }],
      });
      const tariffs = await tx.electricityTariff.findMany({
        where: intersecting(range),
        orderBy: [...order],
      });
      const equipment = items.map((item) => summary(item, range, tariffs));
      return { range, equipment, ...combineEnergyReports(equipment) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function getEquipmentEnergyProjections(equipmentId: string, on = nurseryToday()) {
  const id = parseEnergy(energyIdSchema, equipmentId);
  const date = parseEnergy(calendarDateSchema, on);
  return getPrisma().$transaction(
    async (tx) => {
      const equipment = await tx.equipment.findUnique({ where: { id }, select: { id: true } });
      if (!equipment) throw new EnergyError('NOT_FOUND', 'This Equipment could not be found.');
      const power = await tx.equipmentPowerPeriod.findFirst({
        where: { equipmentId: id, ...covering(date) },
      });
      const tariff = await tx.electricityTariff.findFirst({ where: covering(date) });
      return {
        on: date,
        projection: power
          ? projectCurrentSettings(powerValues(power), tariff ? tariffValues(tariff) : undefined)
          : null,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
