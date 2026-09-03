import 'server-only';
import type { PollinationAttempt, SeedBatch } from '../../generated/prisma/client';
import { dateToSql } from '../../lib/calendar-date';
import { getPrisma } from '../../lib/prisma';
import { BreedingError } from './breeding-errors';
import {
  closeSeedBatchSchema,
  correctSeedBatchSchema,
  parseBreedingId,
  parseBreedingInput,
  recordSeedBatchGerminationSchema,
  recordSeedBatchHarvestSchema,
  recordSeedBatchSowingSchema,
  voidSeedBatchSchema,
  type CloseSeedBatchInput,
  type CorrectSeedBatchInput,
  type RecordSeedBatchGerminationInput,
  type RecordSeedBatchHarvestInput,
  type RecordSeedBatchSowingInput,
  type VoidSeedBatchInput,
} from './breeding-input';
import {
  ensureNotFuture,
  ensureToken,
  lockAttempt,
  lockSeedBatch,
  nextBreedingTimestamp,
  throwBreedingDatabaseError,
  transactionOptions,
} from './breeding-persistence';

function dateValue(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

function ensureDates(harvestedOn: string, sownOn: string | null, now: Date): void {
  ensureNotFuture(harvestedOn, now, 'harvestedOn');
  if (sownOn) ensureNotFuture(sownOn, now, 'sownOn');
  if (sownOn && sownOn < harvestedOn)
    throw new BreedingError('VALIDATION_FAILED', 'A sowing date cannot be before harvest.', {
      issues: [{ field: 'sownOn', message: 'Enter a date on or after harvestedOn.' }],
    });
}

function ensureCoherent(
  status: string,
  harvestedOn: string,
  sownOn: string | null,
  seedCount: number | null,
  germinatedCount: number | null,
  now: Date,
): void {
  ensureDates(harvestedOn, sownOn, now);
  if (germinatedCount !== null && seedCount !== null && germinatedCount > seedCount)
    throw new BreedingError('VALIDATION_FAILED', 'Germinated count cannot exceed seed count.');
  if (
    status === 'HARVESTED' &&
    (sownOn !== null || (germinatedCount !== null && germinatedCount > 0))
  )
    throw new BreedingError(
      'SEED_BATCH_INVALID_TRANSITION',
      'A harvested batch cannot have sowing or positive germination recorded.',
    );
  if (
    status === 'AWAITING_GERMINATION' &&
    (!sownOn || (germinatedCount !== null && germinatedCount > 0))
  )
    throw new BreedingError(
      'SEED_BATCH_INVALID_TRANSITION',
      'Awaiting germination requires sowing and no positive germination.',
    );
  if (status === 'GERMINATING' && (!sownOn || germinatedCount === null || germinatedCount <= 0))
    throw new BreedingError(
      'SEED_BATCH_INVALID_TRANSITION',
      'Germinating requires sowing and a positive germination count.',
    );
  if (status === 'EXHAUSTED' && !sownOn)
    throw new BreedingError(
      'SEED_BATCH_INVALID_TRANSITION',
      'An exhausted batch must have been sown.',
    );
  if (status === 'FAILED' && germinatedCount !== null && germinatedCount > 0 && !sownOn)
    throw new BreedingError(
      'SEED_BATCH_INVALID_TRANSITION',
      'A failed batch with germination must have been sown.',
    );
}

export type SeedBatchHarvestResult = { batch: SeedBatch; pollinationAttempt: PollinationAttempt };

export async function recordSeedBatchHarvest(
  pollinationAttemptId: string,
  input: RecordSeedBatchHarvestInput,
): Promise<SeedBatchHarvestResult> {
  const id = parseBreedingId(pollinationAttemptId);
  const parsed = parseBreedingInput(recordSeedBatchHarvestSchema, input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const attempt = await lockAttempt(tx, id);
      ensureToken(attempt, parsed.expectedPollinationUpdatedAt, 'PollinationAttempt');
      if (attempt.voidedAt)
        throw new BreedingError(
          'POLLINATION_ATTEMPT_VOIDED',
          'A voided PollinationAttempt cannot be harvested.',
        );
      if (attempt.status === 'FAILED')
        throw new BreedingError(
          'POLLINATION_ATTEMPT_NOT_HARVESTABLE',
          'A failed PollinationAttempt cannot be harvested.',
        );
      ensureNotFuture(parsed.harvestedOn, attempt.databaseNow, 'harvestedOn');
      const batch = await tx.seedBatch.create({
        data: {
          pollinationAttemptId: attempt.id,
          harvestedOn: dateToSql(parsed.harvestedOn),
          seedCount: parsed.seedCount ?? null,
          notes: parsed.notes,
        },
      });
      const pollinationAttempt = await tx.pollinationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'HARVESTED',
          updatedAt: nextBreedingTimestamp(attempt.updatedAt, attempt.databaseNow),
        },
      });
      return { batch, pollinationAttempt };
    }, transactionOptions());
  } catch (error) {
    throwBreedingDatabaseError(error);
  }
}

