import mysql from 'mysql2/promise';
import type { Connection, Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { StoreTable, WriteOp, WriteOps } from '@freshrescue/contract-changeset';
import type { Batch, FoodType, RawStore, RecipeIngredient } from '@freshrescue/contract-entities';
import { storeConformance } from './conformance/storeConformance';
import { migrate } from './mysql/migrate';
import { closeMysqlPool, createMysqlPool } from './mysql/pool';
import { TABLES } from './mysql/tables';
import { createStoreReadGateway } from './storeReadGateway';
import { createStoreWriteGateway } from './storeWriteGateway';

// The MySQL store on the real test database (plan, phase 7, row 2). It must pass the same conformance
// suite as the memory store; the tests after it cover what is MySQL's own: the transaction, the upsert,
// the values a column could not give back unchanged, and a store that cannot be reached.

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

async function emptyTables(): Promise<void> {
  for (const table of Object.values(TABLES)) await sql.query(`DELETE FROM ${mysql.escapeId(table.name)}`);
}

async function rowsOf(query: string): Promise<RowDataPacket[]> {
  const [rows] = await sql.query<RowDataPacket[]>(query);
  return rows;
}

storeConformance('MySQL (StoreReadGateway and StoreWriteGateway)', async () => {
  await emptyTables();
  return { read: createStoreReadGateway(pool), write: createStoreWriteGateway(pool) };
});

const put = (table: StoreTable, row: unknown): WriteOp => ({ op: 'put', table, row }) as WriteOp;
const remove = (table: StoreTable, key: Readonly<Record<string, unknown>>): WriteOp => ({ op: 'delete', table, key }) as WriteOp;

const RICE: FoodType = { id: 11, name: 'Rice', categoryId: 1, unit: 'grams', customThresholdDays: null };
const BATCH: Batch = { id: 20, foodTypeId: 11, quantity: 300_000, inboundDate: '2026-10-01', expirationDate: '2026-10-04', createdSeq: 1 };
const ROW_A: RecipeIngredient = { recipeId: 30, foodTypeId: 10, requiredQuantity: 250_000, requiredUnit: 'grams', deletedFoodTypeName: null };
const ROW_B: RecipeIngredient = { recipeId: 30, foodTypeId: 11, requiredQuantity: 300_000, requiredUnit: 'grams', deletedFoodTypeName: null };

describe('createStoreWriteGateway on MySQL', () => {
  const write = (ops: WriteOps) => createStoreWriteGateway(pool).apply(ops);
  const read = async (): Promise<RawStore | null> => {
    const result = await createStoreReadGateway(pool).read();
    return result.ok ? result.value : expect.unreachable(`the read failed: ${result.err.detail}`);
  };

  beforeEach(emptyTables);

  it('undoes the first operation when the second violates the CHECK: STORE_WRITE_FAILED names it, and the first row is not in the table', async () => {
    const result = await write([put('batches', { ...BATCH, id: 22 }), put('batches', { ...BATCH, id: 23, quantity: 0 })]);

    expect(result).toMatchObject({ ok: false, err: { code: 'STORE_WRITE_FAILED' } });
    expect(result.ok ? '' : result.err.detail).toMatch(/operation 2 of 2 failed.*batch_quantity_range/);
    expect(await rowsOf('SELECT id FROM batch')).toEqual([]);
  });

  it('writes a put as an upsert: a second put of a key updates that row and adds none, and an ingredient row keeps its place', async () => {
    expect(await write([put('foodTypes', RICE), put('recipeIngredients', ROW_A), put('recipeIngredients', ROW_B)])).toEqual({ ok: true, value: {} });
    const seqs = await rowsOf('SELECT seq, food_type_id AS foodTypeId FROM recipe_ingredient ORDER BY seq');

    await write([put('foodTypes', { ...RICE, name: 'Brown Rice' }), put('recipeIngredients', { ...ROW_A, requiredQuantity: 1, deletedFoodTypeName: 'Beef' })]);

    expect(await rowsOf('SELECT seq, food_type_id AS foodTypeId FROM recipe_ingredient ORDER BY seq')).toEqual(seqs);
    expect(await rowsOf('SELECT id, name FROM food_type')).toEqual([{ id: 11, name: 'Brown Rice' }]);
    expect((await read())?.recipeIngredients).toEqual([{ ...ROW_A, requiredQuantity: 1, deletedFoodTypeName: 'Beef' }, ROW_B]);
  });

  it('refuses, before anything is written, a value that its column would not give back as it is', async () => {
    const cases: [string, WriteOp][] = [
      ['batches.quantity', put('batches', { ...BATCH, quantity: 1.5 })],
      ['batches.inboundDate', put('batches', { ...BATCH, inboundDate: '2026-1-5' })],
      ['batches.expirationDate', put('batches', { ...BATCH, expirationDate: '2026-10-04T00:00:00' })],
      ['foodCategories.isSystem', put('foodCategories', { id: 3, name: 'Meat', parentId: null, isSystem: 1, customThresholdDays: null })],
      ['foodTypes.name', put('foodTypes', { ...RICE, name: undefined })],
      ['foodTypes.categoryId', put('foodTypes', { ...RICE, categoryId: null })],
      ['foodTypes.customThresholdDays', put('foodTypes', { ...RICE, customThresholdDays: 2 ** 53 })],
      ['recipeIngredients.deletedFoodTypeName', put('recipeIngredients', { ...ROW_A, deletedFoodTypeName: 5 })],
      ['settings.bootstrapped', put('settings', { simulatedToday: null, bootstrapped: 'yes' })],
      ['batches.id', remove('batches', { id: '20' })],
    ];
    for (const [field, op] of cases) {
      const result = await write([put('foodTypes', RICE), op]);

      expect(result, field).toMatchObject({ ok: false, err: { code: 'STORE_WRITE_FAILED' } });
      expect(result.ok ? '' : result.err.detail, field).toContain(`operation 2 of 2 cannot be written, so nothing was: ${field} cannot hold`);
    }
    expect(await read()).toBeNull();
  });

  it('refuses an operation that names no table of the store, no operation, a field its table does not have, or a key or a row that is not an object', async () => {
    const cases: unknown[] = [
      { op: 'put', table: 'shoppingList', row: {} },
      { op: 'put', table: 'toString', row: {} },
      { op: 'upsert', table: 'batches', row: BATCH },
      { op: 'delete', table: 'batches', key: { colour: 'red' } },
      { op: 'delete', table: 'batches', key: { id: undefined } },
      { op: 'delete', table: 'batches', key: null },
      { op: 'put', table: 'batches', row: 'a batch' },
      null,
    ];
    for (const op of cases) {
      const result = await write([put('foodTypes', RICE), op as WriteOp]);

      expect(result, JSON.stringify(op)).toMatchObject({ ok: false, err: { code: 'STORE_WRITE_FAILED' } });
    }
    expect(await read()).toBeNull();
  });

  it('deletes by a key value of null as the memory store does: it matches the rows that hold null', async () => {
    await write([
      put('foodCategories', { id: 3, name: 'Meat', parentId: null, isSystem: false, customThresholdDays: null }),
      put('foodCategories', { id: 4, name: 'Poultry', parentId: 3, isSystem: false, customThresholdDays: null }),
    ]);

    await write([remove('foodCategories', { parentId: null })]);

    expect(await rowsOf('SELECT id FROM food_category')).toEqual([{ id: 4 }]);
  });

  it('keeps any text as it was written: accents, emoji, quotes and backslashes, and 200 characters of four bytes each', async () => {
    const names = ['Crème brûlée 🍮', `it's "quoted" \\ and; DROP TABLE batch; --`, '🥦'.repeat(200)];
    await write(names.map((name, index) => put('foodTypes', { ...RICE, id: 40 + index, name })));

    expect(((await read())?.foodTypes as FoodType[]).map((foodType) => foodType.name)).toEqual(names);
    expect(await rowsOf('SELECT COUNT(*) AS n FROM batch')).toEqual([{ n: 0 }]);
  });

  it('answers Ok to an empty batch and writes nothing', async () => {
    expect(await write([])).toEqual({ ok: true, value: {} });
    expect(await read()).toBeNull();
  });

  it('answers STORE_WRITE_FAILED when the store cannot be reached, or its pool is closed', async () => {
    const unreachable = createMysqlPool(UNREACHABLE_URL);
    const closed = createMysqlPool(DATABASE_URL);
    if (!unreachable.ok || !closed.ok) expect.unreachable('a pool could not be made');
    await closeMysqlPool(closed.value);
    try {
      for (const target of [unreachable.value, closed.value]) {
        const result = await createStoreWriteGateway(target).apply([put('foodTypes', RICE)]);

        expect(result).toMatchObject({ ok: false, err: { code: 'STORE_WRITE_FAILED' } });
      }
    } finally {
      await closeMysqlPool(unreachable.value);
    }
    expect(await read()).toBeNull();
  });

  it('goes on writing with the pool after a write that failed', async () => {
    for (let attempt = 0; attempt < 15; attempt += 1) await write([put('batches', { ...BATCH, quantity: -1 })]);

    expect(await write([put('batches', BATCH)])).toEqual({ ok: true, value: {} });
    expect((await read())?.batches).toEqual([BATCH]);
  });
});
