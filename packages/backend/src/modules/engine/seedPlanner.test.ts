import { describe, expect, it } from 'vitest';
import type { EntityOp } from '@freshrescue/contract-changeset';
import { EMPTY_SNAPSHOT } from '@freshrescue/contract-entities';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Id, Result } from '@freshrescue/contract-primitives';
import { FIRST_FREE_ID, SYSTEM_IDS } from '@freshrescue/contract-rules';
import type { ParsedSeed, SeedBundle } from '@freshrescue/contract-seed';
import { APPENDIX_A_SEED } from '../../testing/fixtures';
import { recipeErrorEvaluator } from '../derive/recipeErrorEvaluator';
import { idAllocator } from '../foundation/idAllocator';
import { seedBundleParser } from '../parsing/seedBundleParser';
import { changeSetApplier } from '../state/changeSetApplier';
import { changeSetMerger } from './changeSetMerger';
import { seedPlanner } from './seedPlanner';
import { snapshotInvariantChecker } from './snapshotInvariantChecker';
import { systemDataInitializer } from './systemDataInitializer';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);

const parsed: ParsedSeed = valueOf(seedBundleParser(APPENDIX_A_SEED));
/** The ids that IdAllocator reserves for the seed on an empty store: idDemand ids from the first free one. */
const RESERVED: readonly Id[] = idAllocator(EMPTY_SNAPSHOT.counters, { ids: parsed.idDemand, seqs: 0 }).ids;

/** The bootstrap of ReferenceCommandCoordinator (blueprint 4.2): system data, the counter bump, then the plan, as one ChangeSet. */
function bootstrap(seed: ParsedSeed, from: Snapshot = EMPTY_SNAPSHOT): Snapshot {
  const alloc = idAllocator(from.counters, { ids: seed.idDemand, seqs: 0 });
  const changeSet = changeSetMerger([systemDataInitializer(from), alloc.counterCs, seedPlanner(seed, alloc.ids, from)]);
  return valueOf(changeSetApplier(from, changeSet));
}

const kindsOf = (ops: readonly EntityOp[]): string[] => ops.map((op) => op.kind);

