import { describe, expect, test } from 'vitest';
import {
  parseCreateEquipmentInput,
  parseUpdateEquipmentInput,
  parseEquipmentArchiveInput,
  suggestedEquipmentCategories,
} from './equipment-input';
import { EquipmentError } from './equipment-errors';
import { formatEquipmentReference } from './equipment-reference';

const id = 'ba576170-0776-4f0e-90d9-353cc6518611';
const token = { expectedUpdatedAt: '2026-08-31T12:00:00.000Z' };
const minimal = { name: 'Light', usesPower: true };

test.each([
  [1n, 'EQP-0001'],
  [9999n, 'EQP-9999'],
  [10000n, 'EQP-10000'],
  [9223372036854775807n, 'EQP-9223372036854775807'],
])('formats %s exactly', (value, expected) => {
  expect(formatEquipmentReference(value)).toBe(expected);
});
test.each([0n, -1n, 1, '1', null])('rejects invalid allocation %s', (value) => {
  expect(() => formatEquipmentReference(value as bigint)).toThrow();
});
test.each([true, false])('requires explicit boolean; accepts %s', (usesPower) => {
  expect(parseCreateEquipmentInput({ ...minimal, usesPower })).toMatchObject({
    usesPower,
    category: 'Other',
  });
});
test('normalises optional text without inventing a purchase', () => {
  expect(
    parseCreateEquipmentInput({
      name: ' Rack ',
      usesPower: false,
      brand: ' ',
      model: null,
      serialNumber: ' S1 ',
      notes: ' notes ',
    }),
  ).toEqual({
    name: 'Rack',
    usesPower: false,
    category: 'Other',
    brand: null,
    model: null,
    serialNumber: 'S1',
    notes: 'notes',
  });
});
test.each(suggestedEquipmentCategories)(
  'canonicalises suggested category %s without inferring power',
  (category) => {
    expect(
      parseCreateEquipmentInput({
        ...minimal,
        category: ` ${category.toLowerCase().replaceAll(' ', '   ')} `,
        usesPower: false,
      }),
    ).toMatchObject({ category, usesPower: false });
  },
);
test('keeps a custom category after whitespace cleanup', () => {
  expect(
    parseCreateEquipmentInput({ ...minimal, category: '  Propagation   Tools ' }).category,
  ).toBe('Propagation Tools');
});
test('preserves patch omission/null/zero and unknown purchase group', () => {
  expect(
    parseUpdateEquipmentInput(id, {
      ...token,
      brand: null,
      notes: ' ',
      purchase: { equipmentPriceMinor: 0, shippingCostMinor: null },
    }).input,
  ).toEqual({
    ...token,
    brand: null,
    notes: null,
    purchase: { equipmentPriceMinor: 0, shippingCostMinor: null },
  });
  expect(parseUpdateEquipmentInput(id, { ...token, purchase: {} }).input.purchase).toEqual({});
  expect(parseCreateEquipmentInput({ ...minimal, purchase: {} }).purchase).toEqual({});
});
test('normalises currencies/UUIDs and preserves calendar dates and integer costs', () => {
  const parsed = parseCreateEquipmentInput({
    ...minimal,
    locationId: ` ${id.toUpperCase()} `,
    purchase: {
      currency: ' gbp ',
      purchaseDate: '2024-02-29',
      equipmentPriceMinor: 2147483647,
      shippingCostMinor: 0,
      otherCostMinor: null,
    },
  });
  expect(parsed).toMatchObject({
    locationId: id,
    purchase: {
      currency: 'GBP',
      purchaseDate: '2024-02-29',
      equipmentPriceMinor: 2147483647,
      shippingCostMinor: 0,
      otherCostMinor: null,
    },
  });
});
describe('strict boundaries', () => {
  const invalid = [
    {},
    { name: 'Light' },
    { usesPower: true },
    { ...minimal, usesPower: 'false' },
    { ...minimal, usesPower: 0 },
    { ...minimal, name: '' },
    { ...minimal, name: ' ' },
    { ...minimal, name: null },
    { ...minimal, name: 'x'.repeat(201) },
    { ...minimal, category: ' ' },
    { ...minimal, category: null },
    { ...minimal, category: 'x'.repeat(81) },
    { ...minimal, brand: 'x'.repeat(201) },
    { ...minimal, model: 'x'.repeat(201) },
    { ...minimal, serialNumber: 'x'.repeat(201) },
    { ...minimal, notes: 'x'.repeat(10001) },
    { ...minimal, notes: 'a\0b' },
    { ...minimal, locationId: 'not-uuid' },
    { ...minimal, purchase: null },
    { ...minimal, purchase: { seller: 'x'.repeat(201) } },
    { ...minimal, purchase: { orderReference: 'x'.repeat(201) } },
    { ...minimal, purchase: { purchaseDate: '2023-02-29' } },
    { ...minimal, purchase: { purchaseDate: '2026-04-31' } },
    { ...minimal, purchase: { purchaseDate: '0000-01-01' } },
    { ...minimal, purchase: { purchaseDate: '2026-01-01T00:00:00Z' } },
    { ...minimal, purchase: { currency: 'XYZ' } },
    { ...minimal, purchase: { currency: null } },
    { ...minimal, location: { connect: { id } } },
    ...['id', 'reference', 'createdAt', 'updatedAt', 'archivedAt'].map((key) => ({
      ...minimal,
      [key]: id,
    })),
    ...['equipmentPriceMinor', 'shippingCostMinor', 'otherCostMinor'].flatMap((key) =>
      [-1, 0.5, 2147483648, NaN, Infinity, '10', { increment: 1 }].map((value) => ({
        ...minimal,
        purchase: { [key]: value },
      })),
    ),
    { ...minimal, purchase: { create: {} } },
    { ...minimal, purchase: { equipmentId: id } },
  ];
  test.each(invalid.map((input, index) => [index, input] as const))(
    'rejects create case %i',
    (_, input) => {
      expect(() => parseCreateEquipmentInput(input)).toThrow(EquipmentError);
    },
  );
  test.each(['id', 'reference', 'createdAt', 'updatedAt', 'archivedAt', 'location', 'delete'])(
    'rejects edit injection %s',
    (field) => {
      expect(() => parseUpdateEquipmentInput(id, { ...token, [field]: id })).toThrow(
        EquipmentError,
      );
    },
  );
  test.each([
    { purchase: null },
    { purchase: { delete: true } },
    { purchase: { upsert: {} } },
    { name: null },
    { usesPower: 'true' },
    { category: ' ' },
  ])('rejects bad edit %j', (input) => {
    expect(() => parseUpdateEquipmentInput(id, { ...token, ...input })).toThrow(EquipmentError);
  });
  test.each(['not-uuid', '', 'EQP-0001'])('rejects malformed mutation ID %s', (value) => {
    expect(() => parseUpdateEquipmentInput(value, token)).toThrow(EquipmentError);
    expect(() => parseEquipmentArchiveInput(value, token)).toThrow(EquipmentError);
  });
  test.each([
    {},
    { expectedUpdatedAt: new Date() },
    { expectedUpdatedAt: '2026-08-31' },
    { ...token, archivedAt: null },
  ])('rejects invalid archive token/input %j', (input) => {
    expect(() => parseEquipmentArchiveInput(id, input)).toThrow(EquipmentError);
  });
});
test('returns useful field issues and preserves validation cause', () => {
  try {
    parseUpdateEquipmentInput(id, { ...token, purchase: { equipmentPriceMinor: -1 } });
  } catch (error) {
    expect(error).toMatchObject({
      code: 'VALIDATION_FAILED',
      issues: [{ field: 'purchase.equipmentPriceMinor', message: expect.any(String) }],
      cause: expect.any(Error),
    });
    return;
  }
  throw new Error('Expected validation failure');
});
test('accepts exact text length limits', () => {
  expect(() =>
    parseCreateEquipmentInput({
      name: 'x'.repeat(200),
      usesPower: false,
      category: 'x'.repeat(80),
      brand: 'x'.repeat(200),
      model: 'x'.repeat(200),
      serialNumber: 'x'.repeat(200),
      notes: 'x'.repeat(10000),
      purchase: { seller: 'x'.repeat(200), orderReference: 'x'.repeat(200) },
    }),
  ).not.toThrow();
});
