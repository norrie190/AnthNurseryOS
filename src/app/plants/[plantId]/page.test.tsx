import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { notFound } from 'next/navigation';
import { getPlantById } from '@/modules/plants/plant-queries';
import type { PlantDetailRecord } from '@/modules/plants/plant-queries';
import PlantPage from './page';
import { getPlantPhotoGallery } from '@/modules/plants/plant-photo-queries';
import { getPlantWateringDetail } from '@/modules/watering/watering-schedule-queries';
import { getPlantBreedingDetail } from '@/modules/breeding/breeding-queries';

vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('next/navigation', () => ({ notFound: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/modules/plants/plant-archive-actions', () => ({
  archivePlantAction: vi.fn(),
  restorePlantAction: vi.fn(),
}));
vi.mock('@/modules/plants/plant-queries', () => ({ getPlantById: vi.fn() }));
vi.mock('@/modules/plants/plant-photo-queries', () => ({ getPlantPhotoGallery: vi.fn() }));
vi.mock('@/modules/watering/watering-schedule-queries', () => ({
  getPlantWateringDetail: vi.fn(),
}));
vi.mock('@/modules/watering/components/plant-watering', () => ({
  PlantWatering: () => <section aria-label="Watering">Watering detail</section>,
}));
vi.mock('@/modules/breeding/breeding-queries', () => ({ getPlantBreedingDetail: vi.fn() }));
vi.mock('@/modules/breeding/components/plant-breeding', () => ({
  PlantBreeding: () => <section aria-label="Breeding">Breeding detail</section>,
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPlantPhotoGallery).mockResolvedValue([]);
  vi.mocked(getPlantWateringDetail).mockResolvedValue({} as never);
  vi.mocked(getPlantBreedingDetail).mockResolvedValue({
    inflorescences: [],
    pollenPlants: [],
  } as never);
});

test('loads the saved UUID and renders its generated reference', async () => {
  const timestamp = new Date('2026-08-30T12:00:00Z');
  vi.mocked(getPlantById).mockResolvedValue({
    id: 'saved-id',
    reference: 'ANT-0001',
    name: null,
    status: 'GROWING',
    location: null,
    purchase: null,
    parentage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    locationId: null,
    notes: null,
  } satisfies PlantDetailRecord);
  render(await PlantPage({ params: Promise.resolve({ plantId: 'saved-id' }) }));
  expect(getPlantById).toHaveBeenCalledWith('saved-id');
  expect(getPlantPhotoGallery).toHaveBeenCalledWith('saved-id');
  expect(getPlantWateringDetail).toHaveBeenCalledWith('saved-id');
  expect(getPlantBreedingDetail).toHaveBeenCalledWith('saved-id');
  expect(screen.getByRole('heading', { name: 'Photos' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Watering' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Breeding' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'ANT-0001' })).toBeInTheDocument();
});
test('uses the not found page for a missing Plant', async () => {
  const signal = new Error('not found');
  vi.mocked(getPlantById).mockResolvedValue(null);
  vi.mocked(notFound).mockImplementation(() => {
    throw signal;
  });
  await expect(PlantPage({ params: Promise.resolve({ plantId: 'missing' }) })).rejects.toBe(signal);
});

test('does not disguise a database failure as a missing Plant', async () => {
  const failure = new Error('Database unavailable');
  vi.mocked(getPlantById).mockRejectedValue(failure);
  await expect(PlantPage({ params: Promise.resolve({ plantId: 'saved-id' }) })).rejects.toBe(
    failure,
  );
  expect(notFound).not.toHaveBeenCalled();
});
