import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { PlantDetail } from './plant-detail';
import type { PlantDetailRecord } from '../plant-queries';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../plant-archive-actions', () => ({
  archivePlantAction: vi.fn(),
  restorePlantAction: vi.fn(),
}));

const timestamp = new Date('2026-08-30T12:00:00Z');
const plant: PlantDetailRecord = {
  id: 'a8e64bb0-47ef-4a99-963c-aef88aed09ea',
  reference: 'ANT-0042',
  name: null,
  status: 'GROWING',
  notes: null,
  locationId: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
  location: null,
  parentage: null,
  purchase: null,
};

test('displays the assigned reference and meaningful empty values', () => {
  render(<PlantDetail plant={plant} />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ANT-0042');
  expect(screen.getByText('Unnamed Plant')).toBeInTheDocument();
  expect(screen.getByText('Growing')).toBeInTheDocument();
  expect(screen.getByText('No purchase recorded.')).toBeInTheDocument();
  expect(screen.getAllByText('Unknown')).toHaveLength(2);
  expect(screen.queryByText('£0.00')).not.toBeInTheDocument();
});

test('renders saved parent links, external names and distinct monetary values', () => {
  render(
    <PlantDetail
      plant={{
        ...plant,
        name: 'Velvet',
        notes: 'Nursery notes',
        parentage: {
          id: 'parentage',
          plantId: plant.id,
          seedParentPlantId: 'seed-id',
          seedParentName: null,
          pollenParentPlantId: null,
          pollenParentName: 'External pollen',
          createdAt: timestamp,
          updatedAt: timestamp,
          seedParent: { id: 'seed-id', reference: 'ANT-0004', name: 'HURC' },
          pollenParent: null,
        },
        purchase: {
          id: 'purchase',
          plantId: plant.id,
          seller: 'Nursery',
          orderReference: 'ORDER-1',
          purchaseDate: new Date('2024-02-29T00:00:00Z'),
          plantPriceMinor: 12550,
          shippingCostMinor: 0,
          otherCostMinor: null,
          currency: 'GBP',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      }}
    />,
  );
  expect(screen.getByRole('link', { name: 'ANT-0004 — HURC' })).toHaveAttribute(
    'href',
    '/plants/seed-id',
  );
  expect(screen.getByText('External pollen')).toBeInTheDocument();
  expect(screen.getByText('£125.50')).toBeInTheDocument();
  expect(screen.getByText('£0.00')).toBeInTheDocument();
  expect(screen.getAllByText('Not recorded')).toHaveLength(2);
  expect(screen.getByText('29 February 2024')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Archive Plant' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit Plant' })).toHaveAttribute(
    'href',
    `/plants/${plant.id}/edit`,
  );
});

test('archived detail retains information and status, shows archive date and offers Restore', () => {
  render(
    <PlantDetail
      plant={{
        ...plant,
        name: 'Archived specimen',
        notes: 'Historical notes',
        status: 'DECEASED',
        archivedAt: new Date('2026-08-31T10:00:00Z'),
      }}
    />,
  );
  expect(screen.getByRole('heading', { name: 'ANT-0042' })).toBeInTheDocument();
  expect(screen.getByText('Deceased')).toBeInTheDocument();
  expect(screen.getByText('Historical notes')).toBeInTheDocument();
  expect(screen.getByText('31 August 2026')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Restore Plant' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Archive Plant' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '← Archived Plants' })).toHaveAttribute(
    'href',
    '/plants/archived',
  );
});
