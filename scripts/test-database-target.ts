import { z } from 'zod';

const environmentSchema = z.object({
  DATABASE_URL: z.url(),
  TEST_DATABASE_URL: z.url(),
});

export function getTestDatabaseUrl(
  environment: Record<string, string | undefined> = process.env,
): string {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    throw new Error('Set DATABASE_URL and TEST_DATABASE_URL to valid PostgreSQL URLs.');
  }

  const development = new URL(result.data.DATABASE_URL);
  const target = new URL(result.data.TEST_DATABASE_URL);

  for (const url of [development, target]) {
    if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
      throw new Error('Database URLs must use PostgreSQL.');
    }
  }

  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
    throw new Error('Database tests and test migrations require a local PostgreSQL server.');
  }

  const databaseName = decodeURIComponent(target.pathname.slice(1));
  const developmentName = decodeURIComponent(development.pathname.slice(1));

  if (!/^[a-zA-Z0-9_]+_test$/.test(databaseName) || databaseName === developmentName) {
    throw new Error('Use a separate database with a name ending in _test.');
  }

  for (const [key, value] of target.searchParams) {
    if (key !== 'schema' || value !== 'public') {
      throw new Error('The test URL may only specify schema=public as a query parameter.');
    }
  }

  return target.toString();
}
