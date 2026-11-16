import { describe, expect, it } from 'vitest';
import { ENTITY_OP_KINDS, STORE_KEYS } from '@freshrescue/contract-changeset';
import type { ChangeSet, EntityOp, StoreTable, WriteOp, WriteOps } from '@freshrescue/contract-changeset';
import { EMPTY_SNAPSHOT } from '@freshrescue/contract-entities';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import type { Allocation } from '@freshrescue/contract-views';
import {
  APPENDIX_A_SEED,
  buildBatch,
  buildFoodCategory,
  buildFoodType,
  buildIngredient,
  buildRecipe,
  buildRecipeCategory,
  buildSnapshot,
} from '../../testing/fixtures';
import { idAllocator } from '../foundation/idAllocator';
import { seedBundleParser } from '../parsing/seedBundleParser';
import { changeSetApplier } from '../state/changeSetApplier';
import { changeSetEncoder } from './changeSetEncoder';
import { changeSetMerger } from './changeSetMerger';
import { cookChangeSetBuilder } from './cookChangeSetBuilder';
import { seedPlanner } from './seedPlanner';
import { systemDataInitializer } from './systemDataInitializer';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);

// ---- a store of plain rows, as the write gateway sees one ------------------------------------------
//
// Each logical table is a list of rows. A put inserts its row at the end, or replaces the row whose
// key fields (STORE_KEYS) are equal; a delete removes every row that matches its key, which may be
// partial. This is the meaning that the changeset contract gives WriteOps, and what the memory store of
// phase 6 and the MySQL store of phase 7 implement.

type Row = Readonly<Record<string, unknown>>;
type Tables = Record<StoreTable, Row[]>;

const matches = (row: Row, key: Row): boolean => Object.entries(key).every(([field, value]) => row[field] === value);
const keyOf = (table: StoreTable, row: Row): Row => Object.fromEntries((STORE_KEYS[table] as readonly string[]).map((field) => [field, row[field]]));

function replay(snapshot: Snapshot, writes: WriteOps): Snapshot {
  const tables: Tables = {
    foodCategories: [...snapshot.foodCategories],
    foodTypes: [...snapshot.foodTypes],
    batches: [...snapshot.batches],
    recipeCategories: [...snapshot.recipeCategories],
    recipes: [...snapshot.recipes],
    recipeIngredients: [...snapshot.recipeIngredients],
    settings: [snapshot.settings],
    counters: [snapshot.counters],
  };
  for (const write of writes) {
    const rows = tables[write.table];
    if (write.op === 'put') {
      const key = keyOf(write.table, write.row);
      const at = rows.findIndex((existing) => matches(existing, key));
      if (at < 0) rows.push(write.row);
      else rows[at] = write.row;
    } else {
      tables[write.table] = rows.filter((existing) => !matches(existing, write.key));
    }
  }
  return {
    foodCategories: tables.foodCategories,
    foodTypes: tables.foodTypes,
    batches: tables.batches,
    recipeCategories: tables.recipeCategories,
    recipes: tables.recipes,
    recipeIngredients: tables.recipeIngredients,
    settings: tables.settings[0],
    counters: tables.counters[0],
  } as unknown as Snapshot;
}

// ---- the snapshots and ChangeSets of these tests ----------------------------------------------------

/** Something in every list: two categories, two Food Types, two batches, a cuisine, two recipes and three rows. */
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

/** The kitchen of spec 4.5: Beef with batch A (100 g, expired), B (150 g) and C (200 g), and 250 g of Broccoli. */
const kitchen = buildSnapshot({
  foodTypes: [buildFoodType({ id: 10, name: 'Beef' }), buildFoodType({ id: 11, name: 'Broccoli' })],
  batches: [
    buildBatch({ id: 20, foodTypeId: 10, quantity: 100_000, expirationDate: '2026-10-09' }),
    buildBatch({ id: 21, foodTypeId: 10, quantity: 150_000, expirationDate: '2026-10-11' }),
    buildBatch({ id: 22, foodTypeId: 10, quantity: 200_000, expirationDate: '2026-10-17' }),
    buildBatch({ id: 23, foodTypeId: 11, quantity: 250_000, expirationDate: '2026-10-20' }),
  ],
});
const fefoBeef: Allocation = {
  foodTypeId: 10,
  takes: [
    { batchId: 21, takeMilli: 150_000, emptied: true },
    { batchId: 22, takeMilli: 150_000, emptied: false },
  ],
};
const partialBroccoli: Allocation = { foodTypeId: 11, takes: [{ batchId: 23, takeMilli: 200_000, emptied: false }] };

