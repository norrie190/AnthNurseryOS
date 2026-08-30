import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');

function checkDatabase(variableName: 'DATABASE_URL' | 'TEST_DATABASE_URL'): void {
  const databaseUrl = process.env[variableName];

  if (!databaseUrl) {
    throw new Error(`${variableName} is missing. Check your .env file.`);
  }

  const target = new URL(databaseUrl);

  if (target.protocol !== 'postgresql:' && target.protocol !== 'postgres:') {
    throw new Error(`${variableName} must use a PostgreSQL connection string.`);
  }

  execFileSync(process.execPath, [prismaCli, 'db', 'execute', '--stdin'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    input: 'SELECT 1;',
    stdio: ['pipe', 'inherit', 'inherit'],
    timeout: 30_000,
  });

  console.log(
    `${variableName}: connected to ${target.hostname}:${target.port || '5432'}${target.pathname}`,
  );
}

try {
  checkDatabase('DATABASE_URL');
  checkDatabase('TEST_DATABASE_URL');
} catch {
  console.error('Database check failed. Check the connection settings and that Docker is running.');
  process.exitCode = 1;
}
