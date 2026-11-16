import { beforeEach, describe, expect, it } from 'vitest';
import type { StoreTable, WriteOp, WriteOps } from '@freshrescue/contract-changeset';
import type { Batch, Counters, FoodCategory, FoodType, RawStore, Recipe, RecipeCategory, RecipeIngredient, Settings } from '@freshrescue/contract-entities';
import type { StoreReadPort, StoreWritePort } from '../ports';

// One suite that any store must pass (plan, phase 6): it runs on the memory store now and on MySQL in
// phase 7. It states what the two ports promise, and nothing that only one store does, so every row below
// is written with ascending ids, which is the order in which both stores give the rows back.

type Store = { readonly read: StoreReadPort; readonly write: StoreWritePort };

const OTHER: FoodCategory = { id: 1, name: 'Other', parentId: null, isSystem: true, customThresholdDays: null };
const MEAT: FoodCategory = { id: 3, name: 'Meat', parentId: null, isSystem: false, customThresholdDays: 5 };
const POULTRY: FoodCategory = { id: 4, name: 'Poultry', parentId: 3, isSystem: false, customThresholdDays: null };
const CUISINE_OTHER: RecipeCategory = { id: 2, name: 'Other', isSystem: true };
const CHICKEN: FoodType = { id: 10, name: 'Chicken', categoryId: 4, unit: 'grams', customThresholdDays: 2 };
const RICE: FoodType = { id: 11, name: 'Rice', categoryId: 1, unit: 'grams', customThresholdDays: null };
const BATCH: Batch = { id: 20, foodTypeId: 10, quantity: 300_000, inboundDate: '2026-10-01', expirationDate: '2026-10-04', createdSeq: 1 };
const LARGEST: Batch = { id: 21, foodTypeId: 11, quantity: 500_000_000, inboundDate: '2026-10-02', expirationDate: '2026-12-31', createdSeq: 2 };
const RECIPE: Recipe = { id: 30, name: 'Chicken Rice', recipeCategoryId: 2 };
const OTHER_RECIPE: Recipe = { id: 31, name: 'Plain Rice', recipeCategoryId: 2 };
const ROW_CHICKEN: RecipeIngredient = { recipeId: 30, foodTypeId: 10, requiredQuantity: 250_000, requiredUnit: 'grams', deletedFoodTypeName: null };
const ROW_RICE: RecipeIngredient = { recipeId: 30, foodTypeId: 11, requiredQuantity: 300_000, requiredUnit: 'grams', deletedFoodTypeName: null };
const ROW_PLAIN: RecipeIngredient = { recipeId: 31, foodTypeId: 11, requiredQuantity: 100_000, requiredUnit: 'grams', deletedFoodTypeName: null };
const SETTINGS: Settings = { simulatedToday: null, bootstrapped: true };
const COUNTERS: Counters = { nextId: 40, nextSeq: 3 };

const put = (table: StoreTable, row: unknown): WriteOp => ({ op: 'put', table, row }) as WriteOp;
const remove = (table: StoreTable, key: Readonly<Record<string, unknown>>): WriteOp => ({ op: 'delete', table, key }) as WriteOp;

/** Every table holds at least one row, so a single write shows that all eight are stored and read back. */
const EVERYTHING: WriteOps = [
  put('foodCategories', OTHER),
  put('foodCategories', MEAT),
  put('foodCategories', POULTRY),
  put('recipeCategories', CUISINE_OTHER),
  put('foodTypes', CHICKEN),
  put('foodTypes', RICE),
  put('batches', BATCH),
  put('batches', LARGEST),
  put('recipes', RECIPE),
  put('recipes', OTHER_RECIPE),
  put('recipeIngredients', ROW_CHICKEN),
  put('recipeIngredients', ROW_RICE),
  put('recipeIngredients', ROW_PLAIN),
  put('settings', SETTINGS),
  put('counters', COUNTERS),
];

