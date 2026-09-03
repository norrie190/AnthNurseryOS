import { z } from 'zod';

export const NURSERY_TIME_ZONE = 'Europe/London';

export const calendarDateSchema = z.iso.date().refine((value) => !value.startsWith('0000-'), {
  message: 'Use a calendar date with a year from 0001 to 9999.',
});

export function nurseryToday(): string {
  return nurseryDateForInstant(new Date());
}

export function nurseryDateForInstant(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: NURSERY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
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

export function addCalendarDays(value: string, days: number): string {
  const date = dateToSql(value);
  date.setUTCDate(date.getUTCDate() + days);
  return calendarDateSchema.parse(date.toISOString().slice(0, 10));
}

export function calendarDaysBetween(from: string, to: string): number {
  return calendarOrdinal(to) - calendarOrdinal(from);
}

function nurseryDateTimeParts(instant: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: NURSERY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((value) => value.type === type)!.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}

export function nurseryDateTimeInputValue(instant: Date): string {
  const parts = nurseryDateTimeParts(instant);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

// A datetime-local control carries no offset. Interpret its value in the nursery
// timezone, reject nonexistent spring-transition times, and resolve an ambiguous
// autumn-transition time to its later (standard-time) occurrence.
export function nurseryInstantForDateTimeInput(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new RangeError('Enter a valid nursery date and time.');
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  calendarDateSchema.parse(`${yearText}-${monthText}-${dayText}`);
  if (hour > 23 || minute > 59) throw new RangeError('Enter a valid nursery date and time.');

  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = nurseryDateTimeParts(new Date(candidate));
    const representedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
    );
    const difference = desired - representedAsUtc;
    candidate += difference;
    if (difference === 0) break;
  }
  const result = new Date(candidate);
  const local = nurseryDateTimeParts(result);
  if (
    local.year !== year ||
    local.month !== month ||
    local.day !== day ||
    local.hour !== hour ||
    local.minute !== minute
  ) {
    throw new RangeError(
      'Enter a valid Europe/London date and time. This time may not exist when clocks change.',
    );
  }
  return result;
}

// Resolve local nursery midnight iteratively; this remains correct across 23/25-hour DST days.
export function nurseryDateStartInstant(value: string): Date {
  const date = calendarDateSchema.parse(value);
  const desired = Date.parse(`${date}T00:00:00.000Z`);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = nurseryDateTimeParts(new Date(candidate));
    const representedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    const difference = desired - representedAsUtc;
    candidate += difference;
    if (difference === 0) break;
  }
  const result = new Date(candidate);
  const local = nurseryDateTimeParts(result);
  if (
    nurseryDateForInstant(result) !== date ||
    local.hour !== 0 ||
    local.minute !== 0 ||
    local.second !== 0
  ) {
    throw new RangeError(`Could not resolve nursery midnight for ${date}.`);
  }
  return result;
}
