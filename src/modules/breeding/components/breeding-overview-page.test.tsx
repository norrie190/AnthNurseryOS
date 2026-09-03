import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { BreedingOverview } from '../breeding-overview-queries';
import { BreedingOverviewPage } from './breeding-overview-page';

const counts: BreedingOverview = {
  inflorescences: { OBSERVED: 2, OPEN: 3, FINISHED: 4, ABORTED: 1 },
  activeInflorescences: 5,
  pollinationAttempts: { PENDING: 2, DEVELOPING: 3, FAILED: 4, HARVESTED: 5 },
  activePollinations: 5,
  seedBatches: { HARVESTED: 1, AWAITING_GERMINATION: 2, GERMINATING: 3, EXHAUSTED: 4, FAILED: 5 },
  awaitingSowing: 1,
  awaitingGermination: 2,
  activelyGerminating: 3,
  attention: [],
};

const plant = {
  id: 'plant-1',
  reference: 'ANT-0001',
  name: 'Sold parent',
  status: 'SOLD',
  archivedAt: null,
  locationName: 'Glasshouse',
};
const date = new Date('2026-08-01T00:00:00Z');

test('renders read-model summaries, preserves attention order and links each item to its Plant', () => {
  render(
    <BreedingOverviewPage
      overview={{
        ...counts,
        attention: [
          {
            type: 'INFLORESCENCE',
            id: 'i',
            inflorescenceId: 'i',
            plant,
            status: 'OPEN',
            relevantDate: date,
            emergedOn: date,
            openedOn: date,
          },
          {
            type: 'POLLINATION',
            id: 'p',
            pollinationAttemptId: 'p',
            inflorescenceId: 'i',
            plant,
            status: 'PENDING',
            relevantDate: date,
            cross: 'ANT-0001 × ANT-0001',
          },
          {
            type: 'SEED_BATCH',
            id: 'b',
            seedBatchId: 'b',
            pollinationAttemptId: 'p',
            plant,
            status: 'HARVESTED',
            relevantDate: date,
            harvestedOn: date,
            sownOn: null,
            seedCount: null,
            germinatedCount: null,
            cross: 'ANT-0001 × External Parent',
          },
        ],
      }}
    />,
  );
  expect(screen.getByRole('heading', { name: 'Breeding overview' })).toBeInTheDocument();
  expect(screen.getAllByText('5').length).toBeGreaterThan(0);
  expect(screen.getByText('Open inflorescence awaiting pollination')).toBeInTheDocument();
  expect(screen.getByText('Pollination pending')).toBeInTheDocument();
  expect(screen.getByText('Seed batch awaiting sowing')).toBeInTheDocument();
  expect(screen.getByText('ANT-0001 × ANT-0001')).toBeInTheDocument();
  expect(screen.getByText('ANT-0001 × External Parent')).toBeInTheDocument();
  expect(screen.getAllByRole('link')).toHaveLength(3);
  expect(
    screen.getAllByRole('link').every((link) => link.getAttribute('href') === '/plants/plant-1'),
  ).toBe(true);
  expect(screen.getAllByText(/Sold parent/).length).toBe(3);
  expect(screen.getAllByText(/Location: Glasshouse/).length).toBe(3);
});

test('renders explicit empty and quiet states', () => {
  render(
    <BreedingOverviewPage
      overview={{
        ...counts,
        inflorescences: { OBSERVED: 0, OPEN: 0, FINISHED: 0, ABORTED: 0 },
        pollinationAttempts: { PENDING: 0, DEVELOPING: 0, FAILED: 0, HARVESTED: 0 },
        seedBatches: {
          HARVESTED: 0,
          AWAITING_GERMINATION: 0,
          GERMINATING: 0,
          EXHAUSTED: 0,
          FAILED: 0,
        },
        activeInflorescences: 0,
        activePollinations: 0,
        awaitingSowing: 0,
        awaitingGermination: 0,
        activelyGerminating: 0,
      }}
    />,
  );
  expect(screen.getByText('No breeding records yet.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View Plants' })).toHaveAttribute('href', '/plants');
  render(<BreedingOverviewPage overview={{ ...counts, attention: [] }} />);
  expect(screen.getByRole('status')).toHaveTextContent('No active breeding tasks right now.');
});
