import { expect, test } from 'vitest';
import { BreedingError } from './breeding-errors';
import {
  parseCreateInflorescenceInput,
  parseCreatePollinationAttemptInput,
} from './breeding-input';
import { formatBreedingCross } from './breeding-provenance';

test('normalises breeding text and accepts the three coherent pollen sources', () => {
  expect(parseCreateInflorescenceInput({ notes: '  note  ' }).notes).toBe('note');
  expect(
    parseCreatePollinationAttemptInput({
      pollinatedOn: '2026-01-01',
      pollenSource: {
        mode: 'EXTERNAL',
        pollenParentName: '  Parent  ',
        pollenBreeder: '  Breeder ',
      },
    }).pollenSource,
  ).toMatchObject({ mode: 'EXTERNAL', pollenParentName: 'Parent', pollenBreeder: 'Breeder' });
});

test('rejects contradictory or incomplete pollen source input', () => {
  expect(() =>
    parseCreatePollinationAttemptInput({
      pollinatedOn: '2026-01-01',
      pollenSource: { mode: 'INTERNAL', pollenParentPlantId: 'bad', pollenParentName: 'x' },
    }),
  ).toThrow(BreedingError);
  expect(() =>
    parseCreatePollinationAttemptInput({
      pollinatedOn: '2026-01-01',
      pollenSource: { mode: 'UNKNOWN', pollenParentName: 'x' },
    }),
  ).toThrow(BreedingError);
});

test('formats stable provenance labels from Plant references', () => {
  expect(
    formatBreedingCross(
      { reference: 'ANT-0001' },
      { pollenSourceMode: 'INTERNAL', pollenParent: { reference: 'ANT-0002' } },
    ),
  ).toBe('ANT-0001 × ANT-0002');
  expect(
    formatBreedingCross(
      { reference: 'ANT-0001' },
      { pollenSourceMode: 'INTERNAL', pollenParent: { reference: 'ANT-0001' } },
    ),
  ).toBe('ANT-0001 × ANT-0001');
  expect(
    formatBreedingCross(
      { reference: 'ANT-0001' },
      { pollenSourceMode: 'EXTERNAL', pollenParentName: 'Parent Label' },
    ),
  ).toBe('ANT-0001 × External Parent Label');
  expect(formatBreedingCross({ reference: 'ANT-0001' }, { pollenSourceMode: 'UNKNOWN' })).toBe(
    'ANT-0001 × Unknown pollen',
  );
});
