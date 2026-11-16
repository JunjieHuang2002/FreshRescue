import { describe, expect, it } from 'vitest';
import { ENTITY_OP_KINDS } from '@freshrescue/contract-changeset';
import type { ChangeSet, EntityOp } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { buildBatch, buildFoodCategory, buildFoodType, buildIngredient, buildRecipe, buildRecipeCategory, buildSnapshot } from '../../testing/fixtures';
import { changeSetEncoder } from '../../modules/engine/changeSetEncoder';
import { snapshotParser } from '../../modules/parsing/snapshotParser';
import { changeSetApplier } from '../../modules/state/changeSetApplier';
import { storeConformance } from '../conformance/storeConformance';
import { createMemoryStore } from './memoryStore';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);

// The suite that MySQL has to pass as well (plan, phase 6, row 2): an empty store reads as nothing, what
// was written reads back unchanged, a write that fails leaves the store as it was and reports
// STORE_WRITE_FAILED, and a delete with a partial key removes every matching row.
storeConformance('memoryStore', async () => {
  const store = createMemoryStore();
  return { read: store, write: store };
});

/** Every row of a snapshot as a put, in the order of the creation: what a first write into an empty store looks like. */
function putsOf(snapshot: Snapshot): ChangeSet {
  return {
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
}

/** A store with a bit of everything: Meat and Old (food categories), Chinese and Old Cuisine, Beef and Rice, two batches, two recipes and their rows. */
const BASE = buildSnapshot({
  foodCategories: [buildFoodCategory({ id: 3, name: 'Meat', customThresholdDays: 5 }), buildFoodCategory({ id: 4, name: 'Old' })],
  recipeCategories: [buildRecipeCategory({ id: 5, name: 'Chinese Cuisine' }), buildRecipeCategory({ id: 6, name: 'Old Cuisine' })],
  foodTypes: [buildFoodType({ id: 10, name: 'Beef', categoryId: 3 }), buildFoodType({ id: 11, name: 'Rice' })],
  batches: [buildBatch({ id: 20, foodTypeId: 10 }), buildBatch({ id: 21, foodTypeId: 10 })],
  recipes: [buildRecipe({ id: 30, name: 'Beef Rice', recipeCategoryId: 5 }), buildRecipe({ id: 31, name: 'Plain Rice' })],
  recipeIngredients: [
    buildIngredient({ recipeId: 30, foodTypeId: 10 }),
    buildIngredient({ recipeId: 30, foodTypeId: 11 }),
    buildIngredient({ recipeId: 31, foodTypeId: 11 }),
  ],
});

/** One operation of every kind of the ChangeSet contract, each on a record of its own: a put that replaces, a put that adds, and a delete. */
const EVERY_KIND: ChangeSet = {
  ops: [
    { kind: 'putFoodCategory', row: { ...buildFoodCategory({ id: 3, name: 'Meats', customThresholdDays: null }) } },
    { kind: 'deleteFoodCategory', id: 4 },
    { kind: 'putRecipeCategory', row: buildRecipeCategory({ id: 5, name: 'Cantonese Cuisine' }) },
    { kind: 'deleteRecipeCategory', id: 6 },
    { kind: 'putFoodType', row: buildFoodType({ id: 10, name: 'Beef', categoryId: 3, unit: 'kg' }) },
    { kind: 'deleteFoodType', id: 11 },
    { kind: 'putBatch', row: buildBatch({ id: 20, foodTypeId: 10, quantity: 7 }) },
    { kind: 'deleteBatch', id: 21 },
    { kind: 'putBatch', row: buildBatch({ id: 22, foodTypeId: 10, quantity: 8 }) },
    { kind: 'putRecipe', row: buildRecipe({ id: 30, name: 'Beef Rice Bowl', recipeCategoryId: 5 }) },
    { kind: 'deleteRecipe', id: 31 },
    { kind: 'deleteIngredientsOfRecipe', recipeId: 30 },
    { kind: 'putIngredient', row: buildIngredient({ recipeId: 30, foodTypeId: 10, requiredQuantity: 2_000, requiredUnit: 'kg' }) },
    { kind: 'putIngredient', row: buildIngredient({ recipeId: 30, foodTypeId: 12, requiredQuantity: 3_000 }) },
    { kind: 'putSettings', row: { simulatedToday: '2026-10-05', bootstrapped: true } },
    { kind: 'putCounters', row: { nextId: 99, nextSeq: 50 } },
  ],
};

describe('createMemoryStore', () => {
  it('is a store of its own: two stores share nothing', async () => {
    const first = createMemoryStore();
    const second = createMemoryStore();

    await first.apply(changeSetEncoder(putsOf(BASE)));

    expect(await second.read()).toEqual({ ok: true, value: null });
    expect((await first.read()).ok).toBe(true);
  });

  it('keeps what a caller passed in apart from the store: changing a row after the write changes nothing', async () => {
    const store = createMemoryStore();
    const row = buildBatch({ id: 20, foodTypeId: 10 });

    await store.apply([{ op: 'put', table: 'batches', row }]);
    (row as { quantity: number }).quantity = 1;

    const document = valueOf(await store.read());
    expect(document?.batches).toEqual([buildBatch({ id: 20, foodTypeId: 10 })]);
  });

  describe('the CHECK of the real schema, which it also applies', () => {
    it('covers the required quantity of a recipe row as well as a batch quantity', async () => {
      const store = createMemoryStore();

      for (const requiredQuantity of [0, -5, 500_000_001]) {
        const result = await store.apply([{ op: 'put', table: 'recipeIngredients', row: buildIngredient({ recipeId: 30, foodTypeId: 10, requiredQuantity }) }]);

        expect(result, `a row of ${requiredQuantity}`).toMatchObject({ ok: false, err: { code: 'STORE_WRITE_FAILED' } });
      }
      expect(valueOf(await store.read())).toBeNull();
    });

    it('wants a whole number, because a quantity is a count of thousandths', async () => {
      const store = createMemoryStore();

      for (const quantity of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        const result = await store.apply([{ op: 'put', table: 'batches', row: buildBatch({ id: 20, foodTypeId: 10, quantity }) }]);

        expect(result, `a batch of ${quantity}`).toMatchObject({ ok: false, err: { code: 'STORE_WRITE_FAILED' } });
      }
    });

    it('names the table and the number in what it reports', async () => {
      const store = createMemoryStore();

      const result = await store.apply([{ op: 'put', table: 'batches', row: buildBatch({ id: 20, foodTypeId: 10, quantity: 0 }) }]);

      expect(result.ok ? '' : result.err.detail).toContain('batches.quantity is 0');
    });

    it('does not look at a table that has no CHECK: a food category row goes in whatever its fields hold', async () => {
      const store = createMemoryStore();

      const result = await store.apply([{ op: 'put', table: 'foodCategories', row: buildFoodCategory({ id: 3, name: '' }) }]);

      expect(result.ok).toBe(true);
    });
  });

  describe('a native exception is converted and returned, never thrown', () => {
    it('answers STORE_WRITE_FAILED for a row that cannot be copied, and the store is as it was', async () => {
      const store = createMemoryStore();
      await store.apply([{ op: 'put', table: 'batches', row: buildBatch({ id: 20, foodTypeId: 10 }) }]);
      const before = valueOf(await store.read());
      const uncopyable = { ...buildFoodCategory({ id: 3, name: 'Meat' }), name: () => 'a function cannot be copied' };

      const result = await store.apply([
        { op: 'put', table: 'batches', row: buildBatch({ id: 21, foodTypeId: 10 }) },
        { op: 'put', table: 'foodCategories', row: uncopyable as never },
      ]);

      expect(result).toMatchObject({ ok: false, err: { code: 'STORE_WRITE_FAILED' } });
      expect(valueOf(await store.read())).toEqual(before);
    });
  });

  describe('it holds what ChangeSetApplier computes, for every kind of operation of the ChangeSet contract', () => {
    it('has one operation of each of the 14 kinds in the case below, so a new kind fails here until it is added', () => {
      expect(new Set(EVERY_KIND.ops.map((op) => op.kind))).toEqual(new Set(ENTITY_OP_KINDS));
    });

    it('gives the snapshot that the applier gives when the encoded operations are written', async () => {
      const expected = valueOf(changeSetApplier(BASE, EVERY_KIND));
      const store = createMemoryStore();

      await store.apply(changeSetEncoder(putsOf(BASE)));
      expect(valueOf(snapshotParser(valueOf(await store.read())))).toEqual(BASE);
      await store.apply(changeSetEncoder(EVERY_KIND));

      expect(valueOf(snapshotParser(valueOf(await store.read())))).toEqual(expected);
    });

    it('keeps the rows in the order of the applier: a replaced row stays, a new row goes last, the rows of a recipe are replaced together', async () => {
      const store = createMemoryStore();
      await store.apply(changeSetEncoder(putsOf(BASE)));
      await store.apply(changeSetEncoder(EVERY_KIND));

      const snapshot = valueOf(snapshotParser(valueOf(await store.read())));

      expect(snapshot.batches.map((batch) => batch.id)).toEqual([20, 22]);
      expect(snapshot.recipeIngredients.map((row) => [row.recipeId, row.foodTypeId])).toEqual([[31, 11], [30, 10], [30, 12]]);
    });
  });
});
