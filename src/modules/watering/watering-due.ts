import { z } from 'zod';
import {
  addCalendarDays,
  calendarDateSchema,
  calendarDaysBetween,
  nurseryDateForInstant,
} from '../../lib/calendar-date';
import { WateringError } from './watering-errors';

export const WATERING_DUE_SOON_DAYS = 3;

export type WateringDueStatus =
  'NOT_CONFIGURED' | 'NEEDS_FIRST_WATERING' | 'OVERDUE' | 'DUE_TODAY' | 'DUE_SOON' | 'UPCOMING';

export type WateringDueEvent = { wateredAt: Date; voidedAt: Date | null };
export type WateringDueSchedule = { intervalDays: number };
export type WateringDueState = {
  status: WateringDueStatus;
  nurseryDate: string;
  intervalDays: number | null;
  latestWateredDate: string | null;
  nextDueDate: string | null;
  // Negative means overdue, zero means due today, positive means due in N calendar days.
  daysUntilDue: number | null;
};

const intervalSchema = z.number().int().min(1).max(365);

function latestQualifyingDate(events: readonly WateringDueEvent[], nurseryDate: string) {
  const event = events
    .filter(
      (candidate) =>
        candidate.voidedAt === null &&
        Number.isFinite(candidate.wateredAt.getTime()) &&
        nurseryDateForInstant(candidate.wateredAt) <= nurseryDate,
    )
    .sort((a, b) => b.wateredAt.getTime() - a.wateredAt.getTime())[0];
  return event ? nurseryDateForInstant(event.wateredAt) : null;
}

export function calculateWateringDueState(input: {
  nurseryDate: string;
  schedule: WateringDueSchedule | null;
  events: readonly WateringDueEvent[];
}): WateringDueState {
  const nurseryDate = calendarDateSchema.parse(input.nurseryDate);
  const latestWateredDate = latestQualifyingDate(input.events, nurseryDate);
  if (!input.schedule) {
    return {
      status: 'NOT_CONFIGURED',
      nurseryDate,
      intervalDays: null,
      latestWateredDate,
      nextDueDate: null,
      daysUntilDue: null,
    };
  }
  const parsedInterval = intervalSchema.safeParse(input.schedule.intervalDays);
  if (!parsedInterval.success) {
    throw new WateringError('VALIDATION_FAILED', 'The watering interval is invalid.', {
      cause: parsedInterval.error,
    });
  }
  const intervalDays = parsedInterval.data;
  if (!latestWateredDate) {
    return {
      status: 'NEEDS_FIRST_WATERING',
      nurseryDate,
      intervalDays,
      latestWateredDate: null,
      nextDueDate: null,
      daysUntilDue: null,
    };
  }
  const nextDueDate = addCalendarDays(latestWateredDate, intervalDays);
  const daysUntilDue = calendarDaysBetween(nurseryDate, nextDueDate);
  const status: WateringDueStatus =
    daysUntilDue < 0
      ? 'OVERDUE'
      : daysUntilDue === 0
        ? 'DUE_TODAY'
        : daysUntilDue <= WATERING_DUE_SOON_DAYS
          ? 'DUE_SOON'
          : 'UPCOMING';
  return {
    status,
    nurseryDate,
    intervalDays,
    latestWateredDate,
    nextDueDate,
    daysUntilDue,
  };
}
