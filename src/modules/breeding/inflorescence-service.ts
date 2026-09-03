import 'server-only';
import type { Inflorescence } from '../../generated/prisma/client';
import { dateToSql } from '../../lib/calendar-date';
import { getPrisma } from '../../lib/prisma';
import { BreedingError } from './breeding-errors';
import {
  changeInflorescenceStatusSchema,
  correctInflorescenceSchema,
  parseBreedingInput,
  parseBreedingId,
  parseCreateInflorescenceInput,
  voidInflorescenceSchema,
  type ChangeInflorescenceStatusInput,
  type CorrectInflorescenceInput,
  type CreateInflorescenceInput,
  type VoidInflorescenceInput,
} from './breeding-input';
import {
  ensureDateOrder,
  ensureNotFuture,
  ensurePlantEligible,
  ensureToken,
  lockInflorescence,
  lockPlant,
  nextBreedingTimestamp,
  throwBreedingDatabaseError,
  transactionOptions,
} from './breeding-persistence';

function validateDates(emergedOn: string | null, openedOn: string | null, now: Date) {
  if (emergedOn) ensureNotFuture(emergedOn, now, 'emergedOn');
  if (openedOn) ensureNotFuture(openedOn, now, 'openedOn');
  ensureDateOrder(emergedOn, openedOn);
}

export async function createInflorescence(
  plantId: string,
  input: CreateInflorescenceInput,
): Promise<Inflorescence> {
  const id = parseBreedingId(plantId);
  const parsed = parseCreateInflorescenceInput(input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const plant = await lockPlant(tx, id);
      ensurePlantEligible(plant);
      validateDates(parsed.emergedOn, parsed.openedOn, plant.databaseNow);
      return tx.inflorescence.create({
        data: {
          plantId: plant.id,
          emergedOn: parsed.emergedOn ? dateToSql(parsed.emergedOn) : null,
          openedOn: parsed.openedOn ? dateToSql(parsed.openedOn) : null,
          notes: parsed.notes,
        },
      });
    }, transactionOptions());
  } catch (error) {
    throwBreedingDatabaseError(error);
  }
}

const normalTransitions: Record<string, readonly string[]> = {
  OBSERVED: ['OPEN', 'ABORTED'],
  OPEN: ['FINISHED', 'ABORTED'],
};
function validateInflorescenceTransition(from: string, to: string) {
  if (!normalTransitions[from]?.includes(to))
    throw new BreedingError(
      'INVALID_STATUS_TRANSITION',
      `Inflorescence cannot transition from ${from} to ${to}.`,
    );
}

export async function changeInflorescenceStatus(
  id: string,
  input: ChangeInflorescenceStatusInput,
): Promise<Inflorescence> {
  const parsed = parseBreedingInput(changeInflorescenceStatusSchema, input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const current = await lockInflorescence(tx, id);
      ensureToken(current, parsed.expectedUpdatedAt, 'Inflorescence');
      if (current.voidedAt)
        throw new BreedingError(
          'INFLORESCENCE_VOIDED',
          'A voided Inflorescence cannot be transitioned.',
        );
      validateInflorescenceTransition(current.status, parsed.status);
      return tx.inflorescence.update({
        where: { id: current.id },
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

export async function correctInflorescence(
  id: string,
  input: CorrectInflorescenceInput,
): Promise<Inflorescence> {
  const parsed = parseBreedingInput(correctInflorescenceSchema, input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const current = await lockInflorescence(tx, id);
      ensureToken(current, parsed.expectedUpdatedAt, 'Inflorescence');
      if (current.voidedAt)
        throw new BreedingError(
          'INFLORESCENCE_VOIDED',
          'A voided Inflorescence cannot be corrected.',
        );
      const emergedOn =
        parsed.emergedOn === undefined
          ? (current.emergedOn?.toISOString().slice(0, 10) ?? null)
          : parsed.emergedOn;
      const openedOn =
        parsed.openedOn === undefined
          ? (current.openedOn?.toISOString().slice(0, 10) ?? null)
          : parsed.openedOn;
      validateDates(emergedOn, openedOn, current.databaseNow);
      return tx.inflorescence.update({
        where: { id },
        data: {
          emergedOn: emergedOn ? dateToSql(emergedOn) : null,
          openedOn: openedOn ? dateToSql(openedOn) : null,
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

export async function voidInflorescence(
  id: string,
  input: VoidInflorescenceInput,
): Promise<Inflorescence> {
  const parsed = parseBreedingInput(voidInflorescenceSchema, input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const current = await lockInflorescence(tx, id);
      ensureToken(current, parsed.expectedUpdatedAt, 'Inflorescence');
      if (current.voidedAt)
        throw new BreedingError('CONFLICT', 'This Inflorescence is already voided.');
      const live = await tx.pollinationAttempt.count({
        where: { inflorescenceId: id, voidedAt: null },
      });
      if (live)
        throw new BreedingError(
          'CONFLICT',
          'Cannot void an Inflorescence with a live PollinationAttempt.',
        );
      return tx.inflorescence.update({
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
  CreateInflorescenceInput,
  ChangeInflorescenceStatusInput,
  CorrectInflorescenceInput,
  VoidInflorescenceInput,
};
