import type { Batch, Counters, Recipe, RecipeIngredient, Settings } from '@freshrescue/contract-entities';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ENTITY_OP_KINDS, STORE_KEYS, STORE_TABLES } from './index';
import type { ChangeSet, EntityOp, Outcome, StoreRows, StoreTable, WriteOp, WriteOps } from './index';

describe('changeset', () => {
  it('has 14 kinds of operation: 8 puts and 6 deletes', () => {
    expectTypeOf<(typeof ENTITY_OP_KINDS)[number]>().toEqualTypeOf<EntityOp['kind']>();

    expect(ENTITY_OP_KINDS).toHaveLength(14);
    expect(new Set(ENTITY_OP_KINDS).size).toBe(14);
    expect(ENTITY_OP_KINDS.filter((kind) => kind.startsWith('put'))).toHaveLength(8);
    expect(ENTITY_OP_KINDS.filter((kind) => kind.startsWith('delete'))).toHaveLength(6);
    // the two singletons can only be replaced
    expect(ENTITY_OP_KINDS).toContain('putSettings');
    expect(ENTITY_OP_KINDS).toContain('putCounters');
    expect(ENTITY_OP_KINDS).not.toContain('deleteSettings');

    // one complete example of every kind: the compiler checks each kind against its own fields
    const examples: { [K in EntityOp['kind']]: Extract<EntityOp, { kind: K }> } = {
      putFoodCategory: { kind: 'putFoodCategory', row: { id: 3, name: 'Meat', parentId: null, isSystem: false, customThresholdDays: null } },
      deleteFoodCategory: { kind: 'deleteFoodCategory', id: 3 },
      putFoodType: { kind: 'putFoodType', row: { id: 5, name: 'Chicken', categoryId: 4, unit: 'grams', customThresholdDays: null } },
      deleteFoodType: { kind: 'deleteFoodType', id: 5 },
      putBatch: { kind: 'putBatch', row: { id: 20, foodTypeId: 5, quantity: 100_000, inboundDate: '2026-10-01', expirationDate: '2026-10-04', createdSeq: 1 } },
      deleteBatch: { kind: 'deleteBatch', id: 20 },
      putRecipeCategory: { kind: 'putRecipeCategory', row: { id: 14, name: 'Chinese Cuisine', isSystem: false } },
      deleteRecipeCategory: { kind: 'deleteRecipeCategory', id: 14 },
      putRecipe: { kind: 'putRecipe', row: { id: 12, name: 'Chicken Fried Rice', recipeCategoryId: 14 } },
      deleteRecipe: { kind: 'deleteRecipe', id: 12 },
      putIngredient: { kind: 'putIngredient', row: { recipeId: 12, foodTypeId: 5, requiredQuantity: 200_000, requiredUnit: 'grams', deletedFoodTypeName: null } },
      deleteIngredientsOfRecipe: { kind: 'deleteIngredientsOfRecipe', recipeId: 12 },
      putSettings: { kind: 'putSettings', row: { simulatedToday: null, bootstrapped: true } },
      putCounters: { kind: 'putCounters', row: { nextId: 30, nextSeq: 4 } },
    };
    expect(Object.keys(examples)).toEqual([...ENTITY_OP_KINDS]);
  });

  it('speaks to the store in eight logical tables with the field names of the entities', () => {
    expectTypeOf<StoreTable>().toEqualTypeOf<keyof StoreRows>();
    expectTypeOf<StoreRows['batches']>().toEqualTypeOf<Batch>();
    expectTypeOf<StoreRows['settings']>().toEqualTypeOf<Settings>();
    expect(STORE_TABLES).toHaveLength(8);
    expect(Object.keys(STORE_KEYS).sort()).toEqual([...STORE_TABLES].sort());
    expect(STORE_KEYS.recipeIngredients).toEqual(['recipeId', 'foodTypeId']);
    expect(STORE_KEYS.batches).toEqual(['id']);

    const batch: Batch = { id: 12, foodTypeId: 5, quantity: 500_000, inboundDate: '2026-10-01', expirationDate: '2026-10-06', createdSeq: 1 };
    const ops: WriteOps = [
      { op: 'put', table: 'batches', row: batch },
      // a partial key: every ingredient row of recipe 4
      { op: 'delete', table: 'recipeIngredients', key: { recipeId: 4 } },
    ];
    expect(ops).toHaveLength(2);

    // the compiler refuses a row that does not belong to its table, and a key with a field that it does not have
    // @ts-expect-error a food type row does not fit the batches table
    const _wrongRow: WriteOp = { op: 'put', table: 'batches', row: { id: 1, name: 'Milk', categoryId: 3, unit: 'ml', customThresholdDays: null } };
    // @ts-expect-error a batch has no field named name
    const _wrongKey: WriteOp = { op: 'delete', table: 'batches', key: { name: 'Milk' } };
    void [_wrongRow, _wrongKey];
  });

  it('rewrites the ingredient rows of a recipe as one delete followed by the new puts', () => {
    const recipe: Recipe = { id: 4, name: 'Spinach Omelette', recipeCategoryId: 2 };
    const eggs: RecipeIngredient = { recipeId: 4, foodTypeId: 6, requiredQuantity: 3_000, requiredUnit: 'pieces', deletedFoodTypeName: null };
    const milk: RecipeIngredient = { recipeId: 4, foodTypeId: 7, requiredQuantity: 50_000, requiredUnit: 'ml', deletedFoodTypeName: null };
    const counters: Counters = { nextId: 9, nextSeq: 3 };

    const rewrite: ChangeSet = {
      ops: [
        { kind: 'putRecipe', row: recipe },
        { kind: 'deleteIngredientsOfRecipe', recipeId: 4 },
        { kind: 'putIngredient', row: eggs },
        { kind: 'putIngredient', row: milk },
        { kind: 'putCounters', row: counters },
      ],
    };
    const kinds = rewrite.ops.map((op) => op.kind);

    expect(kinds.indexOf('deleteIngredientsOfRecipe')).toBeLessThan(kinds.indexOf('putIngredient'));
    expect(kinds.filter((kind) => kind === 'putIngredient')).toHaveLength(2);

    // a command answers with change sets and maybe a payload, and a query answers with a payload only
    const saved: Outcome<{ readonly recipeId: number }> = { changeSets: [rewrite], payload: { recipeId: 4 } };
    const read: Outcome<string> = { payload: 'a read model' };
    expectTypeOf<Outcome>().toEqualTypeOf<{ readonly changeSets?: readonly ChangeSet[]; readonly payload?: unknown }>();
    expect(saved.changeSets).toHaveLength(1);
    expect(read.changeSets).toBeUndefined();
  });
});
