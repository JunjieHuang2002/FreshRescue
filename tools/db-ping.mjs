#!/usr/bin/env node
// Proves that MySQL answers, using the connection strings in .env.
//
//   npm run db:ping
//
// It opens a connection with DATABASE_URL and one with TEST_DATABASE_URL, asks each
// server for its version, and checks that the version is 8.0.19 or newer (the row-alias
// form of ON DUPLICATE KEY UPDATE that phase 7 uses needs it). On success it prints
// `MySQL OK version=<version>` and exits 0; otherwise it says what is wrong and exits 1.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const MINIMUM = [8, 0, 19];
const CONNECTION_VARIABLES = ['DATABASE_URL', 'TEST_DATABASE_URL'];

// Variables that are already set in the environment win over the file.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

function redact(url) {
  const copy = new URL(url);
  if (copy.password) copy.password = '***';
  return copy.toString();
}

function advice(code) {
  switch (code) {
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
    case 'ENOTFOUND':
      return 'Nothing answered. Check that MySQL is running and that this machine can reach host and port.';
    case 'ER_ACCESS_DENIED_ERROR':
      return 'The server rejected the user or password. Run tools/sql/init-dev.sql as a MySQL admin to create the user.';
    case 'ER_BAD_DB_ERROR':
    case 'ER_DBACCESS_DENIED_ERROR':
      return 'The database does not exist, or this user may not use it. Run tools/sql/init-dev.sql as a MySQL admin to create the databases and their grants.';
    default:
      return '';
  }
}

async function ask(variable) {
  const url = process.env[variable];
  if (!url) {
    throw new Error(`${variable} is not set. Copy .env.example to .env (cp .env.example .env).`);
  }
  let connection;
  try {
    connection = await mysql.createConnection({ uri: url, connectTimeout: 5000 });
    const [rows] = await connection.query('SELECT VERSION() AS version, DATABASE() AS db');
    return rows[0];
  } catch (error) {
    const detail = [error.code, error.message].filter(Boolean).join(' ');
    throw new Error(`${variable} (${redact(url)}) failed: ${detail}\n${advice(error.code)}`.trimEnd(), {
      cause: error,
    });
  } finally {
    await connection?.end().catch(() => {});
  }
}

function atLeast(version, minimum) {
  const found = /^(\d+)\.(\d+)\.(\d+)/.exec(version)?.slice(1).map(Number);
  if (!found) return false;
  for (let i = 0; i < minimum.length; i += 1) {
    if (found[i] !== minimum[i]) return found[i] > minimum[i];
  }
  return true;
}

try {
  let version;
  for (const variable of CONNECTION_VARIABLES) {
    const answer = await ask(variable);
    console.log(`${variable}: connected to database "${answer.db}" on MySQL ${answer.version}`);
    version ??= answer.version;
  }
  if (!atLeast(version, MINIMUM)) {
    throw new Error(`MySQL ${version} is older than ${MINIMUM.join('.')}.`);
  }
  console.log(`MySQL OK version=${version}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
