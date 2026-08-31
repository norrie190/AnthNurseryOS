import { z } from 'zod';

export const calendarDateSchema = z.iso.date().refine((value) => !value.startsWith('0000-'), {
  message: 'Use a calendar date with a year from 0001 to 9999.',
});

export function nurseryToday(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function dateToSql(value: string): Date {
  return new Date(`${calendarDateSchema.parse(value)}T00:00:00.000Z`);
}
export function sqlToDate(value: Date): string {
  return calendarDateSchema.parse(value.toISOString().slice(0, 10));
}

// Gregorian calendar arithmetic, never elapsed milliseconds or local 24-hour durations.
export function calendarOrdinal(value: string): number {
  const [year, month, day] = calendarDateSchema.parse(value).split('-').map(Number);
  const prior = year - 1;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const beforeMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return (
    prior * 365 +
    Math.floor(prior / 4) -
    Math.floor(prior / 100) +
    Math.floor(prior / 400) +
    beforeMonth[month - 1] +
    (leap && month > 2 ? 1 : 0) +
    day
  );
}
