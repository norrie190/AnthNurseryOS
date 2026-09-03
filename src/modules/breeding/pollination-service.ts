import 'server-only';
import type { PollinationAttempt } from '../../generated/prisma/client';
import { dateToSql } from '../../lib/calendar-date';
import { getPrisma } from '../../lib/prisma';
import { BreedingError } from './breeding-errors';
import {
  changePollinationAttemptStatusSchema,
  correctPollinationAttemptSchema,
  parseBreedingInput,
  parseBreedingId,
  parseCreatePollinationAttemptInput,
  voidPollinationAttemptSchema,
  type ChangePollinationAttemptStatusInput,
  type CorrectPollinationAttemptInput,
  type CreatePollinationAttemptInput,
  type PollenSource,
  type VoidPollinationAttemptInput,
} from './breeding-input';
import {
  ensureNotFuture,
  ensureToken,
  ensurePlantEligible,
  lockInflorescence,
  lockPlant,
  lockAttempt,
  nextBreedingTimestamp,
  throwBreedingDatabaseError,
  transactionOptions,
} from './breeding-persistence';

function sourceData(source: PollenSource) {
  if (source.mode === 'INTERNAL')
    return {
      pollenSourceMode: source.mode,
      pollenParentPlantId: source.pollenParentPlantId,
      pollenParentName: null,
      pollenBreeder: null,
      pollenCultivar: null,
    };
  if (source.mode === 'EXTERNAL')
    return {
      pollenSourceMode: source.mode,
      pollenParentPlantId: null,
      pollenParentName: source.pollenParentName,
      pollenBreeder: source.pollenBreeder,
      pollenCultivar: source.pollenCultivar,
    };
  return {
    pollenSourceMode: source.mode,
    pollenParentPlantId: null,
    pollenParentName: null,
    pollenBreeder: null,
    pollenCultivar: null,
  };
}

function sameSource(current: PollinationAttempt, source: PollenSource): boolean {
  return (
    current.pollenSourceMode === source.mode &&
    (source.mode === 'INTERNAL'
      ? current.pollenParentPlantId === source.pollenParentPlantId
      : source.mode === 'EXTERNAL'
        ? current.pollenParentPlantId === null &&
          current.pollenParentName === source.pollenParentName &&
          current.pollenBreeder === source.pollenBreeder &&
          current.pollenCultivar === source.pollenCultivar
        : current.pollenParentPlantId === null &&
          current.pollenParentName === null &&
          current.pollenBreeder === null &&
          current.pollenCultivar === null)
  );
}

export async function createPollinationAttempt(
  inflorescenceId: string,
  input: CreatePollinationAttemptInput,
): Promise<PollinationAttempt> {
  const id = parseBreedingId(inflorescenceId);
  const parsed = parseCreatePollinationAttemptInput(input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const initial = await tx.inflorescence.findUnique({
        where: { id },
        select: { plantId: true },
      });
      if (!initial)
        throw new BreedingError(
          'INFLORESCENCE_NOT_FOUND',
          'This Inflorescence could not be found.',
        );
      const plant = await lockPlant(tx, initial.plantId);
      const inflorescence = await lockInflorescence(tx, id);
      ensurePlantEligible(plant);
      if (inflorescence.voidedAt)
        throw new BreedingError(
          'INFLORESCENCE_VOIDED',
          'A voided Inflorescence cannot be pollinated.',
        );
      if (inflorescence.status === 'FINISHED' || inflorescence.status === 'ABORTED')
        throw new BreedingError(
          'INFLORESCENCE_NOT_POLLINATABLE',
          'Only an observed or open Inflorescence can be pollinated.',
        );
      ensureNotFuture(parsed.pollinatedOn, plant.databaseNow, 'pollinatedOn');
      if (parsed.pollenSource.mode === 'INTERNAL') {
        const pollenPlant = await tx.plant.findUnique({
          where: { id: parsed.pollenSource.pollenParentPlantId },
          select: { id: true },
        });
        if (!pollenPlant)
          throw new BreedingError(
            'POLLEN_PLANT_NOT_FOUND',
            'The internal pollen Plant could not be found.',
          );
      }
      const live = await tx.pollinationAttempt.findFirst({
        where: { inflorescenceId: id, voidedAt: null },
        select: { id: true },
      });
      if (live)
        throw new BreedingError(
          'POLLINATION_ATTEMPT_EXISTS',
          'This Inflorescence already has a non-void PollinationAttempt.',
        );
      return tx.pollinationAttempt.create({
        data: {
          inflorescenceId: inflorescence.id,
          pollinatedOn: dateToSql(parsed.pollinatedOn),
          ...sourceData(parsed.pollenSource),
          notes: parsed.notes,
        },
      });
    }, transactionOptions());
  } catch (error) {
    throwBreedingDatabaseError(error);
  }
}

