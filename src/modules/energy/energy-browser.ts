import { calendarDateSchema, dateToSql, sqlToDate } from '../../lib/calendar-date';
import { EnergyError } from './energy-errors';
import { parseEnergy } from './energy-input';
import { planCorrection, planSettingChange, type EnergyInterval } from './energy-periods';

export type EnergyRow = EnergyInterval & {
  powerWatts?: string;
  hoursPerDay?: string;
  unitRateMinorPerKwh?: string;
  notes: string | null;
  correctionReason: string | null;
  voidedAt: string | null;
};
export type EnergyMode = 'record' | 'change' | 'correct' | 'void';
export type EnergyContext = {
  kind: 'power' | 'tariff';
  equipmentId?: string;
  periodId?: string;
  mode: EnergyMode;
  token: string;
};
export type EnergyActionResult =
  | { success: true; message: string }
  | {
      success: false;
      message: string;
      stale?: boolean;
      issues?: readonly { field: string; message: string }[];
    };

// Calendar operations only. Never convert daily durations through elapsed milliseconds.
export function shiftDay(value: string, days: number): string {
  const date = dateToSql(parseEnergy(calendarDateSchema, value));
  date.setUTCDate(date.getUTCDate() + days);
  return parseEnergy(calendarDateSchema, date.toISOString().slice(0, 10));
}
export function exclusiveEnd(lastDay: string): string | null {
  return lastDay ? shiftDay(lastDay, 1) : null;
}
export function humanDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    dateToSql(value),
  );
}
export function humanRange(from: string, to: string | null): string {
  return `${humanDate(from)} – ${to ? humanDate(shiftDay(to, -1)) : 'ongoing'}`;
}
export function compactDecimal(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}
export function currentMonth(today: string) {
  const from = `${today.slice(0, 7)}-01`;
  const next = dateToSql(from);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, to: sqlToDate(next) };
}

// Projection of the existing domain planners for explicit browser review. The
// service still validates and applies the complete mutation under its own lock.
export function correctionReview(
  rows: readonly EnergyRow[],
  current: EnergyRow,
  from: string,
  to: string | null,
) {
  const active = rows.filter((row) => !row.voidedAt);
  const adjustments: { periodId: string; effectiveFrom?: string; effectiveTo?: string }[] = [];
  for (const row of active) {
    if (row.id === current.id) continue;
    if (row.effectiveTo === current.effectiveFrom && from !== current.effectiveFrom)
      adjustments.push({ periodId: row.id, effectiveTo: from });
    if (
      current.effectiveTo &&
      row.effectiveFrom === current.effectiveTo &&
      to !== current.effectiveTo
    ) {
      if (!to)
        throw new EnergyError(
          'CONFLICT',
          'An ongoing correction cannot replace the next scheduled period. Choose a last day.',
        );
      adjustments.push({ periodId: row.id, effectiveFrom: to });
    }
  }
  const changes = planCorrection(
    active,
    current,
    { ...current, effectiveFrom: from, effectiveTo: to },
    adjustments,
  );
  return { adjustments, neighbours: changes.filter((row) => row.id !== current.id) };
}
export function changeReview(rows: readonly EnergyRow[], from: string) {
  parseEnergy(calendarDateSchema, from);
  return planSettingChange(
    rows.filter((row) => !row.voidedAt),
    from,
  );
}

export function energyRows(
  rows: readonly ({
    id: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    notes: string | null;
    correctionReason: string | null;
    voidedAt: Date | null;
  } & (
    | {
        powerWatts: { toFixed: (places: number) => string };
        hoursPerDay: { toFixed: (places: number) => string };
      }
    | { unitRateMinorPerKwh: { toFixed: (places: number) => string } }
  ))[],
): EnergyRow[] {
  return rows.map((row) => ({
    id: row.id,
    effectiveFrom: sqlToDate(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? sqlToDate(row.effectiveTo) : null,
    notes: row.notes,
    correctionReason: row.correctionReason,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    ...('powerWatts' in row
      ? { powerWatts: row.powerWatts.toFixed(2), hoursPerDay: row.hoursPerDay.toFixed(2) }
      : { unitRateMinorPerKwh: row.unitRateMinorPerKwh.toFixed(5) }),
  }));
}
