import 'server-only';
import { Prisma } from '../../generated/prisma/client';
import { getPrisma } from '../../lib/prisma';
import { formatBreedingCross } from './breeding-provenance';

const overviewSelect = {
  id: true,
  plantId: true,
  status: true,
  emergedOn: true,
  openedOn: true,
  createdAt: true,
  plant: {
    select: {
      id: true,
      reference: true,
      name: true,
      status: true,
      archivedAt: true,
      location: { select: { name: true } },
    },
  },
  pollinationAttempts: {
    where: { voidedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      inflorescenceId: true,
      pollinatedOn: true,
      status: true,
      pollenSourceMode: true,
      pollenParentName: true,
      pollenParent: { select: { reference: true } },
      createdAt: true,
      seedBatches: {
        where: { voidedAt: null },
        orderBy: [{ harvestedOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          pollinationAttemptId: true,
          harvestedOn: true,
          sownOn: true,
          seedCount: true,
          germinatedCount: true,
          status: true,
        },
      },
    },
  },
} satisfies Prisma.InflorescenceSelect;

export type BreedingOverviewPlant = {
  id: string;
  reference: string;
  name: string | null;
  status: string;
  archivedAt: Date | null;
  locationName: string | null;
};

export type BreedingAttentionItem =
  | {
      type: 'INFLORESCENCE';
      id: string;
      inflorescenceId: string;
      plant: BreedingOverviewPlant;
      status: 'OPEN';
      relevantDate: Date;
      emergedOn: Date | null;
      openedOn: Date | null;
    }
  | {
      type: 'POLLINATION';
      id: string;
      pollinationAttemptId: string;
      inflorescenceId: string;
      plant: BreedingOverviewPlant;
      status: 'PENDING' | 'DEVELOPING';
      relevantDate: Date;
      cross: string;
    }
  | {
      type: 'SEED_BATCH';
      id: string;
      seedBatchId: string;
      pollinationAttemptId: string;
      plant: BreedingOverviewPlant;
      status: 'HARVESTED' | 'AWAITING_GERMINATION' | 'GERMINATING';
      relevantDate: Date;
      harvestedOn: Date;
      sownOn: Date | null;
      seedCount: number | null;
      germinatedCount: number | null;
      cross: string;
    };

export type BreedingOverview = {
  inflorescences: {
    OBSERVED: number;
    OPEN: number;
    FINISHED: number;
    ABORTED: number;
  };
  activeInflorescences: number;
  pollinationAttempts: {
    PENDING: number;
    DEVELOPING: number;
    FAILED: number;
    HARVESTED: number;
  };
  activePollinations: number;
  seedBatches: {
    HARVESTED: number;
    AWAITING_GERMINATION: number;
    GERMINATING: number;
    EXHAUSTED: number;
    FAILED: number;
  };
  awaitingSowing: number;
  awaitingGermination: number;
  activelyGerminating: number;
  attention: BreedingAttentionItem[];
};

function plantIdentity(plant: {
  id: string;
  reference: string;
  name: string | null;
  status: string;
  archivedAt: Date | null;
  location: { name: string } | null;
}): BreedingOverviewPlant {
  return { ...plant, locationName: plant.location?.name ?? null };
}

function dateForInflorescence(row: {
  openedOn: Date | null;
  emergedOn: Date | null;
  createdAt: Date;
}) {
  return row.openedOn ?? row.emergedOn ?? row.createdAt;
}

export async function getBreedingOverview(): Promise<BreedingOverview> {
  const rows = await getPrisma().$transaction(
    (tx) =>
      tx.inflorescence.findMany({
        where: { voidedAt: null },
        orderBy: [{ plant: { reference: 'asc' } }, { createdAt: 'asc' }, { id: 'asc' }],
        select: overviewSelect,
      }),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  const inflorescences = { OBSERVED: 0, OPEN: 0, FINISHED: 0, ABORTED: 0 };
  const pollinationAttempts = { PENDING: 0, DEVELOPING: 0, FAILED: 0, HARVESTED: 0 };
  const seedBatches = {
    HARVESTED: 0,
    AWAITING_GERMINATION: 0,
    GERMINATING: 0,
    EXHAUSTED: 0,
    FAILED: 0,
  };
  const attention: Array<BreedingAttentionItem & { priority: number; plantReference: string }> = [];

  for (const row of rows) {
    inflorescences[row.status]++;
    const plant = plantIdentity(row.plant);
    const liveAttempts = row.pollinationAttempts;
    if (
      (row.status === 'OBSERVED' || row.status === 'OPEN') &&
      row.status === 'OPEN' &&
      liveAttempts.length === 0
    ) {
      attention.push({
        type: 'INFLORESCENCE',
        id: row.id,
        inflorescenceId: row.id,
        plant,
        status: 'OPEN',
        relevantDate: dateForInflorescence(row),
        emergedOn: row.emergedOn,
        openedOn: row.openedOn,
        priority: 1,
        plantReference: plant.reference,
      });
    }
    for (const attempt of liveAttempts) {
      pollinationAttempts[attempt.status]++;
      const cross = formatBreedingCross(plant, {
        pollenSourceMode: attempt.pollenSourceMode,
        pollenParent: attempt.pollenParent,
        pollenParentName: attempt.pollenParentName,
      });
      if (attempt.status === 'PENDING' || attempt.status === 'DEVELOPING') {
        attention.push({
          type: 'POLLINATION',
          id: attempt.id,
          pollinationAttemptId: attempt.id,
          inflorescenceId: attempt.inflorescenceId,
          plant,
          status: attempt.status,
          relevantDate: attempt.pollinatedOn,
          cross,
          priority: attempt.status === 'PENDING' ? 2 : 3,
          plantReference: plant.reference,
        });
      }
      for (const batch of attempt.seedBatches) {
        seedBatches[batch.status]++;
        if (
          batch.status === 'HARVESTED' ||
          batch.status === 'AWAITING_GERMINATION' ||
          batch.status === 'GERMINATING'
        ) {
          attention.push({
            type: 'SEED_BATCH',
            id: batch.id,
            seedBatchId: batch.id,
            pollinationAttemptId: batch.pollinationAttemptId,
            plant,
            status: batch.status,
            relevantDate:
              batch.status === 'HARVESTED'
                ? batch.harvestedOn
                : (batch.sownOn ?? batch.harvestedOn),
            harvestedOn: batch.harvestedOn,
            sownOn: batch.sownOn,
            seedCount: batch.seedCount,
            germinatedCount: batch.germinatedCount,
            cross,
            priority:
              batch.status === 'HARVESTED' ? 4 : batch.status === 'AWAITING_GERMINATION' ? 5 : 6,
            plantReference: plant.reference,
          });
        }
      }
    }
  }
  attention.sort(
    (a, b) =>
      a.priority - b.priority ||
      a.relevantDate.getTime() - b.relevantDate.getTime() ||
      a.plantReference.localeCompare(b.plantReference) ||
      a.id.localeCompare(b.id),
  );
  return {
    inflorescences,
    activeInflorescences: inflorescences.OBSERVED + inflorescences.OPEN,
    pollinationAttempts,
    activePollinations: pollinationAttempts.PENDING + pollinationAttempts.DEVELOPING,
    seedBatches,
    awaitingSowing: seedBatches.HARVESTED,
    awaitingGermination: seedBatches.AWAITING_GERMINATION,
    activelyGerminating: seedBatches.GERMINATING,
    attention: attention.slice(0, 10).map(({ priority, plantReference, ...item }) => {
      void priority;
      void plantReference;
      return item;
    }),
  };
}
