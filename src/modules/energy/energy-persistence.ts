import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma, type Equipment, type ElectricityTariff } from '../../generated/prisma/client';
import { getPrisma } from '../../lib/prisma';
import { sqlToDate } from '../../lib/calendar-date';
import { EnergyError } from './energy-errors';

// Stable namespace for the one nursery tariff timeline. Transaction scoped, never session scoped.
export const TARIFF_LOCK_NAMESPACE = 0x414e5448; // ANTH
export const TARIFF_LOCK_ID = 1;
export function nextEnergyTimestamp(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}
export function intervalValues<T extends { effectiveFrom: Date; effectiveTo: Date | null }>(
  row: T,
) {
  const { effectiveFrom, effectiveTo, ...rest } = row;
  return {
    ...rest,
    effectiveFrom: sqlToDate(effectiveFrom),
    effectiveTo: effectiveTo ? sqlToDate(effectiveTo) : null,
  };
}
export function tariffTimelineToken(
  rows: readonly Pick<ElectricityTariff, 'id' | 'updatedAt' | 'voidedAt'>[],
): string {
  // Retained void markers prevent the empty -> populated -> empty stale-token ABA problem.
  const values = [...rows]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((row) => [row.id, row.updatedAt.toISOString(), row.voidedAt?.toISOString() ?? null]);
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
export async function withEquipmentEnergy<T>(
  equipmentId: string,
  expectedUpdatedAt: string,
  operation: (tx: Prisma.TransactionClient, equipment: Equipment) => Promise<T>,
): Promise<T> {
  try {
    return await getPrisma().$transaction(
      async (tx) => {
        const [equipment] = await tx.$queryRaw<
          Equipment[]
        >`SELECT * FROM public."Equipment" WHERE id = ${equipmentId}::uuid FOR NO KEY UPDATE`;
        if (!equipment) throw new EnergyError('NOT_FOUND', 'This Equipment could not be found.');
        if (equipment.updatedAt.toISOString() !== expectedUpdatedAt)
          throw new EnergyError(
            'STALE_UPDATE',
            'This Equipment or its energy history has changed. Review the latest information before saving again.',
          );
        return operation(tx, equipment);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    throwEnergyDatabaseError(error);
  }
}
export async function withTariffTimeline<T>(
  expectedTimelineToken: string,
  operation: (tx: Prisma.TransactionClient, rows: ElectricityTariff[]) => Promise<T>,
): Promise<T> {
  try {
    return await getPrisma().$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TARIFF_LOCK_NAMESPACE}::integer, ${TARIFF_LOCK_ID}::integer)`;
        const rows = await tx.electricityTariff.findMany({
          orderBy: [{ effectiveFrom: 'asc' }, { id: 'asc' }],
        });
        if (tariffTimelineToken(rows) !== expectedTimelineToken)
          throw new EnergyError(
            'STALE_UPDATE',
            'The electricity tariff history has changed. Review it before saving again.',
          );
        return operation(tx, rows);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    throwEnergyDatabaseError(error);
  }
}
export async function advanceEquipment(
  tx: Prisma.TransactionClient,
  equipment: Equipment,
): Promise<Date> {
  const updatedAt = nextEnergyTimestamp(equipment.updatedAt);
  await tx.equipment.update({ where: { id: equipment.id }, data: { updatedAt } });
  return updatedAt;
}

function databaseCode(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== 'object' || depth > 6) return;
  const record = error as Record<string, unknown>;
  for (const field of ['code', 'originalCode'])
    if (typeof record[field] === 'string' && /^23[A-Z0-9]{3}$/.test(record[field]))
      return record[field];
  for (const field of ['cause', 'meta', 'driverAdapterError']) {
    const code = databaseCode(record[field], depth + 1);
    if (code) return code;
  }
}
export function throwEnergyDatabaseError(error: unknown): never {
  if (error instanceof EnergyError) throw error;
  const sqlCode = databaseCode(error);
  if (sqlCode === '23P01')
    throw new EnergyError('OVERLAP', 'These dates overlap another effective energy period.', {
      cause: error,
    });
  if (sqlCode === '23514')
    throw new EnergyError(
      'VALIDATION_FAILED',
      'The energy information violates a database rule. Review the values and dates.',
      { cause: error },
    );
  if (
    sqlCode?.startsWith('23') ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2003', 'P2004', 'P2025', 'P2034'].includes(error.code))
  )
    throw new EnergyError(
      'CONFLICT',
      'The energy history could not be saved because of conflicting data.',
      { cause: error },
    );
  // Infrastructure errors retain their original diagnostics, distinct from expected domain errors.
  throw error;
}
