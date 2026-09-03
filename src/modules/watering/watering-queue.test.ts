import { describe, expect, test } from 'vitest';
import { countWateringQueue, sortWateringQueue, type WateringQueueEntry } from './watering-queue';

const entry = (
  id: string,
  status: WateringQueueEntry['due']['status'],
  extra: Partial<WateringQueueEntry['due']> = {},
): WateringQueueEntry => ({
  plant: { id, reference: id, name: null, status: 'GROWING', location: null, primaryPhoto: null },
  due: {
    status,
    nurseryDate: '2026-09-03',
    intervalDays: status === 'NOT_CONFIGURED' ? null : 7,
    latestWateredDate: null,
    nextDueDate: null,
    daysUntilDue: null,
    ...extra,
  },
});

describe('watering queue ordering and counts', () => {
  test('counts every category and preserves the approved operational priority', () => {
    const entries = [
      entry('not', 'NOT_CONFIGURED'),
      entry('soon', 'DUE_SOON', { nextDueDate: '2026-09-04' }),
      entry('first', 'NEEDS_FIRST_WATERING'),
      entry('today', 'DUE_TODAY'),
      entry('over', 'OVERDUE', { daysUntilDue: -3 }),
      entry('up', 'UPCOMING', { nextDueDate: '2026-09-10' }),
    ];
    expect(sortWateringQueue(entries).map((item) => item.plant.id)).toEqual([
      'over',
      'today',
      'first',
      'soon',
      'up',
      'not',
    ]);
    expect(countWateringQueue(entries)).toEqual({
      totalEligible: 6,
      overdue: 1,
      dueToday: 1,
      dueSoon: 1,
      needsFirstWatering: 1,
      upcoming: 1,
      notConfigured: 1,
    });
  });
  test('orders operational distances and deterministic ties', () => {
    const entries = [
      entry('b', 'OVERDUE', { daysUntilDue: -1 }),
      entry('a', 'OVERDUE', { daysUntilDue: -4 }),
      entry('z', 'UPCOMING', { nextDueDate: '2026-09-10' }),
      entry('y', 'UPCOMING', { nextDueDate: '2026-09-05' }),
    ];
    expect(sortWateringQueue(entries).map((item) => item.plant.id)).toEqual(['a', 'b', 'y', 'z']);
  });
  test('stable names use reference and id tie breakers', () => {
    const entries = [entry('b', 'NOT_CONFIGURED'), entry('a', 'NOT_CONFIGURED')];
    entries[0].plant.name = 'Same';
    entries[1].plant.name = 'Same';
    expect(sortWateringQueue(entries).map((item) => item.plant.id)).toEqual(['a', 'b']);
  });
});
