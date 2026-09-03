import { describe, expect, test } from 'vitest';
import {
  NURSERY_TIME_ZONE,
  nurseryDateForInstant,
  nurseryDateStartInstant,
} from '../../lib/calendar-date';
import { calculateWateringDueState, WATERING_DUE_SOON_DAYS } from './watering-due';

const target = '2026-09-10';
const schedule = (intervalDays: number) => ({ intervalDays });
const event = (wateredAt: string, voided = false) => ({
  wateredAt: new Date(wateredAt),
  voidedAt: voided ? new Date('2026-09-10T09:00:00.000Z') : null,
});

describe('pure watering due states', () => {
  test('no schedule is explicitly not configured without inventing a due date', () => {
    expect(
      calculateWateringDueState({
        nurseryDate: target,
        schedule: null,
        events: [event('2026-09-01T09:00:00.000Z')],
      }),
    ).toEqual({
      status: 'NOT_CONFIGURED',
      nurseryDate: target,
      intervalDays: null,
      latestWateredDate: '2026-09-01',
      nextDueDate: null,
      daysUntilDue: null,
    });
  });

  test('a configured schedule without a real event needs its first watering', () => {
    expect(
      calculateWateringDueState({ nurseryDate: target, schedule: schedule(7), events: [] }),
    ).toEqual({
      status: 'NEEDS_FIRST_WATERING',
      nurseryDate: target,
      intervalDays: 7,
      latestWateredDate: null,
      nextDueDate: null,
      daysUntilDue: null,
    });
  });

  test.each([
    [9, 'DUE_TODAY', 0],
    [8, 'OVERDUE', -1],
    [3, 'OVERDUE', -6],
    [10, 'DUE_SOON', 1],
    [12, 'DUE_SOON', 3],
    [13, 'UPCOMING', 4],
  ] as const)('interval %s produces %s with signed distance %s', (intervalDays, status, days) => {
    expect(
      calculateWateringDueState({
        nurseryDate: target,
        schedule: schedule(intervalDays),
        events: [event('2026-09-01T09:00:00.000Z')],
      }),
    ).toMatchObject({ status, daysUntilDue: days });
  });

  test('the centralized due-soon window includes exactly three calendar days', () => {
    expect(WATERING_DUE_SOON_DAYS).toBe(3);
  });

  test('the target-date interval applies to the latest fact and may make it immediately overdue', () => {
    expect(
      calculateWateringDueState({
        nurseryDate: '2026-09-10',
        schedule: schedule(7),
        events: [event('2026-09-01T09:00:00.000Z')],
      }),
    ).toMatchObject({
      status: 'OVERDUE',
      latestWateredDate: '2026-09-01',
      nextDueDate: '2026-09-08',
      daysUntilDue: -2,
    });
  });

  test('an event before schedule effectiveFrom remains a valid anchor', () => {
    expect(
      calculateWateringDueState({
        nurseryDate: '2026-09-20',
        schedule: schedule(21),
        events: [event('2026-09-01T09:00:00.000Z')],
      }),
    ).toMatchObject({ status: 'DUE_SOON', nextDueDate: '2026-09-22', daysUntilDue: 2 });
  });

  test('voided latest events fall back, while all-void history needs first watering', () => {
    const events = [event('2026-09-09T09:00:00.000Z', true), event('2026-09-05T09:00:00.000Z')];
    expect(
      calculateWateringDueState({ nurseryDate: target, schedule: schedule(7), events }),
    ).toMatchObject({ latestWateredDate: '2026-09-05', nextDueDate: '2026-09-12' });
    expect(
      calculateWateringDueState({
        nurseryDate: target,
        schedule: schedule(7),
        events: events.map((item) => ({ ...item, voidedAt: new Date() })),
      }),
    ).toMatchObject({ status: 'NEEDS_FIRST_WATERING', latestWateredDate: null });
  });

  test('historical targets ignore later events and future targets are deterministic', () => {
    const events = [event('2026-09-15T09:00:00.000Z'), event('2026-09-01T09:00:00.000Z')];
    expect(
      calculateWateringDueState({
        nurseryDate: '2026-09-10',
        schedule: schedule(7),
        events,
      }),
    ).toMatchObject({ latestWateredDate: '2026-09-01', status: 'OVERDUE' });
    expect(
      calculateWateringDueState({
        nurseryDate: '2026-09-20',
        schedule: schedule(7),
        events,
      }),
    ).toMatchObject({ latestWateredDate: '2026-09-15', nextDueDate: '2026-09-22' });
  });

  test.each([0, -1, 366, 1.5])('invalid interval %s is rejected at the pure boundary', (value) => {
    expect(() =>
      calculateWateringDueState({ nurseryDate: target, schedule: schedule(value), events: [] }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });
});

describe('Europe/London calendar conversion', () => {
  test('uses one centralized nursery timezone', () => {
    expect(NURSERY_TIME_ZONE).toBe('Europe/London');
  });

  test('a late UTC summer event belongs to the next local calendar date', () => {
    expect(nurseryDateForInstant(new Date('2026-06-15T23:30:00.000Z'))).toBe('2026-06-16');
  });

  test('spring transition produces a 23-hour nursery day', () => {
    const start = nurseryDateStartInstant('2026-03-29');
    const next = nurseryDateStartInstant('2026-03-30');
    expect(start.toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(next.toISOString()).toBe('2026-03-29T23:00:00.000Z');
    expect(next.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  test('autumn transition produces a 25-hour nursery day', () => {
    const start = nurseryDateStartInstant('2026-10-25');
    const next = nurseryDateStartInstant('2026-10-26');
    expect(start.toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(next.toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(next.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  test('events around both transitions retain their correct local dates', () => {
    expect(nurseryDateForInstant(new Date('2026-03-29T23:30:00.000Z'))).toBe('2026-03-30');
    expect(nurseryDateForInstant(new Date('2026-10-25T00:30:00.000Z'))).toBe('2026-10-25');
    expect(nurseryDateForInstant(new Date('2026-10-25T23:30:00.000Z'))).toBe('2026-10-25');
  });
});
