import 'server-only';
import {
  Prisma,
  type Inflorescence,
  type Plant,
  type PollinationAttempt,
  type SeedBatch,
} from '../../generated/prisma/client';
import { nurseryDateForInstant } from '../../lib/calendar-date';
import { BreedingError } from './breeding-errors';

export type LockedPlant = Pick<Plant, 'id' | 'status' | 'archivedAt'> & { databaseNow: Date };
export type LockedInflorescence = Inflorescence & { databaseNow: Date };
export type LockedAttempt = PollinationAttempt & { databaseNow: Date };
export type LockedSeedBatch = SeedBatch & { databaseNow: Date };

export function nextBreedingTimestamp(previous: Date, databaseNow: Date): Date {
  return new Date(Math.max(databaseNow.getTime(), previous.getTime() + 1));
}

export function ensureNotFuture(value: string, databaseNow: Date, field: string): void {
  if (value > nurseryDateForInstant(databaseNow)) {
    throw new BreedingError('VALIDATION_FAILED', 'Breeding dates cannot be in the future.', {
      issues: [{ field, message: 'Enter a date that is not in the future.' }],
    });
  }
}

export function ensureDateOrder(emergedOn: string | null, openedOn: string | null): void {
  if (emergedOn && openedOn && openedOn < emergedOn) {
    throw new BreedingError(
      'VALIDATION_FAILED',
      'An opened date cannot be before the emerged date.',
      {
        issues: [{ field: 'openedOn', message: 'Enter a date on or after emergedOn.' }],
      },
    );
  }
}

export function ensurePlantEligible(plant: LockedPlant): void {
  if (plant.archivedAt !== null || (plant.status !== 'GROWING' && plant.status !== 'QUARANTINE')) {
    throw new BreedingError(
      'PLANT_NOT_ELIGIBLE',
      'New breeding records require an active Growing or Quarantine Plant.',
    );
  }
}

export function ensureToken(current: { updatedAt: Date }, expected: string, kind: string): void {
  if (current.updatedAt.toISOString() !== expected) {
    throw new BreedingError(
      'STALE_UPDATE',
      `This ${kind} has changed. Review the latest history before saving again.`,
    );
  }
}

export async function lockPlant(
  tx: Prisma.TransactionClient,
  plantId: string,
): Promise<LockedPlant> {
  const [plant] = await tx.$queryRaw<LockedPlant[]>`
    SELECT "id", "status", "archivedAt", clock_timestamp() AS "databaseNow"
    FROM public."Plant" WHERE "id" = ${plantId}::uuid FOR NO KEY UPDATE
  `;
  if (!plant) throw new BreedingError('PLANT_NOT_FOUND', 'This Plant could not be found.');
  return plant;
}

export async function lockInflorescence(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<LockedInflorescence> {
  const [row] = await tx.$queryRaw<LockedInflorescence[]>`
    SELECT i.*, clock_timestamp() AS "databaseNow"
    FROM public."Inflorescence" i WHERE i."id" = ${id}::uuid FOR NO KEY UPDATE
  `;
  if (!row)
    throw new BreedingError('INFLORESCENCE_NOT_FOUND', 'This Inflorescence could not be found.');
  return row;
}

export async function lockAttempt(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<LockedAttempt> {
  const [row] = await tx.$queryRaw<LockedAttempt[]>`
    SELECT a.*, clock_timestamp() AS "databaseNow"
    FROM public."PollinationAttempt" a WHERE a."id" = ${id}::uuid FOR NO KEY UPDATE
  `;
  if (!row)
    throw new BreedingError(
      'POLLINATION_ATTEMPT_NOT_FOUND',
      'This PollinationAttempt could not be found.',
    );
  return row;
}

export async function lockSeedBatch(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<LockedSeedBatch> {
  const [row] = await tx.$queryRaw<LockedSeedBatch[]>`
    SELECT b.*, clock_timestamp() AS "databaseNow"
    FROM public."SeedBatch" b WHERE b."id" = ${id}::uuid FOR NO KEY UPDATE
  `;
  if (!row) throw new BreedingError('SEED_BATCH_NOT_FOUND', 'This SeedBatch could not be found.');
  return row;
}

function databaseCode(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== 'object' || depth > 6) return;
  const record = error as Record<string, unknown>;
  for (const field of ['code', 'originalCode']) {
    if (
      typeof record[field] === 'string' &&
      (/^23[A-Z0-9]{3}$/.test(record[field]) || /^P\d{4}$/.test(record[field]))
    )
      return record[field];
  }
  for (const field of ['cause', 'meta', 'driverAdapterError']) {
    const code = databaseCode(record[field], depth + 1);
    if (code) return code;
  }
}

export function throwBreedingDatabaseError(error: unknown): never {
  if (error instanceof BreedingError) throw error;
  const code = databaseCode(error);
  if (code === '23514')
    throw new BreedingError(
      'VALIDATION_FAILED',
      'The breeding information violates a database rule.',
      { cause: error },
    );
  if (code === '23505' || code === 'P2002')
    throw new BreedingError(
      'POLLINATION_ATTEMPT_EXISTS',
      'This Inflorescence already has a non-void PollinationAttempt.',
      { cause: error },
    );
  if (
    code?.startsWith('23') ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2003', 'P2025', 'P2034'].includes(error.code))
  )
    throw new BreedingError(
      'CONFLICT',
      'The breeding history could not be saved because of conflicting data.',
      { cause: error },
    );
  throw error;
}

export function transactionOptions() {
  return { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted } as const;
}