const seed = valueOf(seedBundleParser(APPENDIX_A_SEED));
const seedAlloc = idAllocator(EMPTY_SNAPSHOT.counters, { ids: seed.idDemand, seqs: 0 });

/** Every kind of operation once, each on its own record. */
const EVERY_KIND: ChangeSet = {
  ops: [
    { kind: 'putFoodCategory', row: buildFoodCategory({ id: 40, name: 'Fish' }) },
    { kind: 'deleteFoodCategory', id: 4 },
    { kind: 'putFoodType', row: buildFoodType({ id: 10, name: 'Beef', categoryId: 3, unit: 'kg' }) },
    { kind: 'deleteFoodType', id: 11 },
    { kind: 'putBatch', row: buildBatch({ id: 20, foodTypeId: 10, quantity: 5 }) },
    { kind: 'deleteBatch', id: 21 },
    { kind: 'putRecipeCategory', row: buildRecipeCategory({ id: 41, name: 'Thai Cuisine' }) },
    { kind: 'deleteRecipeCategory', id: 5 },
    { kind: 'putRecipe', row: buildRecipe({ id: 30, name: 'Beef Stew' }) },
    { kind: 'deleteRecipe', id: 31 },
    { kind: 'deleteIngredientsOfRecipe', recipeId: 31 },
    { kind: 'putIngredient', row: buildIngredient({ recipeId: 30, foodTypeId: 10, requiredQuantity: 7 }) },
    { kind: 'putSettings', row: { simulatedToday: '2026-12-01', bootstrapped: true } },
    { kind: 'putCounters', row: { nextId: 99, nextSeq: 50 } },
  ],
};

