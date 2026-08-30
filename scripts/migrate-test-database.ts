import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { getTestDatabaseUrl } from './test-database-target.ts';

const require = createRequire(import.meta.url);

try {
  const databaseUrl = getTestDatabaseUrl();

  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
    timeout: 120_000,
  });
} catch {
  console.error('Test migration failed. Check Docker and the separate local TEST_DATABASE_URL.');
  process.exitCode = 1;
}
