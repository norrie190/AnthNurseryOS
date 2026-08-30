import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { createPlantAction } from '../../src/modules/plants/plant-actions';
import { createPlant, type CreatedPlant } from '../../src/modules/plants/plant-service';
import { PlantError } from '../../src/modules/plants/plant-errors';
import { initialPlantFormState } from '../../src/modules/plants/plant-form-state';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('../../src/modules/plants/plant-service', () => ({ createPlant: vi.fn() }));
const redirectSignal = new Error('redirect signal');

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(redirect).mockImplementation(() => {
    throw redirectSignal;
  });
});
afterEach(() => vi.restoreAllMocks());

test('calls the service and redirects using only the saved internal UUID', async () => {
  vi.mocked(createPlant).mockResolvedValue({
    id: 'returned-uuid',
    reference: 'ANT-0042',
  } as CreatedPlant);
  const data = new FormData();
  data.set('recordPurchase', 'on');
  data.set('plantPrice', '125.50');
  await expect(createPlantAction(initialPlantFormState, data)).rejects.toBe(redirectSignal);
  expect(createPlant).toHaveBeenCalledOnce();
  expect(createPlant).toHaveBeenCalledWith(
    expect.objectContaining({ purchase: expect.objectContaining({ plantPriceMinor: 12550 }) }),
  );
  expect(redirect).toHaveBeenCalledWith('/plants/returned-uuid');
});
test('does not call the service for invalid boundary values', async () => {
  const data = new FormData();
  data.set('reference', 'ANT-0001');
  expect((await createPlantAction(initialPlantFormState, data)).message).toBeTruthy();
  expect(createPlant).not.toHaveBeenCalled();
  expect(redirect).not.toHaveBeenCalled();
});
test('maps service issue paths to visible form fields', async () => {
  vi.mocked(createPlant).mockRejectedValue(
    new PlantError('VALIDATION_FAILED', 'Check these details.', {
      issues: [
        { field: 'purchase.plantPriceMinor', message: 'Amount is too large.' },
        { field: 'parentage.seedParentPlantId', message: 'Invalid UUID.' },
      ],
    }),
  );
  expect(await createPlantAction(initialPlantFormState, new FormData())).toEqual({
    message: 'Check these details.',
    fieldErrors: { plantPrice: 'Amount is too large.', seedParentPlantId: 'Invalid UUID.' },
  });
});
test.each(['INVALID_PARENT', 'LOCATION_UNAVAILABLE'] as const)(
  'returns expected %s feedback',
  async (code) => {
    vi.mocked(createPlant).mockRejectedValue(new PlantError(code, 'Choose an available record.'));
    expect((await createPlantAction(initialPlantFormState, new FormData())).message).toBe(
      'Choose an available record.',
    );
  },
);
test.each([
  new Error('secret database password'),
  new PlantError('CONFLICT', 'secret constraint detail'),
])('never sends database diagnostics to the browser', async (error) => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(createPlant).mockRejectedValue(error);
  const result = await createPlantAction(initialPlantFormState, new FormData());
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(log).toHaveBeenCalledWith(expect.any(String), error);
  expect(redirect).not.toHaveBeenCalled();
});