/** Every ChangeSet used in these tests, with the snapshot it applies to. */
const SCENARIOS: readonly (readonly [string, Snapshot, ChangeSet])[] = [
  ['every kind of operation once', base, EVERY_KIND],
  ['the FEFO cook of spec 4.5', kitchen, valueOf(cookChangeSetBuilder(30, [fefoBeef], kitchen))],
  ['the Partial cook of spec 4.5', kitchen, valueOf(cookChangeSetBuilder(31, [partialBroccoli], kitchen))],
  ['a cook that empties every batch it takes from', kitchen, valueOf(cookChangeSetBuilder(32, [{ foodTypeId: 11, takes: [{ batchId: 23, takeMilli: 250_000, emptied: true }] }], kitchen))],
  ['the bootstrap of Appendix A on an empty store', EMPTY_SNAPSHOT, changeSetMerger([systemDataInitializer(EMPTY_SNAPSHOT), seedAlloc.counterCs, seedPlanner(seed, seedAlloc.ids, EMPTY_SNAPSHOT)])],
  ['the system data alone', EMPTY_SNAPSHOT, systemDataInitializer(EMPTY_SNAPSHOT)],
  [
    'replacing the rows of a recipe: one delete, then the new rows',
    base,
    {
      ops: [
        { kind: 'putRecipe', row: buildRecipe({ id: 30, name: 'Stew', recipeCategoryId: 5 }) },
        { kind: 'deleteIngredientsOfRecipe', recipeId: 30 },
        { kind: 'putIngredient', row: buildIngredient({ recipeId: 30, foodTypeId: 11, requiredQuantity: 1, requiredUnit: 'ml' }) },
        { kind: 'putIngredient', row: buildIngredient({ recipeId: 30, foodTypeId: 10, requiredQuantity: 2 }) },
      ],
    },
  ],
  [
    'creating a recipe with the same sequence, where the delete finds no row',
    base,
    {
      ops: [
        { kind: 'putCounters', row: { nextId: 41, nextSeq: 22 } },
        { kind: 'putRecipe', row: buildRecipe({ id: 40, name: 'Omelette' }) },
        { kind: 'deleteIngredientsOfRecipe', recipeId: 40 },
        { kind: 'putIngredient', row: buildIngredient({ recipeId: 40, foodTypeId: 11, requiredQuantity: 3, requiredUnit: 'ml' }) },
      ],
    },
  ],
  [
    'deleting a Food Type and stamping its name on the rows that used it',
    base,
    {
      ops: [
        { kind: 'deleteFoodType', id: 11 },
        { kind: 'putIngredient', row: buildIngredient({ recipeId: 30, foodTypeId: 11, requiredQuantity: 100_000, requiredUnit: 'ml', deletedFoodTypeName: 'Milk' }) },
        { kind: 'putIngredient', row: buildIngredient({ recipeId: 31, foodTypeId: 11, requiredQuantity: 50_000, requiredUnit: 'ml', deletedFoodTypeName: 'Milk' }) },
      ],
    },
  ],
  [
    'deleting a Parent with its Child and moving its Food Types to Other',
    base,
    {
      ops: [
        { kind: 'deleteFoodCategory', id: 4 },
        { kind: 'deleteFoodCategory', id: 3 },
        { kind: 'putFoodType', row: buildFoodType({ id: 10, name: 'Beef', categoryId: SYSTEM_IDS.FOOD_OTHER }) },
      ],
    },
  ],
  ['deleting a recipe with its rows', base, { ops: [{ kind: 'deleteRecipe', id: 30 }, { kind: 'deleteIngredientsOfRecipe', recipeId: 30 }] }],
  [
    'a unit change: the unit and every batch quantity together',
    base,
    {
      ops: [
        { kind: 'putFoodType', row: buildFoodType({ id: 10, name: 'Beef', categoryId: 3, unit: 'pieces' }) },
        { kind: 'putBatch', row: buildBatch({ id: 20, foodTypeId: 10, quantity: 500 }) },
      ],
    },
  ],
  [
    'an inbound of a new Food Type: the counters, the Food Type and its first batch',
    base,
    changeSetMerger([
      { ops: [{ kind: 'putCounters', row: { nextId: 52, nextSeq: 22 } }] },
      { ops: [{ kind: 'putFoodType', row: buildFoodType({ id: 50, name: 'Kale' }) }] },
      { ops: [{ kind: 'putBatch', row: buildBatch({ id: 51, foodTypeId: 50, createdSeq: 21 }) }] },
    ]),
  ],
  ['clearing Simulated Today', { ...base, settings: { simulatedToday: '2026-10-04', bootstrapped: true } }, { ops: [{ kind: 'putSettings', row: { simulatedToday: null, bootstrapped: true } }] }],
  ['an empty ChangeSet', base, { ops: [] }],
];

