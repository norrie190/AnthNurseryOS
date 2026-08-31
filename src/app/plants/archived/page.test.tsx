import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { connection } from 'next/server';
import { getArchivedPlantList } from '@/modules/plants/plant-queries';
import ArchivedPlantsPage from './page';

vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('@/modules/plants/plant-queries', () => ({ getArchivedPlantList: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

test('loads archived Plants at request time with a useful empty state and return link', async () => {
  vi.mocked(getArchivedPlantList).mockImplementation(async () => {
    expect(connection).toHaveBeenCalledOnce();
    return [];
  });
  render(await ArchivedPlantsPage());
  expect(screen.getByRole('heading', { level: 1, name: 'Archived Plants' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'No archived Plants' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View active Plants' })).toHaveAttribute(
    'href',
    '/plants',
  );
});

test('reads again on a later request and links archived records to their existing details', async () => {
  vi.mocked(getArchivedPlantList)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        id: 'saved-id',
        reference: 'ANT-0001',
        name: null,
        status: 'GROWING',
        location: null,
        archivedAt: new Date('2026-08-31T12:00:00Z'),
      },
    ]);
  await ArchivedPlantsPage();
  render(await ArchivedPlantsPage());
  expect(getArchivedPlantList).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('link', { name: /ANT-0001/ })).toHaveAttribute(
    'href',
    '/plants/saved-id',
  );
  expect(screen.queryByText('No archived Plants')).not.toBeInTheDocument();
});

test('does not present a database failure as an empty archive', async () => {
  const error = new Error('database unavailable');
  vi.mocked(getArchivedPlantList).mockRejectedValue(error);
  await expect(ArchivedPlantsPage()).rejects.toBe(error);
});
