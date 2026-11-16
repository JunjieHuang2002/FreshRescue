import mysql from 'mysql2/promise';
import type { Connection, Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { STORE_TABLES } from '@freshrescue/contract-changeset';
import type { ChangeSet, EntityOp } from '@freshrescue/contract-changeset';
import type { RawStore, Snapshot } from '@freshrescue/contract-entities';
import { changeSetEncoder } from '../modules/engine/changeSetEncoder';
import { snapshotParser } from '../modules/parsing/snapshotParser';
import { buildBatch, buildFoodCategory, buildFoodType, buildIngredient, buildRecipe, buildRecipeCategory, buildSnapshot } from '../testing/fixtures';
import { migrate } from './mysql/migrate';
import { closeMysqlPool, createMysqlPool } from './mysql/pool';
import { TABLES } from './mysql/tables';
import { createStoreReadGateway } from './storeReadGateway';
import { createStoreWriteGateway } from './storeWriteGateway';

// StoreReadGateway on the real MySQL test database (plan, phase 7, row 2): what it reads, in which order
// and with which types, and STORE_UNAVAILABLE when the store cannot be read.

const DATABASE_URL = process.env.DATABASE_URL ?? expect.unreachable('DATABASE_URL is not set: run this file with npm run test:db');
const UNREACHABLE_URL = 'mysql://freshrescue:wrong@127.0.0.1:1/freshrescue_test';

let pool: Pool;
let sql: Connection;

beforeAll(async () => {
  const migrated = await migrate(DATABASE_URL);
  if (!migrated.ok) expect.unreachable(`the test database cannot be migrated: ${migrated.err.detail}`);
  const made = createMysqlPool(DATABASE_URL);
  pool = made.ok ? made.value : expect.unreachable(`no pool: ${made.err.detail}`);
  sql = await mysql.createConnection({ uri: DATABASE_URL, dateStrings: true });
});

afterAll(async () => {
  await closeMysqlPool(pool);
  await sql.end();
});

beforeEach(async () => {
  for (const table of Object.values(TABLES)) await sql.query(`DELETE FROM ${mysql.escapeId(table.name)}`);
});

async function stored(target: Pool = pool): Promise<RawStore | null> {
  const result = await createStoreReadGateway(target).read();
  return result.ok ? result.value : expect.unreachable(`the read failed: ${result.err.code} ${result.err.detail}`);
}

/** One row in every table, written with SQL as MySQL itself would hold them. */
async function oneOfEach(): Promise<void> {
  await sql.query("INSERT INTO food_category VALUES (1, 'Other', NULL, 1, NULL), (3, 'Meat', NULL, 0, 5)");
  await sql.query("INSERT INTO food_type VALUES (10, 'Rice', 1, 'grams', NULL)");
  await sql.query("INSERT INTO batch VALUES (20, 10, 500000000, '2026-10-01', '2026-12-31', 1)");
  await sql.query("INSERT INTO recipe_category VALUES (2, 'Other', TRUE)");
  await sql.query("INSERT INTO recipe VALUES (30, 'Plain Rice', 2)");
  await sql.query("INSERT INTO recipe_ingredient (recipe_id, food_type_id, required_quantity, required_unit, deleted_food_type_name) VALUES (30, 10, 100000, 'grams', 'Old Rice')");
  await sql.query("INSERT INTO app_settings (simulated_today, bootstrapped) VALUES ('2026-10-05', TRUE)");
  await sql.query('INSERT INTO app_counters (next_id, next_seq) VALUES (40, 2)');
}

describe('createStoreReadGateway on MySQL', () => {
  it('reads a migrated database that holds no row as nothing, as a fresh store reads', async () => {
    expect(await stored()).toBeNull();
  });

  it('reads every table into one document, each value under the name of its entity field', async () => {
    await oneOfEach();

    expect(await stored()).toEqual({
      foodCategories: [
        { id: 1, name: 'Other', parentId: null, isSystem: true, customThresholdDays: null },
        { id: 3, name: 'Meat', parentId: null, isSystem: false, customThresholdDays: 5 },
      ],
      foodTypes: [{ id: 10, name: 'Rice', categoryId: 1, unit: 'grams', customThresholdDays: null }],
      batches: [{ id: 20, foodTypeId: 10, quantity: 500_000_000, inboundDate: '2026-10-01', expirationDate: '2026-12-31', createdSeq: 1 }],
      recipeCategories: [{ id: 2, name: 'Other', isSystem: true }],
      recipes: [{ id: 30, name: 'Plain Rice', recipeCategoryId: 2 }],
      recipeIngredients: [{ recipeId: 30, foodTypeId: 10, requiredQuantity: 100_000, requiredUnit: 'grams', deletedFoodTypeName: 'Old Rice' }],
      settings: { simulatedToday: '2026-10-05', bootstrapped: true },
      counters: { nextId: 40, nextSeq: 2 },
    });
  });

  it('gives a DATE as its YYYY-MM-DD text, a boolean as a boolean, NULL as null, and the largest quantity, 500,000,000, as an integer', async () => {
    await oneOfEach();
    const document = (await stored()) as Snapshot;

    const [batch] = document.batches;
    expect(batch?.inboundDate).toBe('2026-10-01');
    expect(typeof batch?.expirationDate).toBe('string');
    expect(batch?.quantity).toBe(500_000_000);
    expect(Number.isInteger(batch?.quantity)).toBe(true);
    expect(document.foodCategories.map((category) => category.isSystem)).toEqual([true, false]);
    expect(document.foodTypes[0]?.customThresholdDays).toBeNull();
    expect(document.settings).toEqual({ simulatedToday: '2026-10-05', bootstrapped: true });
  });

  it('gives the rows in the order they were created, whatever order they were stored in: ids ascending, and ingredient rows as first written', async () => {
    await sql.query("INSERT INTO food_type VALUES (12, 'Egg', 1, 'pieces', NULL), (10, 'Rice', 1, 'grams', NULL), (11, 'Milk', 1, 'ml', NULL)");
    await sql.query(
      "INSERT INTO recipe_ingredient (recipe_id, food_type_id, required_quantity, required_unit) VALUES (31, 12, 1000, 'pieces'), (30, 11, 1000, 'ml'), (30, 10, 1000, 'grams')",
    );

    const document = (await stored()) as Snapshot;

    expect(document.foodTypes.map((foodType) => foodType.id)).toEqual([10, 11, 12]);
    expect(document.recipeIngredients.map((row) => [row.recipeId, row.foodTypeId])).toEqual([
      [31, 12],
      [30, 11],
      [30, 10],
    ]);
  });

  it('leaves settings and counters out until they are written, as the memory store does', async () => {
    await sql.query("INSERT INTO food_type VALUES (10, 'Rice', 1, 'grams', NULL)");

    const document = await stored();

    expect(Object.keys(document ?? {}).sort()).toEqual(['batches', 'foodCategories', 'foodTypes', 'recipeCategories', 'recipeIngredients', 'recipes']);
  });

  it('hands on a value that no entity can have, so that SnapshotParser refuses it: a boolean column that holds 2 is not made true', async () => {
    await oneOfEach();
    await sql.query('UPDATE app_settings SET bootstrapped = 2');

    const document = await stored();

    expect((document?.settings as Record<string, unknown>).bootstrapped).toBe(2);
    expect(snapshotParser(document)).toMatchObject({ ok: false, err: { code: 'SCHEMA_MISMATCH' } });
  });

  it('reads back, through SnapshotParser, the snapshot that StoreWriteGateway wrote', async () => {
    const snapshot = buildSnapshot({
      foodCategories: [buildFoodCategory({ id: 3, name: 'Meat', customThresholdDays: 5 }), buildFoodCategory({ id: 4, name: 'Poultry', parentId: 3 })],
      recipeCategories: [buildRecipeCategory({ id: 5, name: 'Chinese Cuisine' })],
      foodTypes: [buildFoodType({ id: 10, name: 'Chicken', categoryId: 4, customThresholdDays: 2 }), buildFoodType({ id: 11, name: 'Rice' })],
      batches: [buildBatch({ id: 20, foodTypeId: 10 }), buildBatch({ id: 21, foodTypeId: 11, quantity: 1 })],
      recipes: [buildRecipe({ id: 30, name: 'Chicken Rice', recipeCategoryId: 5 })],
      recipeIngredients: [buildIngredient({ recipeId: 30, foodTypeId: 10 }), buildIngredient({ recipeId: 30, foodTypeId: 11, deletedFoodTypeName: 'Rice' })],
      settings: { simulatedToday: '2026-11-12', bootstrapped: true },
    });
    const everything: ChangeSet = {
      ops: [
        ...snapshot.foodCategories.map((row): EntityOp => ({ kind: 'putFoodCategory', row })),
        ...snapshot.recipeCategories.map((row): EntityOp => ({ kind: 'putRecipeCategory', row })),
        ...snapshot.foodTypes.map((row): EntityOp => ({ kind: 'putFoodType', row })),
        ...snapshot.batches.map((row): EntityOp => ({ kind: 'putBatch', row })),
        ...snapshot.recipes.map((row): EntityOp => ({ kind: 'putRecipe', row })),
        ...snapshot.recipeIngredients.map((row): EntityOp => ({ kind: 'putIngredient', row })),
        { kind: 'putSettings', row: snapshot.settings },
        { kind: 'putCounters', row: snapshot.counters },
      ],
    };
    expect(await createStoreWriteGateway(pool).apply(changeSetEncoder(everything))).toEqual({ ok: true, value: {} });

    expect(snapshotParser(await stored())).toEqual({ ok: true, value: snapshot });
  });

  it('answers STORE_UNAVAILABLE when the store cannot be reached, or its pool is closed', async () => {
    const unreachable = createMysqlPool(UNREACHABLE_URL);
    const closed = createMysqlPool(DATABASE_URL);
    if (!unreachable.ok || !closed.ok) expect.unreachable('a pool could not be made');
    await closeMysqlPool(closed.value);
    try {
      for (const target of [unreachable.value, closed.value]) {
        expect(await createStoreReadGateway(target).read()).toMatchObject({ ok: false, err: { code: 'STORE_UNAVAILABLE' } });
      }
    } finally {
      await closeMysqlPool(unreachable.value);
    }
  });

  it('answers STORE_UNAVAILABLE when a table is missing, and reads again once it is back', async () => {
    await oneOfEach();
    await sql.query('RENAME TABLE batch TO batch_away');
    try {
      const result = await createStoreReadGateway(pool).read();

      expect(result).toMatchObject({ ok: false, err: { code: 'STORE_UNAVAILABLE' } });
      expect(result.ok ? '' : result.err.detail).toMatch(/batch/);
    } finally {
      await sql.query('RENAME TABLE batch_away TO batch');
    }
    expect((await stored())?.batches).toHaveLength(1);
  });

  it('does not let a write that commits during a read into that read: the document is the store at one moment', async () => {
    await oneOfEach();
    // Hold the read after it has begun and before its first SELECT, by locking the first table it reads,
    // then commit a change to a table it reads later. Begun WITH CONSISTENT SNAPSHOT, the read still
    // sees the store as it was when it began.
    expect(STORE_TABLES.slice(0, 2).map((table) => TABLES[table].name)).toEqual(['food_category', 'food_type']);
    const holder = await mysql.createConnection({ uri: DATABASE_URL });
    try {
      await holder.query('LOCK TABLES food_category WRITE');
      const reading = createStoreReadGateway(pool).read();
      await waitForAThreadIn('Waiting for table metadata lock');
      await sql.query("UPDATE food_type SET name = 'Wild Rice' WHERE id = 10");
      await holder.query('UNLOCK TABLES');

      const result = await reading;

      expect(result.ok ? (result.value as Snapshot | null)?.foodTypes[0]?.name : result.err.code).toBe('Rice');
    } finally {
      await holder.end();
    }
    expect(((await stored()) as Snapshot | null)?.foodTypes[0]?.name).toBe('Wild Rice');
  });
});

/** Waits until one of this user's MySQL threads is in the given state, for up to five seconds. */
async function waitForAThreadIn(state: string): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const [rows] = await sql.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM information_schema.processlist WHERE state = ?', [state]);
    if (Number(rows[0]?.n) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect.unreachable(`no MySQL thread reached the state "${state}"`);
}