describe('BC-40 SeedPlanner', () => {
  const plan = seedPlanner(parsed, RESERVED, EMPTY_SNAPSHOT);
  const seeded = bootstrap(parsed);

  it('needs 24 ids for Appendix A: 7 food categories, 3 cuisines, 8 Food Types and 6 recipes', () => {
    expect(parsed.idDemand).toBe(24);
    expect(RESERVED).toEqual(Array.from({ length: 24 }, (_, offset) => FIRST_FREE_ID + offset));
  });

  it('consumes the ids in the order of SEED_ID_ORDER: food categories, cuisines, Food Types, recipes', () => {
    expect(seeded.foodCategories.map((c) => [c.id, c.name])).toEqual([
      [1, 'Other'],
      [3, 'Meat'],
      [4, 'Red Meat'],
      [5, 'Poultry'],
      [6, 'Dairy'],
      [7, 'Liquid Dairy'],
      [8, 'Vegetables'],
      [9, 'Leafy Greens'],
    ]);
    expect(seeded.recipeCategories.map((c) => [c.id, c.name])).toEqual([[2, 'Other'], [10, 'Chinese Cuisine'], [11, 'Vietnamese Cuisine'], [12, 'French Cuisine']]);
    expect(seeded.foodTypes.map((f) => f.id)).toEqual([13, 14, 15, 16, 17, 18, 19, 20]);
    expect(seeded.recipes.map((r) => r.id)).toEqual([21, 22, 23, 24, 25, 26]);
  });

  it('links each Child to its Parent, and makes every category an ordinary one with no threshold', () => {
    expect(seeded.foodCategories.filter((c) => c.parentId !== null).map((c) => [c.name, c.parentId])).toEqual([
      ['Red Meat', 3],
      ['Poultry', 3],
      ['Liquid Dairy', 6],
      ['Leafy Greens', 8],
    ]);
    expect(seeded.foodCategories.filter((c) => c.id !== SYSTEM_IDS.FOOD_OTHER).every((c) => !c.isSystem && c.customThresholdDays === null)).toBe(true);
  });

  it('files each Food Type under its category, a Parent directly where the sample says so, and Other for a null key', () => {
    const categoryOf = Object.fromEntries(seeded.foodTypes.map((f) => [f.name, f.categoryId]));

    expect(categoryOf).toEqual({ Beef: 4, Broccoli: 8, Chicken: 5, Egg: SYSTEM_IDS.FOOD_OTHER, Milk: 7, Rice: SYSTEM_IDS.FOOD_OTHER, Spinach: 9, Tomato: 8 });
    expect(seeded.foodTypes.map((f) => f.unit)).toEqual(['grams', 'grams', 'grams', 'pieces', 'ml', 'grams', 'grams', 'pieces']);
    expect(seeded.foodTypes.every((f) => f.customThresholdDays === null)).toBe(true);
  });

  it('gives each recipe its cuisine and its rows in thousandths, with the unit of its Food Type', () => {
    const friedRice = seeded.recipes.find((r) => r.name === 'Chicken Fried Rice');

    expect(friedRice).toEqual({ id: 23, name: 'Chicken Fried Rice', recipeCategoryId: 10 });
    expect(seeded.recipeIngredients.filter((row) => row.recipeId === 23)).toEqual([
      { recipeId: 23, foodTypeId: 15, requiredQuantity: 200_000, requiredUnit: 'grams', deletedFoodTypeName: null },
      { recipeId: 23, foodTypeId: 18, requiredQuantity: 300_000, requiredUnit: 'grams', deletedFoodTypeName: null },
      { recipeId: 23, foodTypeId: 16, requiredQuantity: 2_000, requiredUnit: 'pieces', deletedFoodTypeName: null },
    ]);
    expect(seeded.recipeIngredients).toHaveLength(15);
  });

  it('loads the built-in recipes as ordinary records, none of them blocked (spec 4.4.E)', () => {
    expect(recipeErrorEvaluator(seeded)).toEqual({});
    expect(seeded.recipes.map((r) => r.name)).toEqual([
      'Beef and Broccoli Stir-Fry',
      'Chicken Broccoli Gratin',
      'Chicken Fried Rice',
      'Spinach Omelette',
      'Tomato Egg Stir-Fry',
      'Vietnamese Chicken Rice',
    ]);
  });

  it('adds no batch, so the refrigerator starts empty, and marks the store bootstrapped', () => {
    expect(seeded.batches).toEqual([]);
    expect(seeded.settings).toEqual({ simulatedToday: null, bootstrapped: true });
    expect(seeded.counters).toEqual({ nextId: 27, nextSeq: 1 });
  });

  it('keeps Simulated Today as it is when it marks the store bootstrapped', () => {
    const dated: Snapshot = { ...EMPTY_SNAPSHOT, settings: { simulatedToday: '2026-10-01', bootstrapped: false } };

    expect(seedPlanner(parsed, RESERVED, dated).ops.at(-1)).toEqual({ kind: 'putSettings', row: { simulatedToday: '2026-10-01', bootstrapped: true } });
  });

  it('writes the categories, the cuisines, the Food Types, then each recipe with its rows, then the settings, and no counters', () => {
    const kinds = kindsOf(plan.ops);

    expect(kinds.slice(0, 7)).toEqual(Array(7).fill('putFoodCategory'));
    expect(kinds.slice(7, 10)).toEqual(Array(3).fill('putRecipeCategory'));
    expect(kinds.slice(10, 18)).toEqual(Array(8).fill('putFoodType'));
    expect(kinds.slice(18, 21)).toEqual(['putRecipe', 'putIngredient', 'putIngredient']);
    expect(kinds.at(-1)).toBe('putSettings');
    expect(kinds).not.toContain('putCounters');
    expect(kinds).not.toContain('putBatch');
  });

  it('puts a Food Type with no category and a recipe with no cuisine into the system Other of their tree', () => {
    const bundle: SeedBundle = {
      foodCategories: [],
      cuisines: [],
      foodTypes: [{ key: 'salt', name: 'Salt', categoryKey: null, unit: 'grams' }],
      recipes: [{ key: 'brine', name: 'Brine', cuisineKey: null, ingredients: [{ foodTypeKey: 'salt', quantity: 5_000, unit: 'grams' }] }],
    };
    const small = bootstrap(valueOf(seedBundleParser(bundle)));

    expect(small.foodTypes).toEqual([{ id: 3, name: 'Salt', categoryId: SYSTEM_IDS.FOOD_OTHER, unit: 'grams', customThresholdDays: null }]);
    expect(small.recipes).toEqual([{ id: 4, name: 'Brine', recipeCategoryId: SYSTEM_IDS.CUISINE_OTHER }]);
  });

  it('gives a seed whose plan passes the invariant checker', () => {
    expect(snapshotInvariantChecker(seeded)).toEqual({ ok: true, value: seeded });
  });

  it('cannot be stored when the coordinator reserves too few ids: the record left without one gets id 0, which the checker refuses', () => {
    const short = seedPlanner(parsed, RESERVED.slice(0, -1), EMPTY_SNAPSHOT);
    const merged = changeSetMerger([systemDataInitializer(EMPTY_SNAPSHOT), idAllocator(EMPTY_SNAPSHOT.counters, { ids: 23, seqs: 0 }).counterCs, short]);
    const after = valueOf(changeSetApplier(EMPTY_SNAPSHOT, merged));

    expect(after.recipes.at(-1)?.id).toBe(0);
    expect(snapshotInvariantChecker(after)).toMatchObject({ ok: false, err: { code: 'INVARIANT_BROKEN' } });
  });

  it('seeds nothing a second time once the store is bootstrapped, because the coordinator checks the flag', () => {
    // the flag is what startup reads; the plan always sets it
    expect(seeded.settings.bootstrapped).toBe(true);
    expect(systemDataInitializer(seeded)).toEqual({ ops: [] });
  });
});
