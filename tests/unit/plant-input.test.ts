import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { PlantError } from '../../src/modules/plants/plant-errors';
import { parseCreatePlantInput } from '../../src/modules/plants/plant-input';

describe('Plant creation input', () => {
  test('accepts minimal input without inventing related records', () => {
    expect(parseCreatePlantInput({})).toEqual({
      name: null,
      status: 'GROWING',
      locationId: null,
      notes: null,
      parentage: null,
      purchase: null,
    });
  });

  test('normalises optional text and empty parentage', () => {
    expect(
      parseCreatePlantInput({
        name: '  Velvet  ',
        notes: ' \n ',
        parentage: { seedParentName: '  ', pollenParentName: null },
      }),
    ).toMatchObject({ name: 'Velvet', notes: null, parentage: null });
  });

  test('distinguishes an explicit empty purchase from no purchase', () => {
    expect(parseCreatePlantInput({ purchase: {} }).purchase).toEqual({
      seller: null,
      orderReference: null,
      purchaseDate: null,
      plantPriceMinor: null,
      shippingCostMinor: null,
      otherCostMinor: null,
      currency: 'GBP',
    });
    expect(parseCreatePlantInput({ purchase: null }).purchase).toBeNull();
  });

  test.each(['GROWING', 'QUARANTINE', 'SOLD', 'DECEASED'])('accepts status %s', (status) => {
    expect(parseCreatePlantInput({ status }).status).toBe(status);
  });

  test.each([null, 0, 12500, 2_147_483_647])('preserves cost %s', (value) => {
    expect(
      parseCreatePlantInput({
        purchase: {
          plantPriceMinor: value,
          shippingCostMinor: value,
          otherCostMinor: value,
        },
      }).purchase,
    ).toMatchObject({ plantPriceMinor: value, shippingCostMinor: value, otherCostMinor: value });
  });

  for (const field of ['plantPriceMinor', 'shippingCostMinor', 'otherCostMinor']) {
    test.each([-1, 0.5, 2_147_483_648, NaN, Infinity, '0', ''])(
      'rejects invalid ' + field + ' %s',
      (value) => {
        expect(() => parseCreatePlantInput({ purchase: { [field]: value } })).toThrow(PlantError);
      },
    );
  }

  test.each(['2024-02-29', '2000-02-29', '2026-08-30', '0001-01-01', '9999-12-31'])(
    'accepts calendar date %s',
    (date) => {
      expect(
        parseCreatePlantInput({ purchase: { purchaseDate: date } }).purchase?.purchaseDate,
      ).toBe(date);
    },
  );

  test.each([
    '2025-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-00-01',
    '2026-13-01',
    '0000-01-01',
    '30/08/2026',
    '',
    '2026-08-30T12:00:00Z',
  ])('rejects invalid date %s', (date) => {
    expect(() => parseCreatePlantInput({ purchase: { purchaseDate: date } })).toThrow(PlantError);
  });

  test('normalises seller, order reference and recognised currency', () => {
    expect(
      parseCreatePlantInput({
        purchase: { seller: '  Nursery  ', orderReference: '  ORDER-1  ', currency: ' eur ' },
      }).purchase,
    ).toMatchObject({ seller: 'Nursery', orderReference: 'ORDER-1', currency: 'EUR' });
  });

  test.each(['ZZZ', 'GB', 'GBPP', '123', '', null])('rejects invalid currency %s', (currency) => {
    expect(() => parseCreatePlantInput({ purchase: { currency } })).toThrow(PlantError);
  });

  test('permits the same existing Plant in both parent roles and normalises UUID case', () => {
    const id = randomUUID();
    expect(
      parseCreatePlantInput({
        parentage: {
          seedParentPlantId: id.toUpperCase(),
          pollenParentPlantId: id,
          seedParentName: ' ',
        },
      }).parentage,
    ).toMatchObject({ seedParentPlantId: id, pollenParentPlantId: id, seedParentName: null });
  });

  test.each(['seed', 'pollen'])('rejects conflicting %s parent fields', (role) => {
    try {
      parseCreatePlantInput({
        parentage: { [`${role}ParentPlantId`]: randomUUID(), [`${role}ParentName`]: 'External' },
      });
      expect.fail('Expected conflicting parentage to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'INVALID_PARENT',
        issues: [{ field: `parentage.${role}ParentName`, message: expect.any(String) }],
      });
    }
  });

  test.each([
    { locationId: 'invalid' },
    { locationId: '' },
    { parentage: { seedParentPlantId: 'ANT-0001' } },
    { parentage: { pollenParentPlantId: 'invalid' } },
    { status: 'BREEDING' },
    { status: null },
    { name: 'bad\0text' },
    null,
    [],
  ])('rejects malformed input %j', (input) => {
    expect(() => parseCreatePlantInput(input)).toThrow(PlantError);
  });

  test.each([
    { id: randomUUID() },
    { reference: 'ANT-0001' },
    { createdAt: new Date() },
    { updatedAt: new Date() },
    { archivedAt: new Date() },
    { photos: { create: {} } },
    { location: { connect: { id: randomUUID() } } },
    { purchase: { create: {} } },
    { purchase: { plantId: randomUUID() } },
    { parentage: { connect: { id: randomUUID() } } },
    { parentage: { plantId: randomUUID() } },
  ])('rejects protected fields and Prisma operations %j', (input) => {
    expect(() => parseCreatePlantInput(input)).toThrow(PlantError);
  });
});