export async function recordSeedBatchSowing(
  seedBatchId: string,
  input: RecordSeedBatchSowingInput,
): Promise<SeedBatch> {
  const id = parseBreedingId(seedBatchId);
  const parsed = parseBreedingInput(recordSeedBatchSowingSchema, input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const current = await lockSeedBatch(tx, id);
      ensureToken(current, parsed.expectedUpdatedAt, 'SeedBatch');
      if (current.voidedAt)
        throw new BreedingError('SEED_BATCH_VOIDED', 'A voided SeedBatch cannot be sown.');
      if (current.status !== 'HARVESTED' || current.sownOn)
        throw new BreedingError(
          'SEED_BATCH_ALREADY_SOWN',
          'This SeedBatch has already left the harvested state.',
        );
      const harvestedOn = dateValue(current.harvestedOn)!;
      ensureDates(harvestedOn, parsed.sownOn, current.databaseNow);
      return tx.seedBatch.update({
        where: { id },
        data: {
          sownOn: dateToSql(parsed.sownOn),
          status: 'AWAITING_GERMINATION',
          updatedAt: nextBreedingTimestamp(current.updatedAt, current.databaseNow),
        },
      });
    }, transactionOptions());
  } catch (error) {
    throwBreedingDatabaseError(error);
  }
}

export async function recordSeedBatchGermination(
  seedBatchId: string,
  input: RecordSeedBatchGerminationInput,
): Promise<SeedBatch> {
  const id = parseBreedingId(seedBatchId);
  const parsed = parseBreedingInput(recordSeedBatchGerminationSchema, input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const current = await lockSeedBatch(tx, id);
      ensureToken(current, parsed.expectedUpdatedAt, 'SeedBatch');
      if (current.voidedAt)
        throw new BreedingError('SEED_BATCH_VOIDED', 'A voided SeedBatch cannot be updated.');
      if (!current.sownOn)
        throw new BreedingError(
          'SEED_BATCH_NOT_SOWN',
          'Record sowing before recording germination.',
        );
      if (current.status !== 'AWAITING_GERMINATION' && current.status !== 'GERMINATING')
        throw new BreedingError(
          'SEED_BATCH_INVALID_TRANSITION',
          'This SeedBatch is not open for germination updates.',
        );
      const oldCount = current.germinatedCount ?? 0;
      if (parsed.germinatedCount < oldCount)
        throw new BreedingError(
          'GERMINATION_REGRESSION',
          'Germination counts cannot decrease through the normal command.',
        );
      if (current.seedCount !== null && parsed.germinatedCount > current.seedCount)
        throw new BreedingError('VALIDATION_FAILED', 'Germinated count cannot exceed seed count.');
      return tx.seedBatch.update({
        where: { id },
        data: {
          germinatedCount: parsed.germinatedCount,
          status: parsed.germinatedCount > 0 ? 'GERMINATING' : 'AWAITING_GERMINATION',
          updatedAt: nextBreedingTimestamp(current.updatedAt, current.databaseNow),
        },
      });
    }, transactionOptions());
  } catch (error) {
    throwBreedingDatabaseError(error);
  }
}

