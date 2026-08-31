import { describe, expect, test } from 'vitest';
import {
  calculateEquipmentEnergy,
  combineEnergyReports,
  formatEnergyKwh,
  formatExactGbp,
  formatGbp,
  projectCurrentSettings,
  type PowerHistoryValue,
  type TariffHistoryValue,
} from './energy-calculations';
import { calendarOrdinal } from '../../lib/calendar-date';

const power = (overrides: Partial<PowerHistoryValue> = {}): PowerHistoryValue => ({
  id: 'p',
  effectiveFrom: '2026-09-01',
  effectiveTo: null,
  powerWatts: '70',
  hoursPerDay: '12',
  ...overrides,
});
const tariff = (overrides: Partial<TariffHistoryValue> = {}): TariffHistoryValue => ({
  id: 't',
  effectiveFrom: '2026-09-01',
  effectiveTo: null,
  unitRateMinorPerKwh: '25',
  ...overrides,
});
const range = { from: '2026-09-01', to: '2026-10-01' };
const calculate = (periods = [power()], tariffs = [tariff()], reportRange = range) =>
  calculateEquipmentEnergy({ usesPower: true, range: reportRange, powerPeriods: periods, tariffs });

test('70 W / 12 hours / 25p produces the exact approved daily and projection results', () => {
  const projected = projectCurrentSettings(power(), tariff());
  expect(formatEnergyKwh(projected.daily.kwhScaled)).toBe('0.8400000');
  expect(projected.daily.penceScaled).toBe(21n * 10n ** 12n);
  expect(formatEnergyKwh(projected.days30.kwhScaled)).toBe('25.2000000');
  expect(formatGbp(projected.days30.penceScaled!)).toBe('£6.30');
  expect(formatEnergyKwh(projected.days365.kwhScaled)).toBe('306.6000000');
  expect(formatGbp(projected.days365.penceScaled!)).toBe('£76.65');
  expect(calculate().knownSubtotal).toEqual(projected.days30);
  expect(projected.basis).toContain('not measured');
});
test('September intersections split at BOTH power and tariff boundaries before summation', () => {
  const report = calculate(
    [
      power({ powerWatts: '80', effectiveTo: '2026-09-16' }),
      power({ id: 'p2', powerWatts: '60', hoursPerDay: '10', effectiveFrom: '2026-09-16' }),
    ],
    [
      tariff({ unitRateMinorPerKwh: '24', effectiveTo: '2026-09-21' }),
      tariff({ id: 't2', unitRateMinorPerKwh: '26', effectiveFrom: '2026-09-21' }),
    ],
  );
  expect(
    report.segments.map((segment) => [
      segment.days,
      formatEnergyKwh(segment.kwhScaled!),
      formatExactGbp(segment.penceScaled!),
    ]),
  ).toEqual([
    [15, '14.4000000', '3.45600000000000'],
    [5, '3.0000000', '0.72000000000000'],
    [10, '6.0000000', '1.56000000000000'],
  ]);
  expect(formatEnergyKwh(report.knownSubtotal.kwhScaled)).toBe('23.4000000');
  expect(formatExactGbp(report.knownSubtotal.penceScaled)).toBe('5.73600000000000');
  expect(formatGbp(report.knownSubtotal.penceScaled)).toBe('£5.74');
  expect(report.energyComplete && report.costComplete).toBe(true);
});
test('partial reports clip open ends and ignore future rates', () => {
  const report = calculate(
    [power()],
    [
      tariff({ effectiveTo: '2026-10-01' }),
      tariff({ id: 'later', effectiveFrom: '2026-10-01', unitRateMinorPerKwh: '100' }),
    ],
    { from: '2026-09-10', to: '2026-09-12' },
  );
  expect(report.segments).toHaveLength(1);
  expect(formatGbp(report.knownSubtotal.penceScaled)).toBe('£0.42');
});
test('missing power and missing tariffs report separate coverage and merged missing dates', () => {
  const report = calculate(
    [
      power({ effectiveFrom: '2026-09-05', effectiveTo: '2026-09-10' }),
      power({ id: 'later', effectiveFrom: '2026-09-20' }),
    ],
    [tariff({ effectiveFrom: '2026-09-08' })],
  );
  expect(report.missingPower).toEqual([
    { from: '2026-09-01', to: '2026-09-05' },
    { from: '2026-09-10', to: '2026-09-20' },
  ]);
  expect(report.missingTariff).toEqual([{ from: '2026-09-01', to: '2026-09-08' }]);
  expect(report.missingCost).toEqual([
    { from: '2026-09-01', to: '2026-09-08' },
    { from: '2026-09-10', to: '2026-09-20' },
  ]);
  expect(report.energyComplete).toBe(false);
  expect(report.costComplete).toBe(false);
});
test('no power history is unknown, not a zero total', () => {
  expect(calculate([])).toMatchObject({
    energyComplete: false,
    costComplete: false,
    missingPower: [range],
    missingCost: [range],
  });
});
test.each([{ powerWatts: '0' }, { hoursPerDay: '0' }])(
  'explicit zero %j is known even without tariffs',
  (values) => {
    expect(calculate([power(values)], [])).toMatchObject({
      energyComplete: true,
      costComplete: true,
      knownSubtotal: { kwhScaled: 0n, penceScaled: 0n },
      missingTariff: [range],
    });
  },
);
test('zero tariff is known zero cost while positive power without a rate is unknown cost', () => {
  expect(calculate([power()], [tariff({ unitRateMinorPerKwh: '0' })])).toMatchObject({
    costComplete: true,
    knownSubtotal: { penceScaled: 0n },
  });
  expect(calculate([power()], [])).toMatchObject({ energyComplete: true, costComplete: false });
});
test('nonpowered Equipment is not applicable only when it has no effective history', () => {
  expect(
    calculateEquipmentEnergy({ usesPower: false, range, powerPeriods: [], tariffs: [] }),
  ).toMatchObject({ applicable: false, segments: [] });
  expect(
    calculateEquipmentEnergy({
      usesPower: false,
      range,
      hasPowerHistory: true,
      powerPeriods: [],
      tariffs: [],
    }),
  ).toMatchObject({ applicable: true, energyComplete: false });
  expect(
    calculateEquipmentEnergy({
      usesPower: false,
      range,
      powerPeriods: [power()],
      tariffs: [tariff()],
    }).knownSubtotal,
  ).toEqual(calculate().knownSubtotal);
});
test('voided records cannot contribute or block replacements', () => {
  const report = calculate(
    [power({ id: 'void', voidedAt: '2026-09-01' }), power()],
    [tariff({ id: 'void', voidedAt: '2026-09-01' }), tariff()],
  );
  expect(report.knownSubtotal).toEqual(calculate().knownSubtotal);
});
test('nursery totals retain exact subtotals and incomplete coverage', () => {
  const combined = combineEnergyReports([calculate(), calculate(), calculate([])]);
  expect(formatGbp(combined.knownSubtotal.penceScaled)).toBe('£12.60');
  expect(combined.energyComplete).toBe(false);
  expect(combined.costComplete).toBe(false);
});
test('round only after all days and Equipment are summed; half pennies round up', () => {
  const tiny = calculate(
    [power({ powerWatts: '1', hoursPerDay: '1' })],
    [tariff({ unitRateMinorPerKwh: '25' })],
  );
  expect(formatGbp(tiny.knownSubtotal.penceScaled)).toBe('£0.01'); // 30 × .025p = .75p
  const sum = combineEnergyReports([tiny, tiny]);
  expect(formatGbp(sum.knownSubtotal.penceScaled)).toBe('£0.02'); // 1.5p, not daily rounded zero
  expect(formatGbp(500_000_000_000n)).toBe('£0.01');
  expect(formatGbp(499_999_999_999n)).toBe('£0.00');
});
describe('calendar days, not elapsed milliseconds', () => {
  test.each([
    ['2024-02-01', '2024-03-01', 29],
    ['2025-02-01', '2025-03-01', 28],
    ['2026-03-28', '2026-03-30', 2],
    ['2026-10-24', '2026-10-26', 2],
    ['2026-12-31', '2027-01-02', 2],
    ['1900-02-28', '1900-03-01', 1],
    ['2000-02-28', '2000-03-01', 2],
  ])('%s to %s covers %i calendar days', (from, to, days) => {
    expect(calendarOrdinal(to) - calendarOrdinal(from)).toBe(days);
    const report = calculate(
      [power({ effectiveFrom: '0001-01-01' })],
      [tariff({ effectiveFrom: '0001-01-01' })],
      { from, to },
    );
    expect(report.knownSubtotal.penceScaled).toBe(21n * 10n ** 12n * BigInt(days));
  });
});
test('multiple changes remain deterministic with unsorted input', () => {
  const periods = [
    power({ effectiveTo: '2026-09-10' }),
    power({ id: 'b', effectiveFrom: '2026-09-10', effectiveTo: '2026-09-20' }),
    power({ id: 'c', effectiveFrom: '2026-09-20' }),
  ];
  const rates = [
    tariff({ effectiveTo: '2026-09-05' }),
    tariff({ id: 'b', effectiveFrom: '2026-09-05', effectiveTo: '2026-09-25' }),
    tariff({ id: 'c', effectiveFrom: '2026-09-25' }),
  ];
  expect(calculate(periods.reverse(), rates.reverse()).knownSubtotal).toEqual(
    calculate().knownSubtotal,
  );
});
test('invalid ranges and overlapping source history fail instead of double counting', () => {
  expect(() => calculate([power(), power({ id: 'duplicate' })])).toThrow();
  expect(() => calculate([power()], [tariff(), tariff({ id: 'duplicate' })])).toThrow();
  expect(() => calculate([], [], { from: '2026-09-01', to: '2026-09-01' })).toThrow();
});
