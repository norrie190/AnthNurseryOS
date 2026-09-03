import 'server-only';
import { Prisma } from '../../generated/prisma/client';
import { WateringError } from './watering-errors';

export function nextWateringTimestamp(previous: Date, databaseNow: Date): Date {
  return new Date(Math.max(databaseNow.getTime(), previous.getTime() + 1));
}

function databaseCode(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== 'object' || depth > 6) return;
  const record = error as Record<string, unknown>;
  for (const field of ['code', 'originalCode']) {
    if (typeof record[field] === 'string' && /^23[A-Z0-9]{3}$/.test(record[field])) {
      return record[field];
    }
  }
  for (const field of ['cause', 'meta', 'driverAdapterError']) {
    const code = databaseCode(record[field], depth + 1);
    if (code) return code;
  }
}

export function throwWateringDatabaseError(error: unknown): never {
  if (error instanceof WateringError) throw error;
  const sqlCode = databaseCode(error);
  if (sqlCode === '23514') {
    throw new WateringError(
      'VALIDATION_FAILED',
      'The watering information violates a database rule. Review the supplied values.',
      { cause: error },
    );
  }
  if (
    sqlCode?.startsWith('23') ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2003', 'P2004', 'P2025', 'P2034'].includes(error.code))
  ) {
    throw new WateringError(
      'CONFLICT',
      'The watering history could not be saved because of conflicting data.',
      { cause: error },
    );
  }
  throw error;
}
