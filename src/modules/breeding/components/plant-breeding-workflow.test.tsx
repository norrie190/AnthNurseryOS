import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { PlantBreedingWorkflow } from './plant-breeding-workflow';
import type { PlantBreedingDetail } from '../breeding-queries';

const action = vi.hoisted(() =>
  vi.fn(async () => ({ success: false, message: '', fieldErrors: {} })),
);
vi.mock('../breeding-actions', () => ({
  initialBreedingActionState: { success: false, message: '', fieldErrors: {} },
  createInflorescenceAction: action,
  changeInflorescenceStatusAction: action,
  correctInflorescenceAction: action,
  voidInflorescenceAction: action,
  createPollinationAttemptAction: action,
  changePollinationAttemptStatusAction: action,
  correctPollinationAttemptAction: action,
  voidPollinationAttemptAction: action,
  recordSeedBatchHarvestAction: action,
  recordSeedBatchSowingAction: action,
  recordSeedBatchGerminationAction: action,
  closeSeedBatchAction: action,
  correctSeedBatchAction: action,
  voidSeedBatchAction: action,
  promoteSeedBatchPlantsAction: action,
}));

const plant = {
  id: 'plant-1',
  reference: 'ANT-0001',
  name: 'Mother plant',
  status: 'GROWING',
  archivedAt: null,
};
const emptyDetail = {
  inflorescences: [],
  pollenPlants: [plant],
  locations: [],
} as unknown as PlantBreedingDetail;

test('renders the empty breeding state and active inflorescence action', () => {
  render(<PlantBreedingWorkflow plant={plant} detail={emptyDetail} />);
  expect(screen.getByRole('heading', { name: 'Breeding' })).toBeInTheDocument();
  expect(screen.getByText('No inflorescences recorded yet.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Record inflorescence' })).toBeInTheDocument();
});

test('keeps retained history visible and exposes selfing plus harvest workflow', () => {
  const now = new Date('2026-08-30T12:00:00Z');
  const detail = {
    pollenPlants: [plant],
    locations: [],
    inflorescences: [
      {
        id: 'infl-1',
        plantId: plant.id,
        status: 'OBSERVED',
        emergedOn: now,
        openedOn: null,
        notes: null,
        voidedAt: null,
        correctionReason: null,
        createdAt: now,
        updatedAt: now,
        pollinationAttempts: [
          {
            id: 'attempt-1',
            inflorescenceId: 'infl-1',
            pollinatedOn: now,
            status: 'HARVESTED',
            pollenSourceMode: 'INTERNAL',
            pollenParentPlantId: plant.id,
            pollenParent: plant,
            pollenParentName: null,
            pollenBreeder: null,
            pollenCultivar: null,
            notes: null,
            voidedAt: null,
            correctionReason: null,
            createdAt: now,
            updatedAt: now,
            seedBatches: [],
          },
        ],
      },
    ],
  } as unknown as PlantBreedingDetail;
  render(<PlantBreedingWorkflow plant={plant} detail={detail} />);
  expect(screen.getByText('ANT-0001 × ANT-0001')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Record seed harvest' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark harvested' })).not.toBeInTheDocument();
});

test('shows promotion capacity, form, and retained promoted Plant links', () => {
  const now = new Date('2026-08-30T12:00:00Z');
  const detail = {
    pollenPlants: [plant],
    locations: [{ id: 'loc-1', label: 'Propagation shelf' }],
    inflorescences: [
      {
        id: 'infl-1',
        plantId: plant.id,
        status: 'OPEN',
        emergedOn: now,
        openedOn: now,
        notes: null,
        voidedAt: null,
        correctionReason: null,
        createdAt: now,
        updatedAt: now,
        pollinationAttempts: [
          {
            id: 'attempt-1',
            inflorescenceId: 'infl-1',
            pollinatedOn: now,
            status: 'HARVESTED',
            pollenSourceMode: 'INTERNAL',
            pollenParentPlantId: plant.id,
            pollenParent: plant,
            pollenParentName: null,
            pollenBreeder: null,
            pollenCultivar: null,
            notes: null,
            voidedAt: null,
            correctionReason: null,
            createdAt: now,
            updatedAt: now,
            seedBatches: [
              {
                id: 'batch-1',
                pollinationAttemptId: 'attempt-1',
                harvestedOn: now,
                sownOn: now,
                seedCount: 10,
                germinatedCount: 5,
                status: 'GERMINATING',
                notes: null,
                voidedAt: null,
                correctionReason: null,
                createdAt: now,
                updatedAt: now,
                promotion: {
                  eligibility: 'ELIGIBLE',
                  promotedCount: 2,
                  remainingCapacity: 3,
                  promotedPlants: [{ ...plant, location: { name: 'Propagation shelf' } }],
                },
              },
            ],
          },
        ],
      },
    ],
  } as unknown as PlantBreedingDetail;
  render(<PlantBreedingWorkflow plant={plant} detail={detail} />);
  expect(screen.getByText('2 of 5 seedlings promoted · 3 remaining')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'ANT-0001' })).toBeInTheDocument();
  expect(screen.getByRole('spinbutton', { name: 'Quantity' })).toHaveAttribute('max', '3');
  expect(screen.getByRole('option', { name: 'Propagation shelf' })).toBeInTheDocument();
  expect(screen.getByText(/Parentage is derived automatically/)).toBeInTheDocument();
});

test('removes new-breeding controls for an inactive Plant but keeps history', () => {
  render(<PlantBreedingWorkflow plant={{ ...plant, status: 'SOLD' }} detail={emptyDetail} />);
  expect(
    screen.getByText(/New inflorescences and pollinations are unavailable/),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Record inflorescence' })).not.toBeInTheDocument();
});
