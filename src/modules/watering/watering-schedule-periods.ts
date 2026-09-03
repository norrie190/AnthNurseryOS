import { WateringError } from './watering-errors';

export type WateringScheduleInterval = {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export function wateringScheduleIncludesDate(
  period: WateringScheduleInterval,
  date: string,
): boolean {
  return period.effectiveFrom <= date && (period.effectiveTo === null || date < period.effectiveTo);
}

function overlaps(a: WateringScheduleInterval, b: WateringScheduleInterval): boolean {
  return (
    (a.effectiveTo === null || b.effectiveFrom < a.effectiveTo) &&
    (b.effectiveTo === null || a.effectiveFrom < b.effectiveTo)
  );
}

function validateTimeline(periods: readonly WateringScheduleInterval[]) {
  const ordered = [...periods].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  for (const [index, period] of ordered.entries()) {
    if (period.effectiveTo !== null && period.effectiveTo <= period.effectiveFrom) {
      throw new WateringError('VALIDATION_FAILED', 'The schedule end must be after its start.');
    }
    if (index > 0 && overlaps(ordered[index - 1], period)) {
      throw new WateringError(
        'SCHEDULE_CONFLICT',
        'These dates overlap another watering schedule period.',
      );
    }
  }
}

export function planWateringScheduleChange<T extends WateringScheduleInterval>(
  periods: readonly T[],
  effectiveFrom: string,
) {
  if (periods.some((period) => period.effectiveFrom === effectiveFrom)) {
    throw new WateringError(
      'SCHEDULE_CONFLICT',
      'A watering schedule period already starts on this date. Correct that period explicitly.',
    );
  }
  const previous = periods.find((period) => wateringScheduleIncludesDate(period, effectiveFrom));
  const next = [...periods]
    .filter((period) => period.effectiveFrom > effectiveFrom)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  return { previous, effectiveTo: previous?.effectiveTo ?? next?.effectiveFrom ?? null };
}

export type WateringAdjacentAdjustment = {
  periodId: string;
  effectiveFrom?: string;
  effectiveTo?: string;
};

export function planWateringScheduleCorrection<T extends WateringScheduleInterval>(
  periods: readonly T[],
  current: T,
  proposed: T,
  adjustments: readonly WateringAdjacentAdjustment[] = [],
): T[] {
  const changes = new Map<string, T>([[current.id, proposed]]);
  for (const adjustment of adjustments) {
    const adjacent = periods.find((period) => period.id === adjustment.periodId);
    if (!adjacent || changes.has(adjacent.id)) {
      throw new WateringError('VALIDATION_FAILED', 'Choose each adjacent schedule period once.');
    }
    const left = adjacent.effectiveTo === current.effectiveFrom;
    const right = current.effectiveTo !== null && adjacent.effectiveFrom === current.effectiveTo;
    if (
      left &&
      adjustment.effectiveFrom === undefined &&
      adjustment.effectiveTo === proposed.effectiveFrom
    ) {
      changes.set(adjacent.id, { ...adjacent, effectiveTo: proposed.effectiveFrom });
    } else if (
      right &&
      adjustment.effectiveTo === undefined &&
      adjustment.effectiveFrom === proposed.effectiveTo
    ) {
      changes.set(adjacent.id, { ...adjacent, effectiveFrom: proposed.effectiveTo! });
    } else {
      throw new WateringError(
        'VALIDATION_FAILED',
        'An adjacent adjustment must explicitly match the corrected shared boundary.',
      );
    }
  }
  for (const adjacent of periods) {
    if (adjacent.id === current.id) continue;
    const brokenLeft =
      adjacent.effectiveTo === current.effectiveFrom &&
      proposed.effectiveFrom !== current.effectiveFrom;
    const brokenRight =
      current.effectiveTo !== null &&
      adjacent.effectiveFrom === current.effectiveTo &&
      proposed.effectiveTo !== current.effectiveTo;
    if ((brokenLeft || brokenRight) && !changes.has(adjacent.id)) {
      throw new WateringError(
        'SCHEDULE_CONFLICT',
        'Review the adjacent schedule period explicitly when changing this shared boundary.',
      );
    }
  }
  validateTimeline(periods.map((period) => changes.get(period.id) ?? period));
  const state = new Map(periods.map((period) => [period.id, period]));
  const pending = [...changes.values()];
  const ordered: T[] = [];
  while (pending.length > 0) {
    const index = pending.findIndex((period) =>
      [...state.values()].every((other) => other.id === period.id || !overlaps(period, other)),
    );
    if (index < 0) {
      throw new WateringError(
        'SCHEDULE_CONFLICT',
        'These boundary changes cannot be applied safely together.',
      );
    }
    const [period] = pending.splice(index, 1);
    ordered.push(period);
    state.set(period.id, period);
  }
  return ordered;
}
