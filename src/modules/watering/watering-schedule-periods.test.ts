import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  planWateringScheduleChange,
  planWateringScheduleCorrection,
  wateringScheduleIncludesDate,
  type WateringScheduleInterval,
} from './watering-schedule-periods';

const period = (effectiveFrom: string, effectiveTo: string | null): WateringScheduleInterval => ({
  id: randomUUID(),
  effectiveFrom,
  effectiveTo,
});

test('half-open schedule membership selects a successor at an adjacent boundary', () => {
  const first = period('2026-09-01', '2026-10-01');
  const second = period('2026-10-01', null);
  expect(wateringScheduleIncludesDate(first, '2026-09-30')).toBe(true);
  expect(wateringScheduleIncludesDate(first, '2026-10-01')).toBe(false);
  expect(wateringScheduleIncludesDate(second, '2026-10-01')).toBe(true);
});

test('normal changes split bounded/open periods and preserve future successors', () => {
  const bounded = period('2026-09-01', '2026-10-01');
  const successor = period('2026-10-01', null);
  expect(planWateringScheduleChange([bounded, successor], '2026-09-20')).toEqual({
    previous: bounded,
    effectiveTo: '2026-10-01',
  });
  expect(planWateringScheduleChange([successor], '2026-10-20')).toEqual({
    previous: successor,
    effectiveTo: null,
  });
});

test('a change in a genuine gap stops at the next future period', () => {
  const first = period('2026-09-01', '2026-09-10');
  const next = period('2026-10-01', null);
  expect(planWateringScheduleChange([first, next], '2026-09-20')).toEqual({
    previous: undefined,
    effectiveTo: '2026-10-01',
  });
});

test('normal change at an existing start requires explicit correction', () => {
  const existing = period('2026-09-01', null);
  expect(() => planWateringScheduleChange([existing], '2026-09-01')).toThrowError(
    expect.objectContaining({ code: 'SCHEDULE_CONFLICT' }),
  );
});

test('a shared boundary can move only with its explicit immediate neighbour', () => {
  const left = period('2026-09-01', '2026-10-01');
  const target = period('2026-10-01', null);
  const proposed = { ...target, effectiveFrom: '2026-09-20' };
  expect(() => planWateringScheduleCorrection([left, target], target, proposed)).toThrowError(
    expect.objectContaining({ code: 'SCHEDULE_CONFLICT' }),
  );
  const changes = planWateringScheduleCorrection([left, target], target, proposed, [
    { periodId: left.id, effectiveTo: '2026-09-20' },
  ]);
  expect(changes).toContainEqual({ ...left, effectiveTo: '2026-09-20' });
  expect(changes).toContainEqual(proposed);
});

test('non-adjacent and ambiguous overlap adjustments are rejected', () => {
  const left = period('2026-09-01', '2026-09-10');
  const target = period('2026-10-01', null);
  expect(() =>
    planWateringScheduleCorrection(
      [left, target],
      target,
      { ...target, effectiveFrom: '2026-09-05' },
      [{ periodId: left.id, effectiveTo: '2026-09-05' }],
    ),
  ).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  expect(() =>
    planWateringScheduleCorrection([left, target], target, {
      ...target,
      effectiveFrom: '2026-09-05',
    }),
  ).toThrowError(expect.objectContaining({ code: 'SCHEDULE_CONFLICT' }));
});
