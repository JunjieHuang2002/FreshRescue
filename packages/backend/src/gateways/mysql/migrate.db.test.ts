import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, migrate } from './migrate';

// The migration runner on the real MySQL test database (plan, phase 7, row 2: running the migration
// twice changes nothing). The db project's setup points DATABASE_URL at the test database.

const DATABASE_URL = process.env.DATABASE_URL ?? expect.unreachable('DATABASE_URL is not set: run this file with npm run test:db');
const UNREACHABLE_URL = 'mysql://freshrescue:wrong@127.0.0.1:1/freshrescue_test';

const NINE_TABLES = [
  'app_counters',
  'app_settings',
  'batch',
  'food_category',
  'food_type',
  'recipe',
  'recipe_category',
  'recipe_ingredient',
  'schema_migrations',
];

let sql: Connection;

beforeAll(async () => {
  sql = await mysql.createConnection({ uri: DATABASE_URL, dateStrings: true });
});

afterAll(async () => {
  // whatever a test did, the test database is left migrated for the next file
  const migrated = await migrate(DATABASE_URL);
  await sql.end();
  expect(migrated.ok).toBe(true);
});

async function rowsOf(query: string, values: unknown[] = []): Promise<RowDataPacket[]> {
  const [rows] = await sql.query<RowDataPacket[]>(query, values);
  return rows;
}

async function tableNames(): Promise<string[]> {
  const rows = await rowsOf('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name');
  return rows.map((row) => String(row.name));
}

async function appliedVersions(): Promise<string[]> {
  return (await rowsOf('SELECT version FROM schema_migrations ORDER BY version')).map((row) => String(row.version));
}

/** Every table's definition and rows: what "changes nothing" compares. */
async function everything(): Promise<Record<string, { definition: string; rows: RowDataPacket[] }>> {
  const all: Record<string, { definition: string; rows: RowDataPacket[] }> = {};
  for (const table of await tableNames()) {
    const [created] = await rowsOf(`SHOW CREATE TABLE ${mysql.escapeId(table)}`);
    const rows = table === 'schema_migrations' ? await rowsOf('SELECT version, applied_at FROM schema_migrations ORDER BY version') : await rowsOf(`SELECT * FROM ${mysql.escapeId(table)}`);
    all[table] = { definition: String(created?.['Create Table']), rows };
  }
  return all;
}

async function dropTheNineTables(): Promise<void> {
  await sql.query(`DROP TABLE IF EXISTS ${NINE_TABLES.map((table) => mysql.escapeId(table)).join(', ')}`);
}