async function written(store: Store, ops: WriteOps): Promise<void> {
  const result = await store.write.apply(ops);
  if (!result.ok) expect.unreachable(`the write failed: ${result.err.code} ${result.err.detail}`);
}

async function stored(store: Store): Promise<RawStore | null> {
  const result = await store.read.read();
  return result.ok ? result.value : expect.unreachable(`the read failed: ${result.err.code} ${result.err.detail}`);
}

/** The rows of one table in the stored document, which has to be there. */
async function listOf(store: Store, table: string): Promise<unknown[]> {
  const document = await stored(store);
  const list = document?.[table];
  return Array.isArray(list) ? list : expect.unreachable(`the document has no list "${table}"`);
}

/**
 * Registers the conformance suite for one store. `makeStore` is called before each test and hands back
 * the two ports of an empty store, so no test depends on what another left behind.
 */
export function storeConformance(label: string, makeStore: () => Promise<Store>): void {
  describe(`${label}: the store conformance suite`, () => {
    let store: Store;

    beforeEach(async () => {
      store = await makeStore();
    });

    describe('reading', () => {
      it('reads as nothing when nothing was ever written', async () => {
        expect(await stored(store)).toBeNull();
      });

      it('reads back what was written, unchanged, from all eight tables', async () => {
        await written(store, EVERYTHING);

        expect(await stored(store)).toEqual({
          foodCategories: [OTHER, MEAT, POULTRY],
          foodTypes: [CHICKEN, RICE],
          batches: [BATCH, LARGEST],
          recipeCategories: [CUISINE_OTHER],
          recipes: [RECIPE, OTHER_RECIPE],
          recipeIngredients: [ROW_CHICKEN, ROW_RICE, ROW_PLAIN],
          settings: SETTINGS,
          counters: COUNTERS,
        });
      });

      it('keeps the type of every value: dates as text, booleans as booleans, null as null, the largest quantity as an integer', async () => {
        await written(store, EVERYTHING);

        const [other, meat] = (await listOf(store, 'foodCategories')) as FoodCategory[];
        const [batch, largest] = (await listOf(store, 'batches')) as Batch[];
        expect(other?.isSystem).toBe(true);
        expect(meat?.isSystem).toBe(false);
        expect(other?.customThresholdDays).toBeNull();
        expect(meat?.customThresholdDays).toBe(5);
        expect(batch?.inboundDate).toBe('2026-10-01');
        expect(typeof batch?.expirationDate).toBe('string');
        expect(largest?.quantity).toBe(500_000_000);
        expect(Number.isInteger(largest?.quantity)).toBe(true);
        expect(((await stored(store)) ?? {}).settings).toEqual({ simulatedToday: null, bootstrapped: true });
      });

      it('hands out copies: changing what a read returned does not change the store', async () => {
        await written(store, EVERYTHING);
        const document = (await stored(store)) as Record<string, { quantity?: number }[]>;

        document.foodCategories?.push({});
        const [firstBatch] = document.batches ?? [];
        expect(firstBatch).toBeDefined();
        if (firstBatch !== undefined) firstBatch.quantity = 1;

        expect(await listOf(store, 'foodCategories')).toEqual([OTHER, MEAT, POULTRY]);
        expect(await listOf(store, 'batches')).toEqual([BATCH, LARGEST]);
      });
    });

    describe('puts', () => {
      it('adds a row with a new key at the end of its table', async () => {
        await written(store, [put('foodTypes', CHICKEN)]);
        await written(store, [put('foodTypes', RICE)]);

        expect(await listOf(store, 'foodTypes')).toEqual([CHICKEN, RICE]);
      });

      it('replaces the row with the same key where it stands, and adds no second row', async () => {
        await written(store, [put('foodTypes', CHICKEN), put('foodTypes', RICE)]);

        await written(store, [put('foodTypes', { ...CHICKEN, name: 'Hen', unit: 'kg' })]);

        expect(await listOf(store, 'foodTypes')).toEqual([{ ...CHICKEN, name: 'Hen', unit: 'kg' }, RICE]);
      });

      it('names a row of recipeIngredients by its recipe and its Food Type together', async () => {
        await written(store, [put('recipeIngredients', ROW_CHICKEN), put('recipeIngredients', ROW_RICE)]);

        await written(store, [put('recipeIngredients', { ...ROW_RICE, requiredQuantity: 450_000 })]);

        expect(await listOf(store, 'recipeIngredients')).toEqual([ROW_CHICKEN, { ...ROW_RICE, requiredQuantity: 450_000 }]);
      });

      it('keeps one row in settings and one in counters: a second put replaces the first', async () => {
        await written(store, [put('settings', SETTINGS), put('counters', COUNTERS)]);

        await written(store, [put('settings', { simulatedToday: '2026-10-05', bootstrapped: true }), put('counters', { nextId: 50, nextSeq: 9 })]);

        const document = await stored(store);
        expect(document?.settings).toEqual({ simulatedToday: '2026-10-05', bootstrapped: true });
        expect(document?.counters).toEqual({ nextId: 50, nextSeq: 9 });
      });
    });

    describe('deletes', () => {
      it('removes the row that the whole key names, and only that row', async () => {
        await written(store, [put('batches', BATCH), put('batches', LARGEST)]);

        await written(store, [remove('batches', { id: 20 })]);

        expect(await listOf(store, 'batches')).toEqual([LARGEST]);
      });

      it('removes the row that a whole key names, a recipe and a Food Type together, and no other row of that recipe or of that Food Type', async () => {
        await written(store, [put('recipeIngredients', ROW_CHICKEN), put('recipeIngredients', ROW_RICE), put('recipeIngredients', ROW_PLAIN)]);

        // ROW_RICE is the row of recipe 30 for Food Type 11: ROW_CHICKEN has the recipe and ROW_PLAIN has the Food Type
        await written(store, [remove('recipeIngredients', { recipeId: 30, foodTypeId: 11 })]);

        expect(await listOf(store, 'recipeIngredients')).toEqual([ROW_CHICKEN, ROW_PLAIN]);
      });

      it('removes every row that a partial key matches: the rows of one recipe, or of one Food Type', async () => {
        await written(store, [put('recipeIngredients', ROW_CHICKEN), put('recipeIngredients', ROW_RICE), put('recipeIngredients', ROW_PLAIN)]);

        await written(store, [remove('recipeIngredients', { recipeId: 30 })]);
        expect(await listOf(store, 'recipeIngredients')).toEqual([ROW_PLAIN]);

        await written(store, [put('recipeIngredients', ROW_CHICKEN), put('recipeIngredients', ROW_RICE)]);
        await written(store, [remove('recipeIngredients', { foodTypeId: 11 })]);
        expect(await listOf(store, 'recipeIngredients')).toEqual([ROW_CHICKEN]);
      });

      it('removes every row of its table when the key names no field, which is how the one row of settings or counters is deleted', async () => {
        await written(store, EVERYTHING);

        await written(store, [remove('settings', {}), remove('counters', {}), remove('batches', {})]);

        const document = await stored(store);
        expect(document?.settings).toBeUndefined();
        expect(document?.counters).toBeUndefined();
        expect(document?.batches).toEqual([]);
        expect(document?.foodTypes).toEqual([CHICKEN, RICE]);
      });

      it('is no error when no row matches, and changes nothing', async () => {
        await written(store, [put('batches', BATCH)]);

        await written(store, [remove('batches', { id: 999 }), remove('recipeIngredients', { recipeId: 999 })]);

        expect(await listOf(store, 'batches')).toEqual([BATCH]);
      });

      it('takes the last of a table out of the store, and a store with no rows at all reads as nothing again', async () => {
        await written(store, [put('batches', BATCH)]);

        await written(store, [remove('batches', { id: 20 })]);

        expect(await stored(store)).toBeNull();
      });
    });

    describe('one write', () => {
      it('applies its operations in order: a put and then a delete of the same row leaves nothing, and the reverse leaves the row', async () => {
        await written(store, [put('batches', BATCH), remove('batches', { id: 20 }), put('batches', LARGEST)]);
        expect(await listOf(store, 'batches')).toEqual([LARGEST]);

        await written(store, [remove('batches', { id: 21 }), put('batches', LARGEST)]);
        expect(await listOf(store, 'batches')).toEqual([LARGEST]);
      });

      it('replaces the rows of a recipe in one write: delete them by the recipe, then put the new ones', async () => {
        await written(store, [put('recipeIngredients', ROW_CHICKEN), put('recipeIngredients', ROW_RICE), put('recipeIngredients', ROW_PLAIN)]);

        await written(store, [remove('recipeIngredients', { recipeId: 30 }), put('recipeIngredients', { ...ROW_CHICKEN, requiredQuantity: 1_000 })]);

        expect(await listOf(store, 'recipeIngredients')).toEqual([ROW_PLAIN, { ...ROW_CHICKEN, requiredQuantity: 1_000 }]);
      });

      it('applies none of it when an operation fails: STORE_WRITE_FAILED, and the first operation is undone', async () => {
        await written(store, [put('batches', BATCH)]);
        const before = await stored(store);

        const result = await store.write.apply([put('batches', { ...LARGEST, id: 22 }), put('batches', { ...LARGEST, id: 23, quantity: 0 })]);

        expect(result).toMatchObject({ ok: false, err: { code: 'STORE_WRITE_FAILED' } });
        expect(await stored(store)).toEqual(before);
      });

      it('undoes a delete and a put that came before the failing operation as well', async () => {
        await written(store, [put('batches', BATCH), put('foodTypes', CHICKEN)]);
        const before = await stored(store);

        const result = await store.write.apply([
          remove('batches', { id: 20 }),
          put('foodTypes', { ...CHICKEN, name: 'Hen' }),
          put('batches', { ...LARGEST, quantity: 500_000_001 }),
        ]);

        expect(result).toMatchObject({ ok: false, err: { code: 'STORE_WRITE_FAILED' } });
        expect(await stored(store)).toEqual(before);
      });

      it('leaves an empty store empty when its only write fails', async () => {
        const result = await store.write.apply([put('foodCategories', OTHER), put('batches', { ...BATCH, quantity: 0 })]);

        expect(result).toMatchObject({ ok: false, err: { code: 'STORE_WRITE_FAILED' } });
        expect(await stored(store)).toBeNull();
      });

      it('goes on working after a failed write', async () => {
        await store.write.apply([put('batches', { ...BATCH, quantity: 0 })]);

        await written(store, [put('batches', BATCH)]);

        expect(await listOf(store, 'batches')).toEqual([BATCH]);
      });
    });

    describe('the quantity check: a quantity is a whole number from 1 to 500,000,000 thousandths', () => {
      it('accepts both ends', async () => {
        await written(store, [put('batches', { ...BATCH, id: 20, quantity: 1 }), put('batches', { ...BATCH, id: 21, quantity: 500_000_000 })]);

        expect(((await listOf(store, 'batches')) as Batch[]).map((batch) => batch.quantity)).toEqual([1, 500_000_000]);
      });

      it('refuses 0, a negative quantity and one above the largest', async () => {
        for (const quantity of [0, -1, 500_000_001]) {
          const result = await store.write.apply([put('batches', { ...BATCH, quantity })]);

          expect(result, `a batch of ${quantity}`).toMatchObject({ ok: false, err: { code: 'STORE_WRITE_FAILED' } });
        }
        expect(await stored(store)).toBeNull();
      });
    });
  });
}
