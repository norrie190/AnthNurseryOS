// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { createPlantAction } from './plant-actions';
import { createPlant } from './plant-service';
import { initialPlantFormState } from './plant-form-state';

vi.mock('server-only', () => ({}));
vi.mock('./plant-service', () => ({ createPlant: vi.fn() }));
vi.mock('./plant-update-service', () => ({ updatePlant: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const plant = {
  id: '12345678-1234-4234-8234-123456789abc',
  reference: 'ANT-0042',
  name: 'Anthurium arrival',
} as Awaited<ReturnType<typeof createPlant>>;
const redirectSignal = new Error('Redirect signal');

function form(intent?: string) {
  const data = new FormData();
  data.set('name', 'Anthurium arrival');
  if (intent !== undefined) data.set('submitIntent', intent);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createPlant).mockResolvedValue(plant);
  vi.mocked(redirect).mockImplementation(() => {
    throw redirectSignal;
  });
});

test('ordinary creation and an Enter-key submission redirect to the saved Plant', async () => {
  await expect(createPlantAction(initialPlantFormState, form())).rejects.toBe(redirectSignal);
  expect(createPlant).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'Anthurium arrival', status: 'GROWING' }),
  );
  expect(redirect).toHaveBeenCalledWith(`/plants/${plant.id}`);
});

test('rapid intake returns safe created Plant details without redirecting', async () => {
  await expect(createPlantAction(initialPlantFormState, form('addAnother'))).resolves.toEqual({
    message: 'ANT-0042 was added. You can enter the next Plant now.',
    fieldErrors: {},
    createdPlant: {
      id: plant.id,
      reference: plant.reference,
      name: plant.name,
    },
  });
  expect(redirect).not.toHaveBeenCalled();
});

test.each(['deleteEverything', ''])('rejects unsupported continuation %j', async (intent) => {
  const result = await createPlantAction(initialPlantFormState, form(intent));
  expect(result).toEqual({
    message: 'Choose how you would like to continue after saving.',
    fieldErrors: {},
  });
  expect(createPlant).not.toHaveBeenCalled();
});

test('rejects duplicate continuation fields', async () => {
  const data = form('view');
  data.append('submitIntent', 'addAnother');
  expect(await createPlantAction(initialPlantFormState, data)).toEqual({
    message: 'Choose how you would like to continue after saving.',
    fieldErrors: {},
  });
  expect(createPlant).not.toHaveBeenCalled();
});