/** A folder with a copy of the real migrations plus the extra files a test adds, removed afterwards. */
async function withFolder(extra: Record<string, string>, run: (folder: string) => Promise<void>): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), 'freshrescue-migrations-'));
  try {
    await copyFile(join(MIGRATIONS_FOLDER, '0001_init.sql'), join(folder, '0001_init.sql'));
    for (const [name, text] of Object.entries(extra)) await writeFile(join(folder, name), text);
    await run(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

describe('migrate', () => {
  it('creates the nine tables in a database that has none, and records 0001_init', async () => {
    await dropTheNineTables();
    expect(await tableNames()).toEqual([]);

    expect(await migrate(DATABASE_URL)).toEqual({ ok: true, value: ['0001_init'] });

    expect(await tableNames()).toEqual(NINE_TABLES);
    expect(await appliedVersions()).toEqual(['0001_init']);
  });

  it('changes nothing when it runs a second time: it applies no migration, and every table keeps its definition and its rows', async () => {
    await migrate(DATABASE_URL);
    await sql.query('DELETE FROM food_category');
    await sql.query("INSERT INTO food_category (id, name, parent_id, is_system, custom_threshold_days) VALUES (1, 'Other', NULL, TRUE, NULL)");
    const before = await everything();

    expect(await migrate(DATABASE_URL)).toEqual({ ok: true, value: [] });
    expect(await migrate(DATABASE_URL)).toEqual({ ok: true, value: [] });

    expect(await everything()).toEqual(before);
    expect(Object.keys(before).sort()).toEqual(NINE_TABLES);
    await sql.query('DELETE FROM food_category');
  });

  it('runs again after a start that was cut short: tables that exist already are kept, and the migration is recorded once', async () => {
    await dropTheNineTables();
    await sql.query('CREATE TABLE food_category (id BIGINT UNSIGNED NOT NULL, name VARCHAR(200) NOT NULL, parent_id BIGINT UNSIGNED NULL, is_system BOOLEAN NOT NULL, custom_threshold_days BIGINT UNSIGNED NULL, PRIMARY KEY (id))');

    expect(await migrate(DATABASE_URL)).toEqual({ ok: true, value: ['0001_init'] });

    expect(await tableNames()).toEqual(NINE_TABLES);
    expect(await appliedVersions()).toEqual(['0001_init']);
  });

  it('builds the schema the plan describes: a CHECK of 1 to 500,000,000 on both quantities, an auto-increment seq and a unique recipe and Food Type pair for the ingredient rows, and no foreign key', async () => {
    await migrate(DATABASE_URL);

    const checks = await rowsOf(
      `SELECT tc.table_name AS tableName, cc.check_clause AS clause FROM information_schema.table_constraints tc
         JOIN information_schema.check_constraints cc ON cc.constraint_schema = tc.constraint_schema AND cc.constraint_name = tc.constraint_name
        WHERE tc.table_schema = DATABASE() AND tc.constraint_type = 'CHECK' ORDER BY tc.table_name`,
    );
    const quantityChecks = checks.filter((row) => /quantity/.test(String(row.clause)));
    expect(quantityChecks.map((row) => row.tableName)).toEqual(['batch', 'recipe_ingredient']);
    for (const row of quantityChecks) expect(String(row.clause)).toMatch(/between 1 and 500000000/i);

    const autoIncrement = await rowsOf(
      "SELECT table_name AS tableName, column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND extra LIKE '%auto_increment%'",
    );
    expect(autoIncrement.map((row) => `${row.tableName}.${row.columnName}`)).toEqual(['recipe_ingredient.seq']);

    const unique = await rowsOf(
      `SELECT index_name AS indexName, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columnList FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'recipe_ingredient' AND non_unique = 0 AND index_name <> 'PRIMARY' GROUP BY index_name`,
    );
    expect(unique.map((row) => row.columnList)).toEqual(['recipe_id,food_type_id']);

    expect(await rowsOf('SELECT constraint_name FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE()')).toEqual([]);
  });

  it('applies only the migrations it has not recorded, in the order of their names', async () => {
    await migrate(DATABASE_URL);
    try {
      await withFolder(
        { '0003_later.sql': 'CREATE TABLE migrate_probe_later (a INT);', '0002_probe.sql': 'CREATE TABLE migrate_probe (a INT); -- a second statement:\nINSERT INTO migrate_probe VALUES (1);' },
        async (folder) => {
          expect(await migrate(DATABASE_URL, folder)).toEqual({ ok: true, value: ['0002_probe', '0003_later'] });
          expect(await migrate(DATABASE_URL, folder)).toEqual({ ok: true, value: [] });
          expect(await rowsOf('SELECT a FROM migrate_probe')).toEqual([{ a: 1 }]);
          expect(await appliedVersions()).toEqual(['0001_init', '0002_probe', '0003_later']);
        },
      );
    } finally {
      await sql.query('DROP TABLE IF EXISTS migrate_probe, migrate_probe_later');
      await sql.query("DELETE FROM schema_migrations WHERE version IN ('0002_probe', '0003_later')");
    }
  });

  it('answers STORE_UNAVAILABLE for a migration that fails, and does not record it', async () => {
    await migrate(DATABASE_URL);

    await withFolder({ '0002_broken.sql': 'CREATE TABL nothing (a INT);' }, async (folder) => {
      const result = await migrate(DATABASE_URL, folder);

      expect(result).toMatchObject({ ok: false, err: { code: 'STORE_UNAVAILABLE' } });
      expect(result.ok ? '' : result.err.detail).toContain('0002_broken');
      expect(await appliedVersions()).toEqual(['0001_init']);
    });
  });

  it('answers STORE_UNAVAILABLE when the database cannot be reached, or the migrations cannot be read', async () => {
    expect(await migrate(UNREACHABLE_URL)).toMatchObject({ ok: false, err: { code: 'STORE_UNAVAILABLE' } });
    expect(await migrate('not a url at all')).toMatchObject({ ok: false, err: { code: 'STORE_UNAVAILABLE' } });
    expect(await migrate(DATABASE_URL, join(tmpdir(), 'freshrescue-no-such-folder'))).toMatchObject({ ok: false, err: { code: 'STORE_UNAVAILABLE' } });
  });
});
