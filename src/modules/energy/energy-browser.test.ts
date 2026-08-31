import { expect, test } from 'vitest';
import {
  compactDecimal,
  correctionReview,
  currentMonth,
  exclusiveEnd,
  humanRange,
  shiftDay,
  type EnergyRow,
} from './energy-browser';
import { equipmentEnergyView } from './energy-view';
const base: EnergyRow = {
  id: 'p',
  effectiveFrom: '2026-09-01',
  effectiveTo: null,
  powerWatts: '70.00',
  hoursPerDay: '12.00',
  notes: null,
  correctionReason: null,
  voidedAt: null,
};
test('natural date ranges, leap dates and DST retain calendar semantics', () => {
  expect(humanRange('2026-09-01', '2026-09-21')).toBe('1 Sept 2026 – 20 Sept 2026');
  expect(humanRange('2026-09-21', null)).toBe('21 Sept 2026 – ongoing');
  expect(exclusiveEnd('2024-02-29')).toBe('2024-03-01');
  expect(shiftDay('2026-03-29', 1)).toBe('2026-03-30');
  expect(shiftDay('2026-10-25', -1)).toBe('2026-10-24');
  expect(currentMonth('2026-12-31')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  expect(compactDecimal('24.50120')).toBe('24.5012');
  expect(compactDecimal('0.00000')).toBe('0');
});
test('shared boundary review lists exact coordinated adjacent change, never swallows a successor', () => {
  const left = { ...base, effectiveTo: '2026-09-21' };
  const right = { ...base, id: 'right', effectiveFrom: '2026-09-21' };
  expect(
    correctionReview([left, right], left, left.effectiveFrom, '2026-09-23').adjustments,
  ).toEqual([{ periodId: 'right', effectiveFrom: '2026-09-23' }]);
  expect(() => correctionReview([left, right], left, left.effectiveFrom, null)).toThrow(
    'cannot replace',
  );
});
test('view uses exact engine projections and monthly coverage, serialized strings only', () => {
  const view = equipmentEnergyView({
    equipmentId: 'e',
    usesPower: true,
    token: 't',
    rows: [base],
    tariffs: [{ ...base, unitRateMinorPerKwh: '25.00000' }],
    today: '2026-09-12',
  });
  expect(view.current).toMatchObject({
    watts: '70',
    hours: '12',
    kwh: '0.84',
    daily: '£0.21',
    days30: '£6.30',
    days365: '£76.65',
  });
  expect(view.report).toMatchObject({
    kwh: '25.2',
    cost: '£6.30',
    energyComplete: true,
    costComplete: true,
  });
  expect(() => JSON.stringify(view)).not.toThrow();
});
test.each(['power', 'tariff', 'zero', 'disabled'])('coverage semantics %s', (scenario) => {
  const view = equipmentEnergyView({
    equipmentId: 'e',
    usesPower: scenario !== 'disabled',
    token: 't',
    rows:
      scenario === 'power' || scenario === 'disabled'
        ? []
        : [{ ...base, powerWatts: scenario === 'zero' ? '0.00' : '70.00' }],
    tariffs: [],
    today: '2026-09-12',
  });
  if (scenario === 'disabled') expect(view.report.applicable).toBe(false);
  if (scenario === 'power') expect(view.report.energyComplete).toBe(false);
  if (scenario === 'tariff') expect(view.report.costComplete).toBe(false);
  if (scenario === 'zero')
    expect(view.current).toMatchObject({ kwh: '0', daily: '£0.00', tariff: null, knownZero: true });
});
