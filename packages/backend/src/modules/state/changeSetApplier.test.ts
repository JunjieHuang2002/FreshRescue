import { describe, expect, expectTypeOf, it } from 'vitest';
import { ENTITY_OP_KINDS } from '@freshrescue/contract-changeset';
import type { EntityOp } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import {
  buildBatch,
  buildFoodCategory,
  buildFoodType,
  buildIngredient,
  buildRecipe,
  buildRecipeCategory,
  buildSnapshot,
} from '../../testing/fixtures';
import { changeSetApplier } from './changeSetApplier';

/** A snapshot with something in every list: two categories, two Food Types, two batches, a cuisine, two recipes and three ingredient rows. */
const base = buildSnapshot({
  foodCategories: [buildFoodCategory({ id: 3, name: 'Meat' }), buildFoodCategory({ id: 4, name: 'Poultry', parentId: 3 })],
  foodTypes: [buildFoodType({ id: 10, name: 'Beef', categoryId: 3 }), buildFoodType({ id: 11, name: 'Milk', unit: 'ml' })],
  batches: [buildBatch({ id: 20, foodTypeId: 10 }), buildBatch({ id: 21, foodTypeId: 11 })],
  recipeCategories: [buildRecipeCategory({ id: 5, name: 'French Cuisine' })],
  recipes: [buildRecipe({ id: 30, name: 'Stew', recipeCategoryId: 5 }), buildRecipe({ id: 31, name: 'Soup' })],
  recipeIngredients: [
    buildIngredient({ recipeId: 30, foodTypeId: 10, requiredQuantity: 300_000 }),
    buildIngredient({ recipeId: 30, foodTypeId: 11, requiredQuantity: 100_000, requiredUnit: 'ml' }),
    buildIngredient({ recipeId: 31, foodTypeId: 11, requiredQuantity: 50_000, requiredUnit: 'ml' }),
  ],
});

/** Freezes a value all the way down, so that any attempt to change it throws instead of passing unnoticed. */
function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) freeze(inner);
  }
  return value;
}
freeze(base);

const run = (ops: readonly EntityOp[], from: Snapshot = base): Result<Snapshot, DomainError> => changeSetApplier(from, { ops });
const next = (ops: readonly EntityOp[], from: Snapshot = base): Snapshot => {
  const result = run(ops, from);
  return result.ok ? result.value : expect.unreachable(`expected the ChangeSet to apply, but it failed with ${result.err.code}: ${result.err.detail}`);
};
const codeOf = (ops: readonly EntityOp[], from: Snapshot = base): string => {
  const result = run(ops, from);
  return result.ok ? 'ok' : result.err.code;
};

type Table = {
  readonly name: string;
  readonly list: (snapshot: Snapshot) => readonly { readonly id: number }[];
  readonly insert: EntityOp;
  readonly replace: EntityOp;
  readonly remove: EntityOp;
  /** The id that `insert` adds, the id that `replace` and `remove` act on, and what the replaced row must read as. */
  readonly newId: number;
  readonly oldId: number;
};

const TABLES: readonly Table[] = [
  {
    name: 'food categories',
    list: (s) => s.foodCategories,
    insert: { kind: 'putFoodCategory', row: buildFoodCategory({ id: 40, name: 'Fish' }) },
    replace: { kind: 'putFoodCategory', row: buildFoodCategory({ id: 3, name: 'Meats', customThresholdDays: 5 }) },
    remove: { kind: 'deleteFoodCategory', id: 3 },
    newId: 40,
    oldId: 3,
  },
  {
    name: 'Food Types',
    list: (s) => s.foodTypes,
    insert: { kind: 'putFoodType', row: buildFoodType({ id: 40, name: 'Egg', unit: 'pieces' }) },
    replace: { kind: 'putFoodType', row: buildFoodType({ id: 10, name: 'Beef', categoryId: 3, unit: 'kg' }) },
    remove: { kind: 'deleteFoodType', id: 10 },
    newId: 40,
    oldId: 10,
  },
  {
    name: 'batches',
    list: (s) => s.batches,
    insert: { kind: 'putBatch', row: buildBatch({ id: 40, foodTypeId: 10, quantity: 7000 }) },
    replace: { kind: 'putBatch', row: buildBatch({ id: 20, foodTypeId: 10, quantity: 250 }) },
    remove: { kind: 'deleteBatch', id: 20 },
    newId: 40,
    oldId: 20,
  },
  {
    name: 'cuisines',
    list: (s) => s.recipeCategories,
    insert: { kind: 'putRecipeCategory', row: buildRecipeCategory({ id: 40, name: 'Vietnamese Cuisine' }) },
    replace: { kind: 'putRecipeCategory', row: buildRecipeCategory({ id: 5, name: 'Cuisine Française' }) },
    remove: { kind: 'deleteRecipeCategory', id: 5 },
    newId: 40,
    oldId: 5,
  },
  {
    name: 'recipes',
    list: (s) => s.recipes,
    insert: { kind: 'putRecipe', row: buildRecipe({ id: 40, name: 'Omelette' }) },
    replace: { kind: 'putRecipe', row: buildRecipe({ id: 30, name: 'Beef Stew', recipeCategoryId: 5 }) },
    remove: { kind: 'deleteRecipe', id: 30 },
    newId: 40,
    oldId: 30,
  },
];

