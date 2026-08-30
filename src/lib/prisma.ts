import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { PrismaClient } from '../generated/prisma/client';

const globalForPrisma = globalThis as typeof globalThis & {
  anthNurseryPrisma?: PrismaClient;
};
let client: PrismaClient | undefined;

// Connect on first use, not when an unrelated page is imported or built.
export function getPrisma(): PrismaClient {
  if (client) return client;
  if (globalForPrisma.anthNurseryPrisma) return globalForPrisma.anthNurseryPrisma;

  const result = z.url().safeParse(process.env.DATABASE_URL);
  if (!result.success || !['postgres:', 'postgresql:'].includes(new URL(result.data).protocol)) {
    throw new Error('Set DATABASE_URL to a valid PostgreSQL connection URL.');
  }

  client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: result.data, connectionTimeoutMillis: 5_000 }),
  });
  if (process.env.NODE_ENV !== 'production') globalForPrisma.anthNurseryPrisma = client;
  return client;
}
