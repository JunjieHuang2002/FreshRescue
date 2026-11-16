import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { connectionOptionsOf } from './pool';
import { MIGRATIONS_TABLE } from './tables';

// The migration runner (plan, phase 7). It brings the schema of a database up to date before the API
// serves anything, and it is idempotent: it records each migration it applies, by its file name, and
// applies only the ones it has not recorded. Running it twice changes nothing.

/** The folder of the migrations: `NNNN_name.sql` files, applied in the order of their names. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url));

const MIGRATION_FILE = /^\d{4}_\w+\.sql$/;

type Migration = { readonly version: string; readonly sql: string };

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
const unavailable = (detail: string): Result<never, DomainError> => ({ ok: false, err: { code: 'STORE_UNAVAILABLE', detail } });

/** Every migration file of the folder, in order, with its SQL. */
async function migrationsIn(folder: string): Promise<Result<readonly Migration[], DomainError>> {
  try {
    const names = (await readdir(folder)).filter((name) => MIGRATION_FILE.test(name)).sort();
    const migrations: Migration[] = [];
    for (const name of names) migrations.push({ version: name.slice(0, -'.sql'.length), sql: await readFile(join(folder, name), 'utf8') });
    return { ok: true, value: migrations };
  } catch (cause) {
    return unavailable(`the migrations in ${folder} cannot be read: ${reasonOf(cause)}`);
  }
}

/** The versions recorded so far. A database that has no record table yet has applied nothing: the first migration creates it. */
async function appliedVersions(connection: Connection): Promise<ReadonlySet<string>> {
  const [tables] = await connection.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [MIGRATIONS_TABLE.name],
  );
  if (Number(tables[0]?.n ?? 0) === 0) return new Set();
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT ${mysql.escapeId(MIGRATIONS_TABLE.version)} AS version FROM ${mysql.escapeId(MIGRATIONS_TABLE.name)}`,
  );
  return new Set(rows.map((row) => String(row.version)));
}

/** Applies, in order, each migration that is not recorded, and records it once it has run. */
async function applyPending(connection: Connection, migrations: readonly Migration[]): Promise<Result<readonly string[], DomainError>> {
  const applied = await appliedVersions(connection);
  const done: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    try {
      await connection.query(migration.sql);
    } catch (cause) {
      return unavailable(`migration ${migration.version} failed: ${reasonOf(cause)}`);
    }
    await connection.query(
      `INSERT INTO ${mysql.escapeId(MIGRATIONS_TABLE.name)} (${mysql.escapeId(MIGRATIONS_TABLE.version)}) VALUES (?)`,
      [migration.version],
    );
    done.push(migration.version);
  }
  return { ok: true, value: done };
}

/**
 * Brings the database at `databaseUrl` up to date and answers with the versions it applied this time,
 * which is none when the schema was current already. It opens a connection of its own, because a
 * migration file holds several statements, and closes it again. Every failure, from an unreadable
 * folder to a database that cannot be reached or a statement that fails, is STORE_UNAVAILABLE, since
 * a store without its schema cannot be used; nothing is thrown.
 *
 * MySQL does not undo a CREATE TABLE when a later statement fails, so a migration that stopped half
 * way through is not recorded and runs again next time, which its `IF NOT EXISTS` clauses allow.
 */
export async function migrate(databaseUrl: string, folder: string = MIGRATIONS_FOLDER): Promise<Result<readonly string[], DomainError>> {
  const migrations = await migrationsIn(folder);
  if (!migrations.ok) return migrations;

  let connection: Connection;
  try {
    connection = await mysql.createConnection({ ...connectionOptionsOf(databaseUrl), multipleStatements: true });
  } catch (cause) {
    return unavailable(`the database cannot be reached to migrate it: ${reasonOf(cause)}`);
  }
  try {
    return await applyPending(connection, migrations.value);
  } catch (cause) {
    return unavailable(`the schema cannot be brought up to date: ${reasonOf(cause)}`);
  } finally {
    try {
      await connection.end();
    } catch {
      // the connection is gone already, which is all that closing it was for
    }
  }
}
