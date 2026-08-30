import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { parsePlantFormData } from '../../src/modules/plants/plant-form-data';

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
test('converts a minimal form without inventing a purchase, reference or ID', () => {
  expect(parsePlantFormData(new FormData())).toEqual({
    success: true,
    input: {
      name: '',
      status: 'GROWING',
      locationId: null,
      notes: '',
      parentage: {},
      purchase: undefined,
    },
  });
});
test('only passes the active parent role values', () => {
  const id = randomUUID();
  const result = parsePlantFormData(
    form({
      seedParentMode: 'existing',
      seedParentPlantId: id,
      seedParentName: 'Inactive',
      pollenParentMode: 'external',
      pollenParentPlantId: id,
      pollenParentName: 'External parent',
    }),
  );
  expect(result).toMatchObject({
    success: true,
    input: { parentage: { seedParentPlantId: id, pollenParentName: 'External parent' } },
  });
  if (result.success)
    expect(result.input.parentage).toEqual({
      seedParentPlantId: id,
      pollenParentName: 'External parent',
    });
});
test('ignores inactive parent and purchase values', () => {
  expect(
    parsePlantFormData(
      form({ seedParentPlantId: randomUUID(), seedParentName: 'Inactive', plantPrice: 'bad' }),
    ),
  ).toMatchObject({ success: true, input: { parentage: {}, purchase: undefined } });
});
test('preserves an explicit purchase with unknown details', () => {
  expect(parsePlantFormData(form({ recordPurchase: 'on' }))).toMatchObject({
    success: true,
    input: {
      purchase: {
        currency: 'GBP',
        purchaseDate: null,
        plantPriceMinor: null,
        shippingCostMinor: null,
        otherCostMinor: null,
      },
    },
  });
});
test('converts money once at the boundary, retaining null and zero', () => {
  expect(
    parsePlantFormData(
      form({
        recordPurchase: 'on',
        plantPrice: '125.50',
        shippingCost: '0',
        otherCost: '',
        currency: ' gbp ',
      }),
    ),
  ).toMatchObject({
    success: true,
    input: {
      purchase: {
        currency: 'GBP',
        plantPriceMinor: 12550,
        shippingCostMinor: 0,
        otherCostMinor: null,
      },
    },
  });
});
test.each([
  [{ seedParentMode: 'existing' }, 'seedParentPlantId'],
  [{ pollenParentMode: 'external', pollenParentName: '  ' }, 'pollenParentName'],
  [{ seedParentMode: 'invalid' }, 'seedParentMode'],
  [{ recordPurchase: 'on', plantPrice: '1.001' }, 'plantPrice'],
  [{ recordPurchase: 'on', currency: 'invalid' }, 'currency'],
])('reports boundary validation errors for %j', (values, field) => {
  const result = parsePlantFormData(form(values));
  expect(result.success).toBe(false);
  if (!result.success)
    expect(result.state.fieldErrors[field as keyof typeof result.state.fieldErrors]).toBeTruthy();
});
test.each(['id', 'reference', 'createdAt', 'updatedAt', 'archivedAt', 'purchase.create', 'photos'])(
  'rejects injected field %s',
  (field) => {
    expect(parsePlantFormData(form({ [field]: 'injected' })).success).toBe(false);
  },
);
test('allows framework metadata without forwarding it', () => {
  const result = parsePlantFormData(form({ $ACTION_ID_example: 'framework' }));
  expect(result.success).toBe(true);
  if (result.success) expect(Object.keys(result.input)).not.toContain('$ACTION_ID_example');
});
test('rejects duplicate fields and file uploads', () => {
  const data = form({ name: 'First' });
  data.append('name', 'Second');
  expect(parsePlantFormData(data).success).toBe(false);
  data.set('name', new File(['content'], 'upload.txt'));
  expect(parsePlantFormData(data).success).toBe(false);
});
