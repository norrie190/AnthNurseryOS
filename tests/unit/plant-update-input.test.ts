import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { parseUpdatePlantInput } from '../../src/modules/plants/plant-update-input';
import { PlantError } from '../../src/modules/plants/plant-errors';

const id = randomUUID();
const expectedUpdatedAt = '2026-08-30T12:00:00.000Z';
function parse(input: Record<string, unknown>) {
  return parseUpdatePlantInput(id, { expectedUpdatedAt, ...input }).input;
}

test('omissions and explicit undefined do not acquire creation defaults', () => {
  expect(parse({})).toEqual({ expectedUpdatedAt });
  expect(parse({ name: undefined, purchase: {} })).toEqual({
    expectedUpdatedAt,
    name: undefined,
    purchase: {},
  });
});
test('normalises text, IDs and currency while retaining explicit null and zero', () => {
  expect(
    parse({
      name: '  ',
      notes: null,
      locationId: id.toUpperCase(),
      purchase: {
        seller: ' Nursery ',
        orderReference: ' ORDER ',
        currency: ' eur ',
        plantPriceMinor: 0,
        shippingCostMinor: null,
      },
    }),
  ).toMatchObject({
    name: null,
    notes: null,
    locationId: id,
    purchase: {
      seller: 'Nursery',
      orderReference: 'ORDER',
      currency: 'EUR',
      plantPriceMinor: 0,
      shippingCostMinor: null,
    },
  });
});
test.each(['GROWING', 'QUARANTINE', 'SOLD', 'DECEASED'])('accepts status %s', (status) =>
  expect(parse({ status }).status).toBe(status),
);
test.each([
  { kind: 'unknown' },
  { kind: 'plant', plantId: id },
  { kind: 'external', name: ' Named ' },
])('accepts a complete parent choice %j', (choice) =>
  expect(parse({ parentage: { seedParent: choice } }).parentage?.seedParent).toBeDefined(),
);
test.each([
  { id },
  { reference: 'ANT-9999' },
  { createdAt: expectedUpdatedAt },
  { updatedAt: expectedUpdatedAt },
  { archivedAt: null },
  { status: null },
  { status: 'BREEDING' },
  { locationId: '' },
  { locationId: 'bad' },
  { name: 'bad\0text' },
  { purchase: null },
  { parentage: null },
  { purchase: { delete: true } },
  { purchase: { id } },
  { photos: {} },
  { location: { connect: { id } } },
  { parentage: { seedParent: { kind: 'plant', plantId: id, name: 'conflict' } } },
  { parentage: { seedParent: { kind: 'plant', plantId: 'ANT-0001' } } },
  { parentage: { seedParent: { kind: 'external', name: '  ' } } },
  { parentage: { seedParent: { kind: 'unknown', plantId: id } } },
  { parentage: { create: {} } },
  { purchase: { currency: 'ZZZ' } },
  { purchase: { currency: null } },
  { expectedUpdatedAt: undefined },
  { expectedUpdatedAt: '2026-08-30' },
  { expectedUpdatedAt: 'invalid' },
])('rejects invalid or protected input %j', (input) =>
  expect(() => parse(input)).toThrow(PlantError),
);
for (const field of ['plantPriceMinor', 'shippingCostMinor', 'otherCostMinor']) {
  test.each([-1, 0.5, 2_147_483_648, NaN, Infinity, '0'])(
    'rejects invalid ' + field + ' %s',
    (value) => expect(() => parse({ purchase: { [field]: value } })).toThrow(PlantError),
  );
  test.each([null, 0, 12550, 2_147_483_647])('accepts ' + field + ' %s', (value) =>
    expect(parse({ purchase: { [field]: value } }).purchase).toEqual({ [field]: value }),
  );
}
test.each(['2024-02-29', '0001-01-01', '9999-12-31', null])(
  'accepts purchase date %s',
  (purchaseDate) =>
    expect(parse({ purchase: { purchaseDate } }).purchase?.purchaseDate).toBe(purchaseDate),
);
test.each(['2025-02-29', '2026-04-31', '0000-01-01', '', '13/08/2026'])(
  'rejects invalid purchase date %s',
  (purchaseDate) => expect(() => parse({ purchase: { purchaseDate } })).toThrow(PlantError),
);
test('rejects malformed target ID', () =>
  expect(() => parseUpdatePlantInput('ANT-0001', { expectedUpdatedAt })).toThrow(PlantError));
