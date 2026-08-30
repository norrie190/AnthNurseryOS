import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { connection } from 'next/server';
import { getPlantList } from '@/modules/plants/plant-queries';
import PlantsPage from './page';
import PlantsLoading from './loading';

vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('@/modules/plants/plant-queries', () => ({ getPlantList: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

test('loads the collection at request time with Add Plant available in the empty state', async () => {
  vi.mocked(getPlantList).mockImplementation(async () => {
    expect(connection).toHaveBeenCalledOnce();
    return [];
  });
  render(await PlantsPage());
  expect(getPlantList).toHaveBeenCalledOnce();
  expect(screen.getByRole('heading', { level: 1, name: 'Plants' })).toBeInTheDocument();
  expect(screen.getByText('Manage and view your nursery collection')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'No Plants yet' })).toBeInTheDocument();
  for (const link of screen.getAllByRole('link', { name: 'Add Plant' })) {
    expect(link).toHaveAttribute('href', '/plants/new');
  }
});

test('reads again on a later request and displays the newly available Plant', async () => {
  vi.mocked(getPlantList)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        id: 'saved-uuid',
        reference: 'ANT-0001',
        name: null,
        status: 'GROWING',
        location: null,
        createdAt: new Date('2026-08-30T12:00:00Z'),
      },
    ]);
  await PlantsPage();
  render(await PlantsPage());
  expect(getPlantList).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('link', { name: /ANT-0001/ })).toHaveAttribute(
    'href',
    '/plants/saved-uuid',
  );
  expect(screen.getByRole('link', { name: 'Add Plant' })).toHaveAttribute('href', '/plants/new');
  expect(screen.queryByText('No Plants yet')).not.toBeInTheDocument();
});

test('does not disguise database errors as an empty collection', async () => {
  const failure = new Error('Database unavailable');
  vi.mocked(getPlantList).mockRejectedValue(failure);
  await expect(PlantsPage()).rejects.toBe(failure);
});

test('announces loading while the database backed route is pending', () => {
  render(<PlantsLoading />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading Plants…');
});
