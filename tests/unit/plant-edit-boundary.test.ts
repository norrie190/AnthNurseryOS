import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { updatePlantAction } from '../../src/modules/plants/plant-actions';
import { updatePlant, type UpdatedPlant } from '../../src/modules/plants/plant-update-service';
import { PlantError } from '../../src/modules/plants/plant-errors';
import { parsePlantEditFormData } from '../../src/modules/plants/plant-form-data';
import {
  initialPlantFormState,
  initialPlantFormValues,
} from '../../src/modules/plants/plant-form-state';
import { formatMoneyInput, parseMoneyInput } from '../../src/modules/plants/plant-money';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('../../src/modules/plants/plant-service', () => ({ createPlant: vi.fn() }));
vi.mock('../../src/modules/plants/plant-update-service', () => ({ updatePlant: vi.fn() }));
const id = randomUUID();
const token = '2026-08-30T12:00:00.000Z';
const signal = new Error('Next redirect');
function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...initialPlantFormValues, ...overrides }))
    data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(redirect).mockImplementation(() => {
    throw signal;
  });
});
afterEach(() => vi.restoreAllMocks());
test('interprets parent modes and omits an inactive purchase', () => {
  const result = parsePlantEditFormData(
    form({
      seedParentMode: 'existing',
      seedParentPlantId: id,
      seedParentName: 'inactive',
      pollenParentMode: 'unknown',
      pollenParentName: 'inactive',
    }),
    token,
  );
  expect(result).toMatchObject({
    success: true,
    input: {
      expectedUpdatedAt: token,
      parentage: { seedParent: { kind: 'plant', plantId: id }, pollenParent: { kind: 'unknown' } },
    },
  });
  if (result.success) expect(result.input).not.toHaveProperty('purchase');
});
test('converts money exactly and sends intentionally blank fields as clear values', () => {
  expect(
    parsePlantEditFormData(
      form({ recordPurchase: 'on', plantPrice: '125.50', shippingCost: '', otherCost: '0' }),
      token,
    ),
  ).toMatchObject({
    success: true,
    input: {
      locationId: null,
      purchase: {
        plantPriceMinor: 12550,
        shippingCostMinor: null,
        otherCostMinor: 0,
        purchaseDate: null,
      },
    },
  });
});
test.each([
  'name',
  'status',
  'locationId',
  'notes',
  'seedParentMode',
  'pollenParentMode',
  'seller',
  'currency',
  'plantPrice',
])('rejects incomplete edit transport instead of clearing missing %s', (field) => {
  const data = form({ recordPurchase: 'on' });
  data.delete(field);
  expect(parsePlantEditFormData(data, token).success).toBe(false);
});
test.each([
  'id',
  'reference',
  'createdAt',
  'updatedAt',
  'archivedAt',
  'expectedUpdatedAt',
  'purchase.update',
])('rejects injected form field %s', (field) => {
  const data = form();
  data.set(field, 'injected');
  expect(parsePlantEditFormData(data, token).success).toBe(false);
});
test('rejects duplicate values and files', () => {
  const data = form();
  data.append('notes', 'duplicate');
  expect(parsePlantEditFormData(data, token).success).toBe(false);
  const fileData = form();
  fileData.set('name', new File(['photo'], 'image.png'));
  expect(parsePlantEditFormData(fileData, token).success).toBe(false);
});
test.each([
  [null, 'GBP', ''],
  [0, 'GBP', '0.00'],
  [12550, 'GBP', '125.50'],
  [1, 'GBP', '0.01'],
  [2147483647, 'GBP', '21474836.47'],
  [123, 'JPY', '123'],
  [1234, 'KWD', '1.234'],
] as const)('round trips minor amount %s in %s', (minor, currency, text) => {
  expect(formatMoneyInput(minor, currency)).toBe(text);
  expect(parseMoneyInput(text, currency)).toBe(minor);
});
test('calls updatePlant and redirects using the saved UUID', async () => {
  vi.mocked(updatePlant).mockResolvedValue({ id, reference: 'ANT-0001' } as UpdatedPlant);
  await expect(
    updatePlantAction(id, token, initialPlantFormState, form({ name: 'Updated' })),
  ).rejects.toBe(signal);
  expect(updatePlant).toHaveBeenCalledWith(
    id,
    expect.objectContaining({ name: 'Updated', expectedUpdatedAt: token }),
  );
  expect(redirect).toHaveBeenCalledWith(`/plants/${id}`);
});
test('does not call the service on invalid money', async () => {
  const result = await updatePlantAction(
    id,
    token,
    initialPlantFormState,
    form({ recordPurchase: 'on', plantPrice: '125.555' }),
  );
  expect(result.fieldErrors.plantPrice).toBeTruthy();
  expect(updatePlant).not.toHaveBeenCalled();
});
test('maps cycle errors to the parent control', async () => {
  vi.mocked(updatePlant).mockRejectedValue(
    new PlantError('ANCESTRY_CYCLE', 'Parentage loop.', {
      issues: [{ field: 'parentage.seedParent.plantId', message: 'Choose another Plant.' }],
    }),
  );
  expect(await updatePlantAction(id, token, initialPlantFormState, form())).toEqual({
    message: 'Parentage loop.',
    fieldErrors: { seedParentPlantId: 'Choose another Plant.' },
  });
});
test('returns a stale marker without retrying or replacing the token', async () => {
  vi.mocked(updatePlant).mockRejectedValue(
    new PlantError('STALE_UPDATE', 'Review the latest details.'),
  );
  expect(await updatePlantAction(id, token, initialPlantFormState, form())).toMatchObject({
    stale: true,
  });
  expect(updatePlant).toHaveBeenCalledOnce();
  expect(redirect).not.toHaveBeenCalled();
});
test.each(['NOT_FOUND', 'INVALID_PARENT', 'LOCATION_UNAVAILABLE', 'VALIDATION_FAILED'] as const)(
  'returns safe %s feedback',
  async (code) => {
    vi.mocked(updatePlant).mockRejectedValue(new PlantError(code, 'Check these details.'));
    expect((await updatePlantAction(id, token, initialPlantFormState, form())).message).toBe(
      'Check these details.',
    );
  },
);
test.each([new Error('secret SQL'), new PlantError('CONFLICT', 'secret constraint')])(
  'keeps diagnostics out of the response',
  async (error) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(updatePlant).mockRejectedValue(error);
    expect(
      JSON.stringify(await updatePlantAction(id, token, initialPlantFormState, form())),
    ).not.toContain('secret');
    expect(log).toHaveBeenCalledWith(expect.any(String), error);
  },
);