export async function closeSeedBatch(
  seedBatchId: string,
  input: CloseSeedBatchInput,
): Promise<SeedBatch> {
  const id = parseBreedingId(seedBatchId);
  const parsed = parseBreedingInput(closeSeedBatchSchema, input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const current = await lockSeedBatch(tx, id);
      ensureToken(current, parsed.expectedUpdatedAt, 'SeedBatch');
      if (current.voidedAt)
        throw new BreedingError('SEED_BATCH_VOIDED', 'A voided SeedBatch cannot be closed.');
      if (current.status === 'EXHAUSTED' || current.status === 'FAILED')
        throw new BreedingError(
          'SEED_BATCH_INVALID_TRANSITION',
          'A terminal SeedBatch cannot be reopened by an ordinary outcome command.',
        );
      if (parsed.status === 'EXHAUSTED' && !current.sownOn)
        throw new BreedingError(
          'SEED_BATCH_INVALID_TRANSITION',
          'An exhausted batch must have been sown.',
        );
      return tx.seedBatch.update({
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

export async function correctSeedBatch(
  seedBatchId: string,
  input: CorrectSeedBatchInput,
): Promise<SeedBatch> {
  const id = parseBreedingId(seedBatchId);
  const parsed = parseBreedingInput(correctSeedBatchSchema, input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const current = await lockSeedBatch(tx, id);
      ensureToken(current, parsed.expectedUpdatedAt, 'SeedBatch');
      if (current.voidedAt)
        throw new BreedingError('SEED_BATCH_VOIDED', 'A voided SeedBatch cannot be corrected.');
      const harvestedOn = parsed.harvestedOn ?? dateValue(current.harvestedOn)!;
      const sownOn = parsed.sownOn === undefined ? dateValue(current.sownOn) : parsed.sownOn;
      const seedCount = parsed.seedCount === undefined ? current.seedCount : parsed.seedCount;
      const germinatedCount =
        parsed.germinatedCount === undefined ? current.germinatedCount : parsed.germinatedCount;
      const status = parsed.status ?? current.status;
      ensureCoherent(status, harvestedOn, sownOn, seedCount, germinatedCount, current.databaseNow);
      return tx.seedBatch.update({
        where: { id },
        data: {
          harvestedOn: dateToSql(harvestedOn),
          sownOn: sownOn ? dateToSql(sownOn) : null,
          seedCount,
          germinatedCount,
          notes: parsed.notes === undefined ? current.notes : parsed.notes,
          status,
          correctionReason: parsed.correctionReason,
          updatedAt: nextBreedingTimestamp(current.updatedAt, current.databaseNow),
        },
      });
    }, transactionOptions());
  } catch (error) {
    throwBreedingDatabaseError(error);
  }
}

export async function voidSeedBatch(
  seedBatchId: string,
  input: VoidSeedBatchInput,
): Promise<SeedBatch> {
  const id = parseBreedingId(seedBatchId);
  const parsed = parseBreedingInput(voidSeedBatchSchema, input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const current = await lockSeedBatch(tx, id);
      ensureToken(current, parsed.expectedUpdatedAt, 'SeedBatch');
      if (current.voidedAt)
        throw new BreedingError('SEED_BATCH_VOIDED', 'This SeedBatch is already voided.');
      return tx.seedBatch.update({
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
  RecordSeedBatchHarvestInput,
  RecordSeedBatchSowingInput,
  RecordSeedBatchGerminationInput,
  CloseSeedBatchInput,
  CorrectSeedBatchInput,
  VoidSeedBatchInput,
};
