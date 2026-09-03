import { expect, test } from 'vitest';
import {
  formatGerminationProgress,
  formatSeedCount,
  germinationPercentage,
} from './seed-batch-display';

test('formats known, zero and unknown seed counts safely', () => {
  expect(formatSeedCount(null)).toBe('Seed count unknown');
  expect(formatSeedCount(0)).toBe('0 seeds recorded');
  expect(formatSeedCount(1)).toBe('1 seed');
  expect(formatSeedCount(20)).toBe('20 seeds');
});

test('formats germination progress without inventing a denominator', () => {
  expect(formatGerminationProgress(null, 20)).toBe('Germination not counted');
  expect(formatGerminationProgress(8, 20)).toBe('8 of 20 germinated');
  expect(formatGerminationProgress(8, null)).toBe('8 germinated · total seed count unknown');
  expect(formatGerminationProgress(0, 0)).toBe('0 germinated · 0 seeds recorded');
  expect(germinationPercentage(8, 20)).toBe(40);
  expect(germinationPercentage(0, 0)).toBeNull();
  expect(germinationPercentage(null, 20)).toBeNull();
});
