import { expect, test, vi } from 'vitest';
import {
  powerWattsSchema,
  hoursPerDaySchema,
  tariffRateSchema,
  parseEnergy,
  recordPowerSchema,
  recordTariffSchema,
  correctPowerSchema,
} from './energy-input';
import { tariffTimelineToken, throwEnergyDatabaseError } from './energy-persistence';
import { EnergyError } from './energy-errors';
import { planCorrection, planSettingChange } from './energy-periods';

vi.mock('server-only', () => ({}));
const expectedUpdatedAt = '2026-09-01T00:00:00.000Z';
test.each([
  'NaN',
  'Infinity',
  '-Infinity',
  '1e2',
  '1,000',
  '.5',
  '1.',
  '',
  '-1',
  '1.001',
  '100000.01',
  1,
  null,
])('power rejects %j before rounding', (value) => {
  expect(() => parseEnergy(powerWattsSchema, value)).toThrow(EnergyError);
});
test.each(['24.01', '0.001', '1e1', 'NaN'])('hours reject %s', (value) => {
  expect(() => parseEnergy(hoursPerDaySchema, value)).toThrow(EnergyError);
});
test.each(['24.567891', '1000.00001', '1e2', '-0.00001', 'Infinity'])(
  'tariff rejects %s',
  (value) => {
    expect(() => parseEnergy(tariffRateSchema, value)).toThrow(EnergyError);
  },
);
test('approved values normalise using strings, not floating point multiplication', () => {
  expect(parseEnergy(powerWattsSchema, ' 00065.7 ')).toBe('65.70');
  expect(parseEnergy(hoursPerDaySchema, '24')).toBe('24.00');
  expect(parseEnergy(tariffRateSchema, '24.56789')).toBe('24.56789');
  expect(parseEnergy(tariffRateSchema, '0')).toBe('0.00000');
});
test.each([
  'id',
  'reference',
  'createdAt',
  'updatedAt',
  'voidedAt',
  'equipment',
  'data',
  'create',
  'delete',
])('arbitrary %s input is rejected', (key) => {
  expect(() =>
    parseEnergy(recordPowerSchema, {
      expectedUpdatedAt,
      powerWatts: '70',
      hoursPerDay: '12',
      effectiveFrom: '2026-09-01',
      [key]: {},
    }),
  ).toThrow(EnergyError);
});
test('tariffs are GBP only; correction requires reason and restricts nested boundary input', () => {
  expect(() =>
    parseEnergy(recordTariffSchema, {
      unitRateMinorPerKwh: '25',
      currency: 'USD',
      effectiveFrom: '2026-09-01',
      expectedTimelineToken: '0'.repeat(64),
    }),
  ).toThrow(EnergyError);
  expect(() =>
    parseEnergy(correctPowerSchema, { expectedUpdatedAt, correctionReason: ' \t' }),
  ).toThrow(EnergyError);
  expect(() =>
    parseEnergy(correctPowerSchema, {
      expectedUpdatedAt,
      correctionReason: 'Fix',
      adjacentAdjustments: [{ periodId: 'a', data: {} }],
    }),
  ).toThrow(EnergyError);
});
test('timeline token is deterministic, changes for edits/voids and never returns to the empty token after void', () => {
  const a = { id: 'a', updatedAt: new Date(expectedUpdatedAt), voidedAt: null };
  const b = { ...a, id: 'b' };
  expect(tariffTimelineToken([a, b])).toBe(tariffTimelineToken([b, a]));
  expect(tariffTimelineToken([a])).not.toBe(
    tariffTimelineToken([{ ...a, updatedAt: new Date('2026-09-01T00:00:00.001Z') }]),
  );
  expect(tariffTimelineToken([])).not.toBe(
    tariffTimelineToken([{ ...a, voidedAt: new Date(expectedUpdatedAt) }]),
  );
});
test('database errors map safely and unexpected infrastructure failures retain identity', () => {
  const cause = { meta: { driverAdapterError: { cause: { originalCode: '23P01' } } } };
  try {
    throwEnergyDatabaseError(cause);
  } catch (error) {
    expect(error).toMatchObject({ code: 'OVERLAP', cause });
  }
  const unexpected = new Error('connection failed');
  expect(() => throwEnergyDatabaseError(unexpected)).toThrow(unexpected);
});
test('change plans preserve existing future periods and known gaps', () => {
  const periods = [
    { id: 'a', effectiveFrom: '2026-09-01', effectiveTo: '2026-09-20' },
    { id: 'b', effectiveFrom: '2026-10-01', effectiveTo: null },
  ];
  expect(planSettingChange(periods, '2026-09-10').effectiveTo).toBe('2026-09-20');
  expect(planSettingChange(periods, '2026-09-25').effectiveTo).toBe('2026-10-01');
  expect(() => planSettingChange(periods, '2026-10-01')).toThrow();
});
test('shared boundary correction is explicit and ordered without needing deferred constraints', () => {
  const left = { id: 'a', effectiveFrom: '2026-09-01', effectiveTo: '2026-09-16' };
  const right = { id: 'b', effectiveFrom: '2026-09-16', effectiveTo: null };
  const proposed = { ...left, effectiveTo: '2026-09-20' };
  expect(() => planCorrection([left, right], left, proposed)).toThrow();
  const plan = planCorrection([left, right], left, proposed, [
    { periodId: 'b', effectiveFrom: '2026-09-20' },
  ]);
  expect(plan.map((row) => row.id)).toEqual(['b', 'a']);
  expect(() =>
    planCorrection([left, right], left, proposed, [{ periodId: 'b', effectiveTo: '2026-09-20' }]),
  ).toThrow();
});
