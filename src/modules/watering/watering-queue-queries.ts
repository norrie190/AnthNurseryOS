import 'server-only';
import { Prisma } from '../../generated/prisma/client';
import {
  addCalendarDays,
  dateToSql,
  nurseryDateStartInstant,
  nurseryToday,
} from '../../lib/calendar-date';
import { getPrisma } from '../../lib/prisma';
import { calculateWateringDueState } from './watering-due';
import { parseWateringScheduleDate } from './watering-schedule-input';
import { countWateringQueue, sortWateringQueue, type WateringQueueEntry } from './watering-queue';

const plantSelect = {
  id: true,
  reference: true,
  name: true,
  status: true,
  location: { select: { id: true, name: true } },
  photos: { where: { isPrimary: true }, take: 1, select: { id: true, derivativeRevision: true } },
} satisfies Prisma.PlantSelect;
const scheduleSelect = {
  plantId: true,
  intervalDays: true,
} satisfies Prisma.WateringSchedulePeriodSelect;
const eventSelect = {
  plantId: true,
  wateredAt: true,
  voidedAt: true,
  createdAt: true,
  id: true,
} satisfies Prisma.WateringEventSelect;

export async function readWateringQueue(
  tx: Prisma.TransactionClient,
  nurseryDate = nurseryToday(),
) {
  const date = parseWateringScheduleDate(nurseryDate);
  const before = nurseryDateStartInstant(addCalendarDays(date, 1));
  const plants = await tx.plant.findMany({
    where: { archivedAt: null, status: { in: ['GROWING', 'QUARANTINE'] } },
    select: plantSelect,
  });
  if (!plants.length) return { nurseryDate: date, entries: [], counts: countWateringQueue([]) };
  const ids = plants.map((plant) => plant.id);
  const [schedules, events] = await Promise.all([
    tx.wateringSchedulePeriod.findMany({
      where: {
        plantId: { in: ids },
        voidedAt: null,
        effectiveFrom: { lte: dateToSql(date) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: dateToSql(date) } }],
      },
      select: scheduleSelect,
    }),
    tx.wateringEvent.findMany({
      where: { plantId: { in: ids }, voidedAt: null, wateredAt: { lt: before } },
      select: eventSelect,
      orderBy: [{ wateredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    }),
  ]);
  const scheduleByPlant = new Map(schedules.map((schedule) => [schedule.plantId, schedule]));
  const eventByPlant = new Map<string, (typeof events)[number]>();
  for (const event of events)
    if (!eventByPlant.has(event.plantId)) eventByPlant.set(event.plantId, event);
  const entries = plants.map((plant) => {
    const schedule = scheduleByPlant.get(plant.id);
    const event = eventByPlant.get(plant.id);
    const due = calculateWateringDueState({
      nurseryDate: date,
      schedule: schedule ? { intervalDays: schedule.intervalDays } : null,
      events: event ? [{ wateredAt: event.wateredAt, voidedAt: null }] : [],
    });
    return {
      plant: {
        id: plant.id,
        reference: plant.reference,
        name: plant.name,
        status: plant.status as 'GROWING' | 'QUARANTINE',
        location: plant.location,
        primaryPhoto: plant.photos[0] ?? null,
      },
      due,
    } satisfies WateringQueueEntry;
  });
  const sorted = sortWateringQueue(entries);
  return { nurseryDate: date, entries: sorted, counts: countWateringQueue(sorted) };
}

export async function getWateringQueue(nurseryDate = nurseryToday()) {
  return getPrisma().$transaction((tx) => readWateringQueue(tx, nurseryDate), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

export type WateringQueue = Awaited<ReturnType<typeof getWateringQueue>>;
