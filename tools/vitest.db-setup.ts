// Global setup shared by the `db` and `e2e` Vitest projects, which need a live MySQL.
// It runs once, before the first test file, and does three things:
//   1. refuses to run unless the test database is a database whose name ends in `_test`
//   2. fails at once, with a readable message, when MySQL cannot be reached
//   3. points DATABASE_URL at the test database, so code under test never touches `freshrescue`
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));

function redact(url: string): string {
  const copy = new URL(url);
  if (copy.password) copy.password = '***';
  return copy.toString();
}

export default async function setup(): Promise<void> {
  // Variables that are already set in the environment win over the file.
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env (cp .env.example .env).');
  }

  const database = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!database.endsWith('_test')) {
    throw new Error(`Refusing to run tests on database "${database}": a test database name must end in _test.`);
  }

  try {
    const connection = await mysql.createConnection({ uri: url, connectTimeout: 5000 });
    await connection.query('SELECT 1');
    await connection.end();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `MySQL is not reachable with TEST_DATABASE_URL (${redact(url)}): ${reason}\n` +
        'Run `npm run db:ping` for a diagnosis, and tools/sql/init-dev.sql if the database or user is missing.',
      { cause: error },
    );
  }

  process.env.DATABASE_URL = url;
}
