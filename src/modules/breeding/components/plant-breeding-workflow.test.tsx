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
}));

const plant = {
  id: 'plant-1',
  reference: 'ANT-0001',
  name: 'Mother plant',
  status: 'GROWING',
  archivedAt: null,
};
const emptyDetail = { inflorescences: [], pollenPlants: [plant] } as unknown as PlantBreedingDetail;

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

test('removes new-breeding controls for an inactive Plant but keeps history', () => {
  render(<PlantBreedingWorkflow plant={{ ...plant, status: 'SOLD' }} detail={emptyDetail} />);
  expect(
    screen.getByText(/New inflorescences and pollinations are unavailable/),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Record inflorescence' })).not.toBeInTheDocument();
});
