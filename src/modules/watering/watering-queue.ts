import type { WateringDueState, WateringDueStatus } from './watering-due';

export type WateringQueueEntry = {
  plant: {
    id: string;
    reference: string;
    name: string | null;
    status: 'GROWING' | 'QUARANTINE';
    location: { id: string; name: string } | null;
    primaryPhoto: { id: string; derivativeRevision: string | null } | null;
  };
  due: WateringDueState;
};

const priority: Record<WateringDueStatus, number> = {
  OVERDUE: 0,
  DUE_TODAY: 1,
  NEEDS_FIRST_WATERING: 2,
  DUE_SOON: 3,
  UPCOMING: 4,
  NOT_CONFIGURED: 5,
};

function displayName(entry: WateringQueueEntry) {
  return (entry.plant.name || entry.plant.reference).toLocaleLowerCase();
}

export function sortWateringQueue(entries: readonly WateringQueueEntry[]): WateringQueueEntry[] {
  return [...entries].sort((a, b) => {
    const category = priority[a.due.status] - priority[b.due.status];
    if (category) return category;
    if (a.due.status === 'OVERDUE' && b.due.status === 'OVERDUE') {
      const distance = (a.due.daysUntilDue ?? 0) - (b.due.daysUntilDue ?? 0);
      if (distance) return distance;
    }
    if (
      (a.due.status === 'DUE_SOON' || a.due.status === 'UPCOMING') &&
      a.due.nextDueDate &&
      b.due.nextDueDate
    ) {
      const due = a.due.nextDueDate.localeCompare(b.due.nextDueDate);
      if (due) return due;
    }
    return (
      displayName(a).localeCompare(displayName(b)) ||
      a.plant.reference.localeCompare(b.plant.reference) ||
      a.plant.id.localeCompare(b.plant.id)
    );
  });
}

export function countWateringQueue(entries: readonly WateringQueueEntry[]) {
  const counts = {
    overdue: 0,
    dueToday: 0,
    dueSoon: 0,
    needsFirstWatering: 0,
    upcoming: 0,
    notConfigured: 0,
  };
  for (const entry of entries) {
    if (entry.due.status === 'OVERDUE') counts.overdue += 1;
    else if (entry.due.status === 'DUE_TODAY') counts.dueToday += 1;
    else if (entry.due.status === 'DUE_SOON') counts.dueSoon += 1;
    else if (entry.due.status === 'NEEDS_FIRST_WATERING') counts.needsFirstWatering += 1;
    else if (entry.due.status === 'UPCOMING') counts.upcoming += 1;
    else counts.notConfigured += 1;
  }
  return { totalEligible: entries.length, ...counts };
}
