import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  parseCorrectWateringEventInput,
  parseRecordWateringEventInput,
  parseVoidWateringEventInput,
  parseWateringPlantId,
} from './watering-input';

const plantId = randomUUID();
const eventId = randomUUID();
const updatedAt = '2026-09-03T10:00:00.000Z';

test('record input normalizes IDs and optional notes', () => {
  expect(
    parseRecordWateringEventInput(plantId.toUpperCase(), {
      wateredAt: '2026-09-03T09:00:00.000Z',
      notes: '  Watered thoroughly  ',
    }),
  ).toEqual({
    plantId,
    input: {
      wateredAt: new Date('2026-09-03T09:00:00.000Z'),
      notes: 'Watered thoroughly',
    },
  });
  expect(
    parseRecordWateringEventInput(plantId, {
      wateredAt: '2026-09-03T09:00:00.000Z',
      notes: '   ',
    }).input.notes,
  ).toBeNull();
});

test.each([
  ['bad Plant ID', 'ANT-0001', { wateredAt: '2026-09-03T09:00:00.000Z' }],
  ['missing time', plantId, {}],
  ['invalid time', plantId, { wateredAt: 'not-a-time' }],
  ['wrong precision', plantId, { wateredAt: '2026-09-03T09:00:00Z' }],
  ['protected field', plantId, { wateredAt: updatedAt, amountMl: 100 }],
  ['null character', plantId, { wateredAt: updatedAt, notes: 'bad\0note' }],
] as const)('record rejects %s', (_label, id, input) => {
  expect(() => parseRecordWateringEventInput(id, input)).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_FAILED' }),
  );
});

test('correction trims its reason and supports clearing notes', () => {
  expect(
    parseCorrectWateringEventInput(plantId, eventId, {
      notes: null,
      correctionReason: '  Corrected diary entry  ',
      expectedUpdatedAt: updatedAt,
    }),
  ).toEqual({
    plantId,
    eventId,
    input: {
      notes: null,
      correctionReason: 'Corrected diary entry',
      expectedUpdatedAt: updatedAt,
    },
  });
});

test.each([
  { correctionReason: '', notes: 'x', expectedUpdatedAt: updatedAt },
  { correctionReason: '   ', notes: 'x', expectedUpdatedAt: updatedAt },
  { correctionReason: 'why', expectedUpdatedAt: updatedAt },
  { correctionReason: 'why', notes: 'x', expectedUpdatedAt: 'invalid' },
  { correctionReason: 'why', notes: 'x', expectedUpdatedAt: updatedAt, plantId },
])('correction rejects invalid or protected input %#', (input) => {
  expect(() => parseCorrectWateringEventInput(plantId, eventId, input)).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_FAILED' }),
  );
});

test('void input requires a trimmed reason and exact event token', () => {
  expect(
    parseVoidWateringEventInput(plantId, eventId, {
      correctionReason: '  Duplicate entry  ',
      expectedUpdatedAt: updatedAt,
    }),
  ).toEqual({
    plantId,
    eventId,
    input: { correctionReason: 'Duplicate entry', expectedUpdatedAt: updatedAt },
  });
  for (const correctionReason of ['', '  ']) {
    expect(() =>
      parseVoidWateringEventInput(plantId, eventId, {
        correctionReason,
        expectedUpdatedAt: updatedAt,
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  }
});

test('query Plant IDs use the same strict UUID boundary', () => {
  expect(parseWateringPlantId(plantId.toUpperCase())).toBe(plantId);
  expect(() => parseWateringPlantId('ANT-0001')).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_FAILED' }),
  );
});
