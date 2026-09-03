import 'server-only';
import { Prisma } from '../../generated/prisma/client';
import {
  addCalendarDays,
  dateToSql,
  nurseryDateStartInstant,
  nurseryToday,
} from '../../lib/calendar-date';
import { getPrisma } from '../../lib/prisma';
import { WateringError } from './watering-errors';
import { calculateWateringDueState } from './watering-due';
import { parseWateringPlantId } from './watering-input';
import { parseWateringScheduleDate } from './watering-schedule-input';

const scheduleSelect = {
  id: true,
  plantId: true,
  intervalDays: true,
  effectiveFrom: true,
  effectiveTo: true,
  notes: true,
  voidedAt: true,
  correctionReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WateringSchedulePeriodSelect;

const plantSelect = {
  id: true,
  reference: true,
  name: true,
  status: true,
  archivedAt: true,
} satisfies Prisma.PlantSelect;

function applicableScheduleWhere(plantId: string, nurseryDate: string) {
  return {
    plantId,
    voidedAt: null,
    effectiveFrom: { lte: dateToSql(nurseryDate) },
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: dateToSql(nurseryDate) } }],
  } satisfies Prisma.WateringSchedulePeriodWhereInput;
}

export async function getPlantWateringScheduleHistory(plantId: string) {
  const id = parseWateringPlantId(plantId);
  return getPrisma().$transaction(
    async (tx) => {
      const plant = await tx.plant.findUnique({ where: { id }, select: plantSelect });
      if (!plant) throw new WateringError('PLANT_NOT_FOUND', 'This Plant could not be found.');
      const periods = await tx.wateringSchedulePeriod.findMany({
        where: { plantId: id },
        select: scheduleSelect,
        orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });
      return { plant, periods };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function getWateringScheduleForDate(plantId: string, nurseryDate: string) {
  const id = parseWateringPlantId(plantId);
  const date = parseWateringScheduleDate(nurseryDate);
  return getPrisma().$transaction(
    async (tx) => {
      const plant = await tx.plant.findUnique({ where: { id }, select: { id: true } });
      if (!plant) throw new WateringError('PLANT_NOT_FOUND', 'This Plant could not be found.');
      return tx.wateringSchedulePeriod.findFirst({
        where: applicableScheduleWhere(id, date),
        select: scheduleSelect,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export function getCurrentWateringSchedule(plantId: string) {
  return getWateringScheduleForDate(plantId, nurseryToday());
}

export async function getPlantWateringDueState(plantId: string, nurseryDate = nurseryToday()) {
  const id = parseWateringPlantId(plantId);
  const date = parseWateringScheduleDate(nurseryDate);
  const before = nurseryDateStartInstant(addCalendarDays(date, 1));
  return getPrisma().$transaction(
    async (tx) => {
      const plant = await tx.plant.findUnique({ where: { id }, select: plantSelect });
      if (!plant) throw new WateringError('PLANT_NOT_FOUND', 'This Plant could not be found.');
      const schedule = await tx.wateringSchedulePeriod.findFirst({
        where: applicableScheduleWhere(id, date),
        select: scheduleSelect,
      });
      const latestWateringEvent = await tx.wateringEvent.findFirst({
        where: { plantId: id, voidedAt: null, wateredAt: { lt: before } },
        orderBy: [{ wateredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, wateredAt: true, updatedAt: true },
      });
      const due = calculateWateringDueState({
        nurseryDate: date,
        schedule: schedule ? { intervalDays: schedule.intervalDays } : null,
        events: latestWateringEvent
          ? [{ wateredAt: latestWateringEvent.wateredAt, voidedAt: null }]
          : [],
      });
      return {
        plant: {
          ...plant,
          activeCareEligible:
            plant.archivedAt === null &&
            (plant.status === 'GROWING' || plant.status === 'QUARANTINE'),
        },
        schedule,
        latestWateringEvent,
        due,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