describe('BS-01 ChangeSetApplier', () => {
  describe.each(TABLES)('the $name list', ({ list, insert, replace, remove, newId, oldId }) => {
    const ids = (snapshot: Snapshot) => list(snapshot).map((row) => row.id);

    it('adds a new record at the end, which keeps the list in creation order', () => {
      expect(ids(next([insert]))).toEqual([...ids(base), newId]);
    });

    it('replaces a record with the same id where it stands, and keeps the others in place', () => {
      const after = next([replace]);

      expect(ids(after)).toEqual(ids(base));
      expect(list(after).find((row) => row.id === oldId)).toEqual((replace as { row: unknown }).row);
    });

    it('removes a record and keeps the order of the others', () => {
      expect(ids(next([remove]))).toEqual(ids(base).filter((id) => id !== oldId));
    });

    it('leaves every other list as it was', () => {
      const after = next([insert]);
      const others = (s: Snapshot) => ({ ...s, foodCategories: [], foodTypes: [], batches: [], recipeCategories: [], recipes: [] });

      expect(others(after)).toEqual(others(base));
    });
  });

  describe('the settings and the counters', () => {
    it('replace the single row they have', () => {
      const after = next([
        { kind: 'putSettings', row: { simulatedToday: '2026-12-01', bootstrapped: true } },
        { kind: 'putCounters', row: { nextId: 99, nextSeq: 50 } },
      ]);

      expect(after.settings).toEqual({ simulatedToday: '2026-12-01', bootstrapped: true });
      expect(after.counters).toEqual({ nextId: 99, nextSeq: 50 });
      expect(after.batches).toEqual(base.batches);
    });

    it('clear Simulated Today by putting null', () => {
      const dated = next([{ kind: 'putSettings', row: { simulatedToday: '2026-12-01', bootstrapped: true } }]);

      expect(next([{ kind: 'putSettings', row: { simulatedToday: null, bootstrapped: true } }], dated).settings.simulatedToday).toBeNull();
    });
  });

  describe('the ingredient rows of a recipe', () => {
    const row = (recipeId: number, foodTypeId: number, requiredQuantity: number) => buildIngredient({ recipeId, foodTypeId, requiredQuantity });
    const rowsOf = (snapshot: Snapshot, recipeId: number) =>
      snapshot.recipeIngredients.filter((r) => r.recipeId === recipeId).map((r) => [r.foodTypeId, r.requiredQuantity]);

    it('adds a row at the end and replaces a row of the same recipe and Food Type where it stands', () => {
      const added = next([{ kind: 'putIngredient', row: row(31, 10, 500) }]);
      expect(added.recipeIngredients.map((r) => [r.recipeId, r.foodTypeId])).toEqual([[30, 10], [30, 11], [31, 11], [31, 10]]);

      const replaced = next([{ kind: 'putIngredient', row: row(30, 11, 777) }]);
      expect(replaced.recipeIngredients.map((r) => [r.recipeId, r.foodTypeId, r.requiredQuantity])).toEqual([
        [30, 10, 300_000],
        [30, 11, 777],
        [31, 11, 50_000],
      ]);
    });

    it('stamps a deleted Food Type onto a row by replacing it, which is how a Food Type deletion marks its recipes', () => {
      const stamped = { ...row(30, 10, 300_000), deletedFoodTypeName: 'Beef' };

      const after = next([{ kind: 'deleteFoodType', id: 10 }, { kind: 'putIngredient', row: stamped }]);

      expect(after.foodTypes.map((f) => f.id)).toEqual([11]);
      expect(after.recipeIngredients[0]).toEqual(stamped);
    });

    it('deletes every row of one recipe and no row of another', () => {
      const after = next([{ kind: 'deleteIngredientsOfRecipe', recipeId: 30 }]);

      expect(rowsOf(after, 30)).toEqual([]);
      expect(rowsOf(after, 31)).toEqual(rowsOf(base, 31));
    });

    it('replaces the rows of a recipe with one delete followed by the new puts, the one case of several operations on a recipe\'s rows', () => {
      const after = next([
        { kind: 'deleteIngredientsOfRecipe', recipeId: 30 },
        { kind: 'putIngredient', row: row(30, 11, 1) },
        { kind: 'putIngredient', row: row(30, 10, 2) },
      ]);

      // the new rows come after the rows that were kept, in the order they were put
      expect(after.recipeIngredients.map((r) => [r.recipeId, r.foodTypeId, r.requiredQuantity])).toEqual([
        [31, 11, 50_000],
        [30, 11, 1],
        [30, 10, 2],
      ]);
    });

    it('removes a recipe together with its rows when both operations are given', () => {
      const after = next([{ kind: 'deleteRecipe', id: 30 }, { kind: 'deleteIngredientsOfRecipe', recipeId: 30 }]);

      expect(after.recipes.map((r) => r.id)).toEqual([31]);
      expect(rowsOf(after, 30)).toEqual([]);
    });

    it('takes the delete in either order beside the delete of its recipe', () => {
      const a = next([{ kind: 'deleteIngredientsOfRecipe', recipeId: 30 }, { kind: 'deleteRecipe', id: 30 }]);
      const b = next([{ kind: 'deleteRecipe', id: 30 }, { kind: 'deleteIngredientsOfRecipe', recipeId: 30 }]);

      expect(a).toEqual(b);
    });

    describe('a recipe that has no row yet, as a new recipe has none', () => {
      it('is not an error to delete its rows: nothing is there, and nothing changes', () => {
        // the rows of a recipe are a set and not a record, so an empty set has nothing to refuse
        expect(next([{ kind: 'deleteIngredientsOfRecipe', recipeId: 404 }])).toEqual(base);
        expect(codeOf([{ kind: 'deleteIngredientsOfRecipe', recipeId: 404 }])).toBe('ok');
      });

      it('takes the sequence "delete the rows, then put the new ones" for a new recipe as it does for an edit', () => {
        // the plan words a save as one delete of the rows followed by the new puts, whether the recipe is new or not
        const create = (recipeId: number) => [
          { kind: 'putRecipe', row: buildRecipe({ id: recipeId, name: 'Omelette' }) },
          { kind: 'deleteIngredientsOfRecipe', recipeId },
          { kind: 'putIngredient', row: row(recipeId, 10, 3000) },
          { kind: 'putIngredient', row: row(recipeId, 11, 150) },
        ] as const;

        const after = next(create(40));

        expect(after.recipes.map((r) => r.id)).toEqual([30, 31, 40]);
        expect(rowsOf(after, 40)).toEqual([[10, 3000], [11, 150]]);
        // the other recipes keep their rows, and the new rows come last, in the order they were put
        expect(after.recipeIngredients.slice(0, 3)).toEqual(base.recipeIngredients);
        expect(after.recipeIngredients).toHaveLength(base.recipeIngredients.length + 2);
      });

      it('gives the same snapshot with the delete as without it: for a new recipe the delete is a no-op', () => {
        const withDelete = next([
          { kind: 'putRecipe', row: buildRecipe({ id: 40, name: 'Omelette' }) },
          { kind: 'deleteIngredientsOfRecipe', recipeId: 40 },
          { kind: 'putIngredient', row: row(40, 10, 3000) },
        ]);
        const without = next([
          { kind: 'putRecipe', row: buildRecipe({ id: 40, name: 'Omelette' }) },
          { kind: 'putIngredient', row: row(40, 10, 3000) },
        ]);

        expect(withDelete).toEqual(without);
      });

      it('still keeps the order rule: the rows cannot be deleted after they were put, new recipe or not', () => {
        expect(codeOf([
          { kind: 'putIngredient', row: row(40, 10, 3000) },
          { kind: 'deleteIngredientsOfRecipe', recipeId: 40 },
        ])).toBe('CONFLICTING_OPS');
        expect(codeOf([
          { kind: 'deleteIngredientsOfRecipe', recipeId: 40 },
          { kind: 'deleteIngredientsOfRecipe', recipeId: 40 },
        ])).toBe('CONFLICTING_OPS');
      });
    });
  });

  describe('the spec examples as ChangeSets', () => {
    it('keeps two inbounds of one Food Type as two separate batches (spec 4.2.1)', () => {
      const first = next([
        { kind: 'putFoodType', row: buildFoodType({ id: 3, name: 'Milk', unit: 'ml' }) },
        { kind: 'putBatch', row: buildBatch({ id: 4, foodTypeId: 3, quantity: 500_000, inboundDate: '2026-10-01', expirationDate: '2026-10-06', createdSeq: 1 }) },
        { kind: 'putCounters', row: { nextId: 5, nextSeq: 2 } },
      ], buildSnapshot());
      const second = next([
        { kind: 'putBatch', row: buildBatch({ id: 5, foodTypeId: 3, quantity: 1_000_000, inboundDate: '2026-10-02', expirationDate: '2026-10-12', createdSeq: 2 }) },
        { kind: 'putCounters', row: { nextId: 6, nextSeq: 3 } },
      ], first);

      expect(second.foodTypes).toHaveLength(1);
      expect(second.batches.map((b) => [b.id, b.quantity, b.expirationDate])).toEqual([
        [4, 500_000, '2026-10-06'],
        [5, 1_000_000, '2026-10-12'],
      ]);
    });

    it('moves every quantity of a unit change in one step (spec 4.2.2): the unit and both batches change together', () => {
      const chicken = buildSnapshot({
        foodTypes: [buildFoodType({ id: 10, name: 'Chicken' })],
        batches: [buildBatch({ id: 20, foodTypeId: 10, quantity: 100_000 }), buildBatch({ id: 21, foodTypeId: 10, quantity: 200_000 })],
      });

      const after = next([
        { kind: 'putFoodType', row: buildFoodType({ id: 10, name: 'Chicken', unit: 'pieces' }) },
        { kind: 'putBatch', row: buildBatch({ id: 20, foodTypeId: 10, quantity: 500 }) },
        { kind: 'putBatch', row: buildBatch({ id: 21, foodTypeId: 10, quantity: 1000 }) },
      ], chicken);

      expect(after.foodTypes[0]?.unit).toBe('pieces');
      expect(after.batches.map((b) => b.quantity)).toEqual([500, 1000]);
    });
  });

  describe('CONFLICTING_OPS: a record may appear in a ChangeSet once', () => {
    const conflicts: readonly (readonly [string, readonly EntityOp[]])[] = [
      ['two puts of one record', [{ kind: 'putBatch', row: buildBatch({ id: 20, foodTypeId: 10, quantity: 1 }) }, { kind: 'putBatch', row: buildBatch({ id: 20, foodTypeId: 10, quantity: 2 }) }]],
      ['a put and then a delete of one record', [{ kind: 'putFoodType', row: buildFoodType({ id: 10, name: 'Beef' }) }, { kind: 'deleteFoodType', id: 10 }]],
      ['a delete and then a put of one record', [{ kind: 'deleteFoodCategory', id: 4 }, { kind: 'putFoodCategory', row: buildFoodCategory({ id: 4, name: 'Poultry', parentId: 3 }) }]],
      ['two deletes of one record', [{ kind: 'deleteBatch', id: 21 }, { kind: 'deleteBatch', id: 21 }]],
      ['two operations on one recipe', [{ kind: 'putRecipe', row: buildRecipe({ id: 31, name: 'Soup 2' }) }, { kind: 'deleteRecipe', id: 31 }]],
      ['two operations on one cuisine', [{ kind: 'deleteRecipeCategory', id: 5 }, { kind: 'putRecipeCategory', row: buildRecipeCategory({ id: 5, name: 'X' }) }]],
      ['two puts of one ingredient row', [{ kind: 'putIngredient', row: buildIngredient({ recipeId: 30, foodTypeId: 10 }) }, { kind: 'putIngredient', row: buildIngredient({ recipeId: 30, foodTypeId: 10, requiredQuantity: 5 }) }]],
      ['two deletes of the rows of one recipe', [{ kind: 'deleteIngredientsOfRecipe', recipeId: 30 }, { kind: 'deleteIngredientsOfRecipe', recipeId: 30 }]],
      ['a put of a row and then the delete of that recipe\'s rows', [{ kind: 'putIngredient', row: buildIngredient({ recipeId: 30, foodTypeId: 10 }) }, { kind: 'deleteIngredientsOfRecipe', recipeId: 30 }]],
      ['two puts of the settings', [{ kind: 'putSettings', row: { simulatedToday: null, bootstrapped: true } }, { kind: 'putSettings', row: { simulatedToday: null, bootstrapped: false } }]],
      ['two puts of the counters', [{ kind: 'putCounters', row: { nextId: 50, nextSeq: 5 } }, { kind: 'putCounters', row: { nextId: 51, nextSeq: 6 } }]],
    ];

    it.each(conflicts)('is refused for %s', (_name, ops) => {
      expect(codeOf(ops)).toBe('CONFLICTING_OPS');
    });

    it('names the operation, the record and the operation that came first', () => {
      const result = run([{ kind: 'deleteBatch', id: 21 }, { kind: 'deleteBatch', id: 21 }]);

      expect(result).toMatchObject({ ok: false, err: { code: 'CONFLICTING_OPS' } });
      expect(result.ok ? '' : result.err.detail).toMatch(/operation 2 .*batch 21.*operation 1/);
    });

    it('finds the conflict wherever it is in a long ChangeSet', () => {
      const ops: EntityOp[] = [
        { kind: 'putFoodType', row: buildFoodType({ id: 40, name: 'Egg' }) },
        { kind: 'putBatch', row: buildBatch({ id: 41, foodTypeId: 40 }) },
        { kind: 'putCounters', row: { nextId: 42, nextSeq: 3 } },
        { kind: 'putBatch', row: buildBatch({ id: 41, foodTypeId: 40, quantity: 5 }) },
      ];

      expect(codeOf(ops)).toBe('CONFLICTING_OPS');
    });

    it('does not mistake different records, or one id in two different lists, for a conflict', () => {
      expect(codeOf([{ kind: 'deleteBatch', id: 20 }, { kind: 'deleteBatch', id: 21 }])).toBe('ok');
      expect(codeOf([{ kind: 'putBatch', row: buildBatch({ id: 40, foodTypeId: 10 }) }, { kind: 'putFoodType', row: buildFoodType({ id: 40, name: 'Egg' }) }])).toBe('ok');
      expect(codeOf([
        { kind: 'putIngredient', row: buildIngredient({ recipeId: 31, foodTypeId: 10 }) },
        { kind: 'putIngredient', row: buildIngredient({ recipeId: 31, foodTypeId: 12 }) },
        { kind: 'putIngredient', row: buildIngredient({ recipeId: 30, foodTypeId: 12 }) },
      ])).toBe('ok');
    });
  });

  describe('UNKNOWN_TARGET: a delete of a record that is not there', () => {
    const deletes: readonly (readonly [string, EntityOp])[] = [
      ['a food category', { kind: 'deleteFoodCategory', id: 404 }],
      ['a Food Type', { kind: 'deleteFoodType', id: 404 }],
      ['a batch', { kind: 'deleteBatch', id: 404 }],
      ['a cuisine', { kind: 'deleteRecipeCategory', id: 404 }],
      ['a recipe', { kind: 'deleteRecipe', id: 404 }],
    ];

    it.each(deletes)('is refused for %s', (_name, op) => {
      expect(codeOf([op])).toBe('UNKNOWN_TARGET');
    });

    it('takes a record of another kind with that id for no record: ids are looked up in their own list', () => {
      // 10 is a Food Type and not a batch
      expect(codeOf([{ kind: 'deleteBatch', id: 10 }])).toBe('UNKNOWN_TARGET');
    });

    it('names the operation and the record', () => {
      const result = run([{ kind: 'deleteBatch', id: 20 }, { kind: 'deleteRecipe', id: 404 }]);

      expect(result.ok ? '' : result.err.detail).toMatch(/operation 2 \(deleteRecipe\).*recipe 404/);
    });

    it('is refused for a delete of what an earlier ChangeSet already deleted', () => {
      const once = next([{ kind: 'deleteBatch', id: 20 }]);

      expect(codeOf([{ kind: 'deleteBatch', id: 20 }], once)).toBe('UNKNOWN_TARGET');
    });

    it('is refused for an operation of a kind that the store does not have', () => {
      const unknown = { kind: 'dropEverything' } as unknown as EntityOp;

      expect(codeOf([unknown])).toBe('UNKNOWN_TARGET');
      expect(ENTITY_OP_KINDS).toHaveLength(14);
    });
  });

  describe('a refusal changes nothing', () => {
    it('returns an error and no snapshot, so an operation that came before the fault is not half applied', () => {
      const result = run([
        { kind: 'putFoodType', row: buildFoodType({ id: 40, name: 'Egg' }) },
        { kind: 'deleteBatch', id: 404 },
      ]);

      expect(result.ok).toBe(false);
      expect(base.foodTypes).toHaveLength(2);
    });

    it('lets the caller retry from the same snapshot', () => {
      run([{ kind: 'deleteBatch', id: 404 }]);

      expect(next([{ kind: 'deleteBatch', id: 20 }]).batches.map((b) => b.id)).toEqual([21]);
    });
  });

  describe('no cascade: it applies what it is given and decides nothing', () => {
    it('leaves the batches of a deleted Food Type and the rows that name it where they are', () => {
      const after = next([{ kind: 'deleteFoodType', id: 10 }]);

      expect(after.batches).toEqual(base.batches);
      expect(after.recipeIngredients).toEqual(base.recipeIngredients);
    });

    it('does not check references: a batch of a Food Type that does not exist is put as given', () => {
      expect(next([{ kind: 'putBatch', row: buildBatch({ id: 40, foodTypeId: 999 }) }]).batches.map((b) => b.id)).toEqual([20, 21, 40]);
    });
  });

  describe('the result', () => {
    it('is a new snapshot: the input and its lists are not touched, which a frozen input proves', () => {
      const after = next([
        { kind: 'putFoodType', row: buildFoodType({ id: 40, name: 'Egg' }) },
        { kind: 'deleteBatch', id: 20 },
        { kind: 'putCounters', row: { nextId: 41, nextSeq: 5 } },
        { kind: 'deleteIngredientsOfRecipe', recipeId: 30 },
      ]);

      expect(after).not.toBe(base);
      expect(after.batches).not.toBe(base.batches);
      expect(after.recipeIngredients).not.toBe(base.recipeIngredients);
      expect(base.foodTypes).toHaveLength(2);
      expect(base.batches).toHaveLength(2);
      expect(base.counters).toEqual({ nextId: 32, nextSeq: 22 });
    });

    it('is equal to the input for a ChangeSet with no operation, such as the edit of a recipe that changed nothing', () => {
      expect(next([])).toEqual(base);
    });

    it('applies the operations in order, so a list ends in the order of the puts', () => {
      const after = next([
        { kind: 'putBatch', row: buildBatch({ id: 42, foodTypeId: 10 }) },
        { kind: 'putBatch', row: buildBatch({ id: 41, foodTypeId: 10 }) },
        { kind: 'putBatch', row: buildBatch({ id: 43, foodTypeId: 10 }) },
      ]);

      expect(after.batches.map((b) => b.id)).toEqual([20, 21, 42, 41, 43]);
    });

    it('is the same for the same input, and typed as a Result of a Snapshot', () => {
      const ops: EntityOp[] = [{ kind: 'putBatch', row: buildBatch({ id: 40, foodTypeId: 10 }) }];

      expect(run(ops)).toEqual(run(ops));
      expectTypeOf(changeSetApplier).returns.toEqualTypeOf<Result<Snapshot, DomainError>>();
    });
  });
});