describe('BC-43 ChangeSetEncoder', () => {
  describe('one write for each operation, in the same order', () => {
    const cases: readonly (readonly [EntityOp, WriteOp])[] = [
      [{ kind: 'putFoodCategory', row: buildFoodCategory({ id: 3, name: 'Meat' }) }, { op: 'put', table: 'foodCategories', row: buildFoodCategory({ id: 3, name: 'Meat' }) }],
      [{ kind: 'deleteFoodCategory', id: 3 }, { op: 'delete', table: 'foodCategories', key: { id: 3 } }],
      [{ kind: 'putFoodType', row: buildFoodType({ id: 10, name: 'Beef' }) }, { op: 'put', table: 'foodTypes', row: buildFoodType({ id: 10, name: 'Beef' }) }],
      [{ kind: 'deleteFoodType', id: 10 }, { op: 'delete', table: 'foodTypes', key: { id: 10 } }],
      [{ kind: 'putBatch', row: buildBatch({ id: 20, foodTypeId: 10 }) }, { op: 'put', table: 'batches', row: buildBatch({ id: 20, foodTypeId: 10 }) }],
      [{ kind: 'deleteBatch', id: 20 }, { op: 'delete', table: 'batches', key: { id: 20 } }],
      [{ kind: 'putRecipeCategory', row: buildRecipeCategory({ id: 5, name: 'Thai Cuisine' }) }, { op: 'put', table: 'recipeCategories', row: buildRecipeCategory({ id: 5, name: 'Thai Cuisine' }) }],
      [{ kind: 'deleteRecipeCategory', id: 5 }, { op: 'delete', table: 'recipeCategories', key: { id: 5 } }],
      [{ kind: 'putRecipe', row: buildRecipe({ id: 30, name: 'Stew' }) }, { op: 'put', table: 'recipes', row: buildRecipe({ id: 30, name: 'Stew' }) }],
      [{ kind: 'deleteRecipe', id: 30 }, { op: 'delete', table: 'recipes', key: { id: 30 } }],
      [{ kind: 'putIngredient', row: buildIngredient({ recipeId: 30, foodTypeId: 10 }) }, { op: 'put', table: 'recipeIngredients', row: buildIngredient({ recipeId: 30, foodTypeId: 10 }) }],
      [{ kind: 'deleteIngredientsOfRecipe', recipeId: 30 }, { op: 'delete', table: 'recipeIngredients', key: { recipeId: 30 } }],
      [{ kind: 'putSettings', row: { simulatedToday: null, bootstrapped: true } }, { op: 'put', table: 'settings', row: { simulatedToday: null, bootstrapped: true } }],
      [{ kind: 'putCounters', row: { nextId: 7, nextSeq: 2 } }, { op: 'put', table: 'counters', row: { nextId: 7, nextSeq: 2 } }],
    ];

    it('covers each of the 14 kinds of operation', () => {
      expect(cases.map(([op]) => op.kind)).toEqual([...ENTITY_OP_KINDS]);
    });

    it.each(cases)('turns %o into %o', (op, write) => {
      expect(changeSetEncoder({ ops: [op] })).toEqual([write]);
    });

    it('keeps the order and the number of the operations', () => {
      const writes = changeSetEncoder(EVERY_KIND);

      expect(writes).toHaveLength(EVERY_KIND.ops.length);
      expect(writes.map((write) => `${write.op} ${write.table}`)).toEqual([
        'put foodCategories',
        'delete foodCategories',
        'put foodTypes',
        'delete foodTypes',
        'put batches',
        'delete batches',
        'put recipeCategories',
        'delete recipeCategories',
        'put recipes',
        'delete recipes',
        'delete recipeIngredients',
        'put recipeIngredients',
        'put settings',
        'put counters',
      ]);
      expect(changeSetEncoder({ ops: [] })).toEqual([]);
    });
  });

  it('deletes the rows of a recipe by the recipe alone, a partial key that matches every row of it and none of another', () => {
    const [write] = changeSetEncoder({ ops: [{ kind: 'deleteIngredientsOfRecipe', recipeId: 30 }] });
    const after = replay(base, write === undefined ? [] : [write]);

    expect(write).toEqual({ op: 'delete', table: 'recipeIngredients', key: { recipeId: 30 } });
    expect(after.recipeIngredients.map((row) => [row.recipeId, row.foodTypeId])).toEqual([[31, 11]]);
  });

  it('does not encode an operation of a kind the store does not have, which the applier refuses first', () => {
    const unknown = { kind: 'dropEverything' } as unknown as EntityOp;

    expect(changeSetEncoder({ ops: [{ kind: 'deleteBatch', id: 20 }, unknown] })).toEqual([{ op: 'delete', table: 'batches', key: { id: 20 } }]);
  });

  describe('the applier and the encoder agree: replaying the WriteOps on plain rows gives the applier\'s snapshot', () => {
    it.each(SCENARIOS)('for %s', (_name, from, changeSet) => {
      const applied = valueOf(changeSetApplier(from, changeSet));

      expect(replay(from, changeSetEncoder(changeSet))).toEqual(applied);
    });

    it('is a real comparison: a write lost on the way would give another snapshot', () => {
      const applied = valueOf(changeSetApplier(base, EVERY_KIND));

      expect(replay(base, changeSetEncoder(EVERY_KIND).slice(0, -1))).not.toEqual(applied);
    });
  });
});
