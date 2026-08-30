import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { notFound } from 'next/navigation';
import {
  getPlantById,
  getPlantParentOptions,
  getUsableLocationOptions,
  type PlantDetailRecord,
} from '@/modules/plants/plant-queries';
import EditPlantPage from './page';

vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('@/modules/plants/plant-actions', () => ({ updatePlantAction: vi.fn() }));
vi.mock('@/modules/plants/plant-queries', () => ({
  getPlantById: vi.fn(),
  getPlantParentOptions: vi.fn(),
  getUsableLocationOptions: vi.fn(),
}));
const date = new Date('2026-08-30T12:00:00.000Z');
function record(): PlantDetailRecord {
  return {
    id: 'target',
    reference: 'ANT-0001',
    name: 'Original',
    status: 'GROWING',
    locationId: 'shelf',
    notes: 'Notes',
    createdAt: date,
    updatedAt: date,
    archivedAt: null,
    location: {
      id: 'shelf',
      name: 'Shelf',
      description: null,
      parentLocationId: null,
      createdAt: date,
      updatedAt: date,
      archivedAt: date,
    },
    parentage: {
      id: 'parentage',
      plantId: 'target',
      seedParentPlantId: 'parent',
      seedParentName: null,
      pollenParentPlantId: null,
      pollenParentName: 'External',
      createdAt: date,
      updatedAt: date,
      seedParent: { id: 'parent', reference: 'ANT-0002', name: 'Parent' },
      pollenParent: null,
    },
    purchase: {
      id: 'purchase',
      plantId: 'target',
      seller: 'Seller',
      orderReference: 'ORDER',
      purchaseDate: new Date('2024-02-29T00:00:00.000Z'),
      currency: 'GBP',
      plantPriceMinor: 5000,
      shippingCostMinor: null,
      otherCostMinor: 0,
      createdAt: date,
      updatedAt: date,
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPlantById).mockResolvedValue(record());
  vi.mocked(getPlantParentOptions).mockResolvedValue([
    { id: 'target', label: 'ANT-0001 — Original' },
    { id: 'parent', label: 'ANT-0002 — Parent (Archived)' },
  ]);
  vi.mocked(getUsableLocationOptions).mockResolvedValue([]);
});
test('loads the record, renders immutable reference, preserves archived Location and excludes self parent option', async () => {
  render(await EditPlantPage({ params: Promise.resolve({ plantId: 'target' }) }));
  expect(getPlantById).toHaveBeenCalledWith('target');
  expect(screen.getByRole('heading', { name: 'Editing ANT-0001' })).toBeInTheDocument();
  expect(
    screen.getByRole('option', { name: 'Shelf (archived, current Location)' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'ANT-0001 — Original' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'ANT-0002 — Parent (Archived)' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Plant price (GBP)' })).toHaveValue('50.00');
  expect(screen.getByRole('textbox', { name: 'Shipping cost (GBP)' })).toHaveValue('');
  expect(screen.getByRole('textbox', { name: 'Other cost (GBP)' })).toHaveValue('0.00');
  expect(screen.getByLabelText('Purchase date')).toHaveValue('2024-02-29');
});
test('works with optional fields and groups absent', async () => {
  vi.mocked(getPlantById).mockResolvedValue({
    ...record(),
    name: null,
    notes: null,
    parentage: null,
    purchase: null,
    location: null,
    locationId: null,
  });
  render(await EditPlantPage({ params: Promise.resolve({ plantId: 'target' }) }));
  expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('');
  expect(screen.getByRole('checkbox', { name: 'Record purchase information' })).not.toBeChecked();
  expect(screen.getByRole('combobox', { name: /Location/ })).toHaveValue('');
});
test('uses not found for missing records without loading selection options', async () => {
  const signal = new Error('Not found');
  vi.mocked(getPlantById).mockResolvedValue(null);
  vi.mocked(notFound).mockImplementation(() => {
    throw signal;
  });
  await expect(EditPlantPage({ params: Promise.resolve({ plantId: 'missing' }) })).rejects.toBe(
    signal,
  );
  expect(getPlantParentOptions).not.toHaveBeenCalled();
});
test('does not disguise database failures as missing Plants', async () => {
  const error = new Error('Database unavailable');
  vi.mocked(getPlantById).mockRejectedValue(error);
  await expect(EditPlantPage({ params: Promise.resolve({ plantId: 'target' }) })).rejects.toBe(
    error,
  );
  expect(notFound).not.toHaveBeenCalled();
});