const transitions: Record<string, readonly string[]> = {
  PENDING: ['DEVELOPING', 'FAILED'],
  DEVELOPING: ['FAILED'],
};
export async function changePollinationAttemptStatus(
  id: string,
  input: ChangePollinationAttemptStatusInput,
): Promise<PollinationAttempt> {
  const parsed = parseBreedingInput(changePollinationAttemptStatusSchema, input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const current = await lockAttempt(tx, id);
      ensureToken(current, parsed.expectedUpdatedAt, 'PollinationAttempt');
      if (current.voidedAt)
        throw new BreedingError(
          'POLLINATION_ATTEMPT_VOIDED',
          'A voided PollinationAttempt cannot be transitioned.',
        );
      if (!transitions[current.status]?.includes(parsed.status))
        throw new BreedingError(
          'INVALID_STATUS_TRANSITION',
          `PollinationAttempt cannot transition from ${current.status} to ${parsed.status}.`,
        );
      return tx.pollinationAttempt.update({
        where: { id },
        data: {
          status: parsed.status,
          updatedAt: nextBreedingTimestamp(current.updatedAt, current.databaseNow),
        },
      });
    }, transactionOptions());
  } catch (error) {
    throwBreedingDatabaseError(error);
  }
}

export async function correctPollinationAttempt(
  id: string,
  input: CorrectPollinationAttemptInput,
): Promise<PollinationAttempt> {
  const parsed = parseBreedingInput(correctPollinationAttemptSchema, input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const current = await lockAttempt(tx, id);
      ensureToken(current, parsed.expectedUpdatedAt, 'PollinationAttempt');
      if (current.voidedAt)
        throw new BreedingError(
          'POLLINATION_ATTEMPT_VOIDED',
          'A voided PollinationAttempt cannot be corrected.',
        );
      const pollinatedOn = parsed.pollinatedOn ?? current.pollinatedOn.toISOString().slice(0, 10);
      ensureNotFuture(pollinatedOn, current.databaseNow, 'pollinatedOn');
      const currentSource: PollenSource =
        current.pollenSourceMode === 'INTERNAL'
          ? { mode: 'INTERNAL', pollenParentPlantId: current.pollenParentPlantId! }
          : current.pollenSourceMode === 'EXTERNAL'
            ? {
                mode: 'EXTERNAL',
                pollenParentName: current.pollenParentName!,
                pollenBreeder: current.pollenBreeder,
                pollenCultivar: current.pollenCultivar,
              }
            : { mode: 'UNKNOWN' };
      const source = parsed.pollenSource ?? currentSource;
      const liveBatches = await tx.seedBatch.count({
        where: { pollinationAttemptId: id, voidedAt: null },
      });
      const pollinatedDateChanged =
        pollinatedOn !== current.pollinatedOn.toISOString().slice(0, 10);
      if (liveBatches && (pollinatedDateChanged || !sameSource(current, source)))
        throw new BreedingError(
          'PROVENANCE_LOCKED',
          'Live SeedBatch history locks this PollinationAttempt provenance. Void the dependent batches before changing it.',
        );
      if (source.mode === 'INTERNAL') {
        const pollenPlant = await tx.plant.findUnique({
          where: { id: source.pollenParentPlantId },
          select: { id: true },
        });
        if (!pollenPlant)
          throw new BreedingError(
            'POLLEN_PLANT_NOT_FOUND',
            'The internal pollen Plant could not be found.',
          );
      }
      return tx.pollinationAttempt.update({
        where: { id },
        data: {
          pollinatedOn: dateToSql(pollinatedOn),
          ...sourceData(source),
          notes: parsed.notes === undefined ? current.notes : parsed.notes,
          status: parsed.status ?? current.status,
          correctionReason: parsed.correctionReason,
          updatedAt: nextBreedingTimestamp(current.updatedAt, current.databaseNow),
        },
      });
    }, transactionOptions());
  } catch (error) {
    throwBreedingDatabaseError(error);
  }
}

export async function voidPollinationAttempt(
  id: string,
  input: VoidPollinationAttemptInput,
): Promise<PollinationAttempt> {
  const parsed = parseBreedingInput(voidPollinationAttemptSchema, input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const current = await lockAttempt(tx, id);
      ensureToken(current, parsed.expectedUpdatedAt, 'PollinationAttempt');
      if (current.voidedAt)
        throw new BreedingError(
          'POLLINATION_ATTEMPT_VOIDED',
          'This PollinationAttempt is already voided.',
        );
      const liveBatches = await tx.seedBatch.count({
        where: { pollinationAttemptId: id, voidedAt: null },
      });
      if (liveBatches)
        throw new BreedingError(
          'SEED_BATCH_PROVENANCE',
          'Cannot void a PollinationAttempt with live SeedBatch history.',
        );
      return tx.pollinationAttempt.update({
        where: { id },
        data: {
          voidedAt: current.databaseNow,
          correctionReason: parsed.correctionReason,
          updatedAt: nextBreedingTimestamp(current.updatedAt, current.databaseNow),
        },
      });
    }, transactionOptions());
  } catch (error) {
    throwBreedingDatabaseError(error);
  }
}

export type {
  CreatePollinationAttemptInput,
  ChangePollinationAttemptStatusInput,
  CorrectPollinationAttemptInput,
  VoidPollinationAttemptInput,
};
