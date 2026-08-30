import 'dotenv/config';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { getPrisma } from '../../src/lib/prisma';

vi.mock('server-only', () => ({}));

const connectionString = getTestDatabaseUrl();

beforeAll(() => {
  // Validate the separate target first, then redirect only this test process's runtime client.
  vi.stubEnv('DATABASE_URL', connectionString);
});

afterAll(async () => {
  await getPrisma().$disconnect();
  vi.unstubAllEnvs();
});

test('the application Prisma client connects to the guarded test database and is reused', async () => {
  const database = getPrisma();
  expect(getPrisma()).toBe(database);
  const [row] = await database.$queryRaw<{ name: string; version: number }[]>`
    SELECT current_database() AS name, current_setting('server_version_num')::int AS version
  `;
  expect(row.name).toBe(decodeURIComponent(new URL(connectionString).pathname.slice(1)));
  expect(row.version).toBeGreaterThanOrEqual(180000);
  expect(row.version).toBeLessThan(190000);
});
