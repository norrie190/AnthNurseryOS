import { expect, test } from 'vitest';
import { formatPlantReference } from '../../src/modules/plants/plant-reference';

test.each([
  [1n, 'ANT-0001'],
  [25n, 'ANT-0025'],
  [9999n, 'ANT-9999'],
  [10000n, 'ANT-10000'],
  [9223372036854775807n, 'ANT-9223372036854775807'],
])('formats sequence value %s without losing precision', (value, expected) => {
  expect(formatPlantReference(value)).toBe(expected);
});

test.each([0n, -1n])('rejects nonpositive sequence value %s', (value) => {
  expect(() => formatPlantReference(value)).toThrow(RangeError);
});
