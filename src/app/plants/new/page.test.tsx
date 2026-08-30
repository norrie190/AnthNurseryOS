import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { connection } from 'next/server';
import { getPlantParentOptions, getUsableLocationOptions } from '@/modules/plants/plant-queries';
import AddPlantPage from './page';

vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('@/modules/plants/plant-actions', () => ({ createPlantAction: vi.fn() }));
vi.mock('@/modules/plants/plant-queries', () => ({
  getPlantParentOptions: vi.fn(),
  getUsableLocationOptions: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());

test('loads the form options on request with no prerequisite Plants or Locations', async () => {
  vi.mocked(getPlantParentOptions).mockResolvedValue([]);
  vi.mocked(getUsableLocationOptions).mockResolvedValue([]);
  render(await AddPlantPage());
  expect(connection).toHaveBeenCalledOnce();
  expect(getPlantParentOptions).toHaveBeenCalledOnce();
  expect(getUsableLocationOptions).toHaveBeenCalledOnce();
  expect(screen.getByRole('heading', { name: 'Add Plant' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Plant' })).toBeEnabled();
  expect(
    within(screen.getByRole('combobox', { name: /Location/ })).getAllByRole('option'),
  ).toHaveLength(1);
});

test('lets the route error boundary handle a failed options read', async () => {
  const failure = new Error('Database unavailable');
  vi.mocked(getPlantParentOptions).mockRejectedValue(failure);
  vi.mocked(getUsableLocationOptions).mockResolvedValue([]);
  await expect(AddPlantPage()).rejects.toBe(failure);
});
