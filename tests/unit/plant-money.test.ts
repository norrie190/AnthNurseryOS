import { expect, test } from 'vitest';
import { parseMoneyInput, formatPlantMoney } from '../../src/modules/plants/plant-money';

test.each([
  ['', null],
  ['   ', null],
  ['0', 0],
  ['0.00', 0],
  ['125', 12500],
  ['125.50', 12550],
  ['0.29', 29],
  ['1.1', 110],
  [' 001.01 ', 101],
])('converts GBP input %s to %s minor units exactly', (text, expected) => {
  expect(parseMoneyInput(text, 'GBP')).toBe(expected);
});
test.each([
  '-1',
  '+1',
  '1.001',
  '.50',
  '1.',
  '1,000',
  '£125',
  '1e2',
  'NaN',
  'Infinity',
  '999999999999999999999',
])('rejects invalid amount %s', (text) => {
  expect(() => parseMoneyInput(text, 'GBP')).toThrow();
});
test('supports currency precision without conversion between currencies', () => {
  expect(parseMoneyInput('125', 'JPY')).toBe(125);
  expect(() => parseMoneyInput('125.50', 'JPY')).toThrow();
  expect(parseMoneyInput('1.234', 'KWD')).toBe(1234);
});
test('formats unknown, zero and known costs distinctly', () => {
  expect(formatPlantMoney(null, 'GBP')).toBe('Not recorded');
  expect(formatPlantMoney(0, 'GBP')).toBe('£0.00');
  expect(formatPlantMoney(12550, 'GBP')).toBe('£125.50');
});
