import 'server-only';
import { Prisma } from '../../generated/prisma/client';
import { getPrisma } from '../../lib/prisma';
import { createPlantInTransaction } from '../plants/plant-service';
import { parseCreatePlantInput } from '../plants/plant-input';
import { BreedingError } from './breeding-errors';
import {
  parseBreedingId,
  parseBreedingInput,
  promoteSeedBatchPlantsSchema,
  type PromoteSeedBatchPlantsInput,
} from './breeding-input';
import {
  ensureToken,
  lockSeedBatch,
  nextBreedingTimestamp,
  throwBreedingDatabaseError,
  transactionOptions,
} from './breeding-persistence';

export type PromotedPlant = { id: string; reference: string; name: string | null };
export type SeedBatchPromotionResult = {
  createdPlants: PromotedPlant[];
  seedBatchUpdatedAt: Date;
};

export async function promoteSeedBatchPlants(
  seedBatchId: string,
  input: PromoteSeedBatchPlantsInput,
): Promise<SeedBatchPromotionResult> {
  const id = parseBreedingId(seedBatchId);
  const parsed = parseBreedingInput(promoteSeedBatchPlantsSchema, input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const batch = await lockSeedBatch(tx, id);
      ensureToken(batch, parsed.expectedUpdatedAt, 'SeedBatch');
      if (batch.voidedAt)
        throw new BreedingError('SEED_BATCH_VOIDED', 'A voided SeedBatch cannot be promoted.');
      if (
        (batch.status !== 'GERMINATING' && batch.status !== 'EXHAUSTED') ||
        batch.germinatedCount === null ||
        batch.germinatedCount <= 0
      )
        throw new BreedingError(
          'PROMOTION_NOT_ELIGIBLE',
          'Only a batch with known positive germination in progress or complete can be promoted.',
        );

      const provenance = await tx.seedBatch.findUniqueOrThrow({
        where: { id },
        select: {
          pollinationAttempt: {
            select: {
              pollenSourceMode: true,
              pollenParentPlantId: true,
              pollenParentName: true,
              inflorescence: { select: { plantId: true } },
            },
          },
        },
      });
      const existingPromoted = await tx.plant.count({ where: { originSeedBatchId: id } });
      if (existingPromoted + parsed.quantity > batch.germinatedCount)
        throw new BreedingError(
          'PROMOTION_CAPACITY_EXCEEDED',
          'The requested promotion exceeds the known germinated count for this SeedBatch.',
        );

      const parentage = {
        seedParentPlantId: provenance.pollinationAttempt.inflorescence.plantId,
        seedParentName: null,
        pollenParentPlantId:
          provenance.pollinationAttempt.pollenSourceMode === 'INTERNAL'
            ? provenance.pollinationAttempt.pollenParentPlantId
            : null,
        pollenParentName:
          provenance.pollinationAttempt.pollenSourceMode === 'EXTERNAL'
            ? provenance.pollinationAttempt.pollenParentName
            : null,
      };
      const createdPlants: PromotedPlant[] = [];
      for (let index = 0; index < parsed.quantity; index += 1) {
        const created = await createPlantInTransaction(
          tx,
          parseCreatePlantInput({
            status: parsed.status,
            locationId: parsed.locationId,
            notes: parsed.notes,
            parentage,
          }),
          { originSeedBatchId: id },
        );
        createdPlants.push({ id: created.id, reference: created.reference, name: created.name });
      }
      const updated = await tx.seedBatch.update({
        where: { id },
        data: { updatedAt: nextBreedingTimestamp(batch.updatedAt, batch.databaseNow) },
        select: { updatedAt: true },
      });
      return { createdPlants, seedBatchUpdatedAt: updated.updatedAt };
    }, transactionOptions());
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003')
      throw new BreedingError('CONFLICT', 'The promoted Plant provenance could not be saved.', {
        cause: error,
      });
    throwBreedingDatabaseError(error);
  }
}
