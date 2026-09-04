import 'server-only';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { getPrisma } from '../../lib/prisma';
import { getUsableLocationOptions } from '../plants/plant-queries';
import { BreedingError } from './breeding-errors';
import { promotionEligibility } from './promotion-queries';

const id = z.string().uuid();
const pollenParent = { select: { id: true, reference: true, name: true } } as const;
const attemptSelect = {
  id: true,
  inflorescenceId: true,
  pollinatedOn: true,
  status: true,
  pollenSourceMode: true,
  pollenParentPlantId: true,
  pollenParentName: true,
  pollenBreeder: true,
  pollenCultivar: true,
  notes: true,
  voidedAt: true,
  correctionReason: true,
  createdAt: true,
  updatedAt: true,
  pollenParent: pollenParent,
  seedBatches: {
    orderBy: [{ harvestedOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      pollinationAttemptId: true,
      harvestedOn: true,
      sownOn: true,
      seedCount: true,
      germinatedCount: true,
      status: true,
      notes: true,
      voidedAt: true,
      correctionReason: true,
      createdAt: true,
      updatedAt: true,
      promotedPlants: {
        orderBy: [{ reference: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          reference: true,
          name: true,
          status: true,
          archivedAt: true,
          location: { select: { name: true } },
        },
      },
    },
  },
} satisfies Prisma.PollinationAttemptSelect;
const seedBatchSelect = {
  id: true,
  pollinationAttemptId: true,
  harvestedOn: true,
  sownOn: true,
  seedCount: true,
  germinatedCount: true,
  status: true,
  notes: true,
  voidedAt: true,
  correctionReason: true,
  createdAt: true,
  updatedAt: true,
  promotedPlants: {
    orderBy: [{ reference: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      reference: true,
      name: true,
      status: true,
      archivedAt: true,
      location: { select: { name: true } },
    },
  },
} satisfies Prisma.SeedBatchSelect;

function promotionSummary<
  T extends {
    promotedPlants: readonly {
      id: string;
      reference: string;
      name: string | null;
      status: string;
      archivedAt: Date | null;
      location: { name: string } | null;
    }[];
    germinatedCount: number | null;
    status: string;
    voidedAt: Date | null;
  },
>(batch: T) {
  const promotedCount = batch.promotedPlants.length;
  return {
    ...batch,
    promotion: {
      promotedCount,
      remainingCapacity:
        batch.germinatedCount === null ? null : Math.max(batch.germinatedCount - promotedCount, 0),
      eligibility: batch.voidedAt
        ? ('VOIDED' as const)
        : promotionEligibility(batch.status, batch.germinatedCount, promotedCount),
      promotedPlants: batch.promotedPlants,
    },
  };
}

export async function getPlantInflorescenceHistory(plantId: string) {
  const parsed = id.safeParse(plantId);
  if (!parsed.success) return [];
  return getPrisma().inflorescence.findMany({
    where: { plantId: parsed.data },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      pollinationAttempts: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: attemptSelect,
      },
    },
  });
}
export type PlantInflorescenceHistory = Awaited<ReturnType<typeof getPlantInflorescenceHistory>>;

export async function getPlantBreedingDetail(plantId: string) {
  const parsed = id.safeParse(plantId);
  if (!parsed.success) return null;
  const [plant, inflorescences, pollenPlants, locations] = await Promise.all([
    getPrisma().plant.findUnique({ where: { id: parsed.data }, select: { id: true } }),
    getPrisma().inflorescence.findMany({
      where: { plantId: parsed.data },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        pollinationAttempts: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: attemptSelect,
        },
      },
    }),
    getPrisma().plant.findMany({
      select: { id: true, reference: true, name: true, status: true, archivedAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    }),
    getUsableLocationOptions(),
  ]);
  if (!plant) return null;
  return {
    inflorescences: inflorescences.map((inflorescence) => ({
      ...inflorescence,
      pollinationAttempts: inflorescence.pollinationAttempts.map((attempt) => ({
        ...attempt,
        seedBatches: attempt.seedBatches.map(promotionSummary),
      })),
    })),
    pollenPlants,
    locations,
  };
}
export type PlantBreedingDetail = NonNullable<Awaited<ReturnType<typeof getPlantBreedingDetail>>>;

export async function getInflorescenceDetail(inflorescenceId: string) {
  const parsed = id.safeParse(inflorescenceId);
  if (!parsed.success) return null;
  return getPrisma().inflorescence.findUnique({
    where: { id: parsed.data },
    include: {
      pollinationAttempts: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: attemptSelect,
      },
    },
  });
}

export async function getOwnedInflorescenceDetail(plantId: string, inflorescenceId: string) {
  const plant = id.safeParse(plantId);
  const inflorescence = id.safeParse(inflorescenceId);
  if (!plant.success || !inflorescence.success) return null;
  return getPrisma().inflorescence.findFirst({
    where: { id: inflorescence.data, plantId: plant.data },
    include: {
      pollinationAttempts: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: attemptSelect,
      },
    },
  });
}

export async function getPollinationAttemptDetail(attemptId: string) {
  const parsed = id.safeParse(attemptId);
  if (!parsed.success) return null;
  return getPrisma().pollinationAttempt.findUnique({
    where: { id: parsed.data },
    select: {
      ...attemptSelect,
      inflorescence: { select: { id: true, plantId: true, status: true } },
    },
  });
}

export async function getOwnedPollinationAttemptDetail(inflorescenceId: string, attemptId: string) {
  const parent = id.safeParse(inflorescenceId);
  const attempt = id.safeParse(attemptId);
  if (!parent.success || !attempt.success) return null;
  return getPrisma().pollinationAttempt.findFirst({
    where: { id: attempt.data, inflorescenceId: parent.data },
    select: {
      ...attemptSelect,
      inflorescence: { select: { id: true, plantId: true, status: true } },
    },
  });
}

export async function getPollinationSeedBatchHistory(pollinationAttemptId: string) {
  const parsed = id.safeParse(pollinationAttemptId);
  if (!parsed.success) return [];
  return getPrisma().seedBatch.findMany({
    where: { pollinationAttemptId: parsed.data },
    orderBy: [{ harvestedOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: seedBatchSelect,
  });
}
export type PollinationSeedBatchHistory = Awaited<
  ReturnType<typeof getPollinationSeedBatchHistory>
>;

export async function getSeedBatchDetail(seedBatchId: string) {
  const parsed = id.safeParse(seedBatchId);
  if (!parsed.success) return null;
  return getPrisma().seedBatch.findUnique({
    where: { id: parsed.data },
    select: {
      ...seedBatchSelect,
      pollinationAttempt: {
        select: {
          id: true,
          status: true,
          inflorescence: {
            select: {
              id: true,
              plant: { select: { id: true, reference: true, name: true } },
            },
          },
        },
      },
    },
  });
}

export async function getOwnedSeedBatchDetail(pollinationAttemptId: string, seedBatchId: string) {
  const attempt = id.safeParse(pollinationAttemptId);
  const batch = id.safeParse(seedBatchId);
  if (!attempt.success || !batch.success) return null;
  return getPrisma().seedBatch.findFirst({
    where: { id: batch.data, pollinationAttemptId: attempt.data },
    select: {
      ...seedBatchSelect,
      pollinationAttempt: {
        select: {
          id: true,
          status: true,
          inflorescence: {
            select: { id: true, plant: { select: { id: true, reference: true, name: true } } },
          },
        },
      },
    },
  });
}

export function requireOwned<T>(
  record: T | null,
  message = 'This breeding record could not be found.',
) {
  if (!record) throw new BreedingError('CONFLICT', message);
  return record;
}
