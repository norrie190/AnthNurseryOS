import 'server-only';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma';

const id = z.string().uuid();
const promotedPlantSelect = {
  id: true,
  reference: true,
  name: true,
  status: true,
  archivedAt: true,
} as const;

export function promotionEligibility(
  status: string,
  germinatedCount: number | null,
  promotedCount: number,
  requestedQuantity = 0,
) {
  if (status !== 'GERMINATING' && status !== 'EXHAUSTED') return 'STATUS' as const;
  if (germinatedCount === null) return 'GERMINATION_UNKNOWN' as const;
  if (germinatedCount === 0) return 'NO_GERMINATION' as const;
  if (promotedCount >= germinatedCount || promotedCount + requestedQuantity > germinatedCount)
    return 'CAPACITY' as const;
  return 'ELIGIBLE' as const;
}

export async function getSeedBatchPromotionDetail(seedBatchId: string) {
  const parsed = id.safeParse(seedBatchId);
  if (!parsed.success) return null;
  const batch = await getPrisma().seedBatch.findUnique({
    where: { id: parsed.data },
    select: {
      id: true,
      status: true,
      seedCount: true,
      germinatedCount: true,
      voidedAt: true,
      updatedAt: true,
      pollinationAttempt: {
        select: {
          id: true,
          pollenSourceMode: true,
          pollenParentName: true,
          pollenParent: { select: { id: true, reference: true, name: true } },
          inflorescence: {
            select: {
              id: true,
              plant: {
                select: { id: true, reference: true, name: true, status: true, archivedAt: true },
              },
            },
          },
        },
      },
      promotedPlants: {
        orderBy: [{ reference: 'asc' }, { id: 'asc' }],
        select: promotedPlantSelect,
      },
    },
  });
  if (!batch) return null;
  const promotedCount = batch.promotedPlants.length;
  return {
    ...batch,
    promotedCount,
    remainingCapacity:
      batch.germinatedCount === null ? null : Math.max(batch.germinatedCount - promotedCount, 0),
    eligibility: batch.voidedAt
      ? ('VOIDED' as const)
      : promotionEligibility(batch.status, batch.germinatedCount, promotedCount),
  };
}

export async function getSeedBatchPromotedPlants(seedBatchId: string) {
  const parsed = id.safeParse(seedBatchId);
  if (!parsed.success) return [];
  return getPrisma().plant.findMany({
    where: { originSeedBatchId: parsed.data },
    orderBy: [{ reference: 'asc' }, { id: 'asc' }],
    select: promotedPlantSelect,
  });
}

export async function getPlantOriginProvenance(plantId: string) {
  const parsed = id.safeParse(plantId);
  if (!parsed.success) return null;
  return getPrisma().plant.findUnique({
    where: { id: parsed.data },
    select: {
      id: true,
      reference: true,
      originSeedBatch: {
        select: {
          id: true,
          status: true,
          harvestedOn: true,
          germinatedCount: true,
          pollinationAttempt: {
            select: {
              id: true,
              pollenSourceMode: true,
              pollenParentName: true,
              pollenParent: { select: { id: true, reference: true, name: true } },
              inflorescence: {
                select: { id: true, plant: { select: { id: true, reference: true, name: true } } },
              },
            },
          },
        },
      },
    },
  });
}
