import { describe, expect, it } from 'vitest';
import type { Outcome } from '@freshrescue/contract-changeset';
import { EMPTY_SNAPSHOT } from '@freshrescue/contract-entities';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import {
  APPENDIX_A_SEED,
  buildBatch,
  buildFoodCategory,
  buildFoodType,
  buildIngredient,
  buildRecipe,
  buildRecipeCategory,
  buildSnapshot,
} from '../testing/fixtures';
import { snapshotInvariantChecker } from '../modules/engine/snapshotInvariantChecker';
import { changeSetApplier } from '../modules/state/changeSetApplier';
import { createReferenceCommandCoordinator } from './ReferenceCommandCoordinator';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as object)) deepFreeze(inner);
  }
  return value;
}

/** What the write path does with an Outcome: each ChangeSet applied in order, and every result checked. */
function settle(from: Snapshot, outcome: Outcome): Snapshot {
  let current = from;
  for (const changeSet of outcome.changeSets ?? []) {
    current = valueOf(changeSetApplier(current, changeSet));
    valueOf(snapshotInvariantChecker(current));
  }
  return current;
}

const coordinator = createReferenceCommandCoordinator();

const [MEAT, POULTRY, DAIRY, CHINESE, CHICKEN, MILK, RICE] = [10, 11, 12, 20, 30, 31, 32];

/**
 * A store with a Parent Meat (10, 5 days) holding the Child Poultry (11), a Parent Dairy (12), the cuisine Chinese (20),
 * Chicken (30) in Poultry with a batch (40), Milk (31) and Rice (32) in Other, and Chicken Rice (50) with a row for each of Chicken and Rice.
 * The counters are at 51 and 41. Frozen, so a workflow that edited its input would fail.
 */
const snapshot: Snapshot = deepFreeze(
  buildSnapshot({
    foodCategories: [
      buildFoodCategory({ id: MEAT, name: 'Meat', customThresholdDays: 5 }),
      buildFoodCategory({ id: POULTRY, name: 'Poultry', parentId: MEAT }),
      buildFoodCategory({ id: DAIRY, name: 'Dairy' }),
    ],
    recipeCategories: [buildRecipeCategory({ id: CHINESE, name: 'Chinese Cuisine' })],
    foodTypes: [
      buildFoodType({ id: CHICKEN, name: 'Chicken', categoryId: POULTRY }),
      buildFoodType({ id: MILK, name: 'Milk', unit: 'ml' }),
      buildFoodType({ id: RICE, name: 'Rice' }),
    ],
    batches: [buildBatch({ id: 40, foodTypeId: CHICKEN })],
    recipes: [buildRecipe({ id: 50, name: 'Chicken Rice', recipeCategoryId: CHINESE })],
    recipeIngredients: [buildIngredient({ recipeId: 50, foodTypeId: CHICKEN }), buildIngredient({ recipeId: 50, foodTypeId: RICE })],
  }),
);
const NEXT_ID = snapshot.counters.nextId;

describe('BX-02 ReferenceCommandCoordinator', () => {
  describe('bootstrap: the seed of an empty store (blueprint 4.2)', () => {
    const outcome = valueOf(coordinator.bootstrap(APPENDIX_A_SEED, EMPTY_SNAPSHOT));

    it('is one ChangeSet, so that the store is seeded in one write, and it has no payload', () => {
      expect(outcome.changeSets).toHaveLength(1);
      expect(outcome.payload).toBeUndefined();
    });

    it('puts the two system categories first, then bumps the counters past the 24 ids of the seed, then plans the pre-load', () => {
      const ops = outcome.changeSets?.[0]?.ops ?? [];

      expect(ops.slice(0, 3).map((op) => op.kind)).toEqual(['putFoodCategory', 'putRecipeCategory', 'putCounters']);
      expect(ops[2]).toEqual({ kind: 'putCounters', row: { nextId: 27, nextSeq: 1 } });
      expect(ops.at(-1)).toEqual({ kind: 'putSettings', row: { simulatedToday: null, bootstrapped: true } });
    });

    it('gives a legal store that is bootstrapped: both Others, 8 Food Types, 6 recipes, ids from 3, no batch and no threshold', () => {
      const seeded = settle(EMPTY_SNAPSHOT, outcome);

      expect(seeded.settings.bootstrapped).toBe(true);
      expect(seeded.foodCategories.slice(0, 1).map((category) => category.id)).toEqual([SYSTEM_IDS.FOOD_OTHER]);
      expect(seeded.recipeCategories.slice(0, 1).map((cuisine) => cuisine.id)).toEqual([SYSTEM_IDS.CUISINE_OTHER]);
      expect(seeded.foodTypes).toHaveLength(8);
      expect(seeded.recipes).toHaveLength(6);
      expect(seeded.foodTypes[0]?.id).toBe(13);
      expect(seeded.batches).toEqual([]);
      expect(seeded.counters).toEqual({ nextId: 27, nextSeq: 1 });
    });

    it('reserves the ids from the counters of the snapshot it is given, whatever they are', () => {
      const later = buildSnapshot({ counters: { nextId: 100, nextSeq: 7 } });

      const seeded = settle(later, valueOf(coordinator.bootstrap(APPENDIX_A_SEED, later)));

      expect(seeded.foodTypes[0]?.id).toBe(100 + 7 + 3 + 0);
      expect(seeded.counters).toEqual({ nextId: 124, nextSeq: 7 });
    });

    it('adds no system category that is there already, and still seeds', () => {
      const withOthers = buildSnapshot();

      const ops = valueOf(coordinator.bootstrap(APPENDIX_A_SEED, withOthers)).changeSets?.[0]?.ops ?? [];

      expect(ops[0]?.kind).toBe('putCounters');
      expect(ops.filter((op) => op.kind === 'putFoodCategory' && op.row.isSystem)).toEqual([]);
    });

    it('is refused when the seed is not one, with the code of the parser, and nothing is planned', () => {
      expect(errorOf(coordinator.bootstrap(null, EMPTY_SNAPSHOT)).code).toBe('BAD_SEED');
      expect(errorOf(coordinator.bootstrap({ ...APPENDIX_A_SEED, foodTypes: [...APPENDIX_A_SEED.foodTypes, APPENDIX_A_SEED.foodTypes[0]] }, EMPTY_SNAPSHOT)).code).toBe(
        'DUP_SEED_KEY',
      );
      const badCategory = { ...APPENDIX_A_SEED, foodCategories: [{ key: 'orphan', name: 'Orphan', parentKey: 'nobody' }] };
      expect(errorOf(coordinator.bootstrap(badCategory, EMPTY_SNAPSHOT)).code).toBe('SEED_BAD_CATEGORY');
      const badFoodType = {
        ...APPENDIX_A_SEED,
        recipes: [{ key: 'soup', name: 'Soup', cuisineKey: null, ingredients: [{ foodTypeKey: 'nobody', quantity: 1_000, unit: 'grams' }] }],
      };
      expect(errorOf(coordinator.bootstrap(badFoodType, EMPTY_SNAPSHOT)).code).toBe('SEED_BAD_FOODTYPE');
    });
  });

  describe('setSimulatedToday', () => {
    it('sets the date, with no payload and no counter; the settings row keeps the store bootstrapped (SettingsDecider)', () => {
      const outcome = valueOf(coordinator.handle({ type: 'SetSimulatedToday', payload: { date: '2026-10-05' } }, snapshot));

      expect(outcome).toEqual({ changeSets: [{ ops: [{ kind: 'putSettings', row: { simulatedToday: '2026-10-05', bootstrapped: true } }] }], payload: undefined });
    });

    it('clears it with null', () => {
      const outcome = valueOf(coordinator.handle({ type: 'SetSimulatedToday', payload: { date: null } }, snapshot));

      expect(settle(snapshot, outcome).settings.simulatedToday).toBeNull();
    });
  });

  describe('saveCategory', () => {
    const save = (payload: { scope: 'foodCategory' | 'cuisine'; categoryId: number | null; parentId: number | null; name: string }) =>
      coordinator.handle({ type: 'SaveCategory', payload }, snapshot);

    it('creates a Parent: it takes the next id, bumps the counters, and answers with the id', () => {
      const outcome = valueOf(save({ scope: 'foodCategory', categoryId: null, parentId: null, name: 'Fruit' }));

      expect(outcome.payload).toEqual({ categoryId: NEXT_ID });
      expect(outcome.changeSets).toEqual([
        {
          ops: [
            { kind: 'putCounters', row: { nextId: NEXT_ID + 1, nextSeq: snapshot.counters.nextSeq } },
            { kind: 'putFoodCategory', row: { id: NEXT_ID, name: 'Fruit', parentId: null, isSystem: false, customThresholdDays: null } },
          ],
        },
      ]);
      expect(settle(snapshot, outcome).foodCategories.at(-1)?.name).toBe('Fruit');
    });

    it('creates a Child under a Parent, and a cuisine', () => {
      const child = valueOf(save({ scope: 'foodCategory', categoryId: null, parentId: DAIRY, name: 'Liquid Dairy' }));
      const cuisine = valueOf(save({ scope: 'cuisine', categoryId: null, parentId: null, name: 'French Cuisine' }));

      expect(settle(snapshot, child).foodCategories.at(-1)).toMatchObject({ name: 'Liquid Dairy', parentId: DAIRY });
      expect(settle(snapshot, cuisine).recipeCategories.at(-1)).toMatchObject({ name: 'French Cuisine', isSystem: false });
    });

    it('renames in place: no id is reserved, so the counters are not touched, and it answers with the id it was given', () => {
      const outcome = valueOf(save({ scope: 'foodCategory', categoryId: MEAT, parentId: null, name: 'Meats' }));

      expect(outcome.payload).toEqual({ categoryId: MEAT });
      expect(outcome.changeSets).toEqual([
        { ops: [{ kind: 'putFoodCategory', row: { id: MEAT, name: 'Meats', parentId: null, isSystem: false, customThresholdDays: 5 } }] },
      ]);
    });

    it('lets a category be renamed to the same name in another case: the record itself is left out of the duplicate check', () => {
      expect(settle(snapshot, valueOf(save({ scope: 'foodCategory', categoryId: MEAT, parentId: null, name: 'MEAT' }))).foodCategories[1]?.name).toBe('MEAT');
    });

    it('keeps the two trees apart: a cuisine may have the name of a food category', () => {
      expect(save({ scope: 'cuisine', categoryId: null, parentId: null, name: 'Meat' }).ok).toBe(true);
    });

    it('refuses a bad name with its code, and does not get as far as the decider (NAME_EMPTY, NAME_TOO_LONG, NAME_DUPLICATE, NAME_RESERVED)', () => {
      const code = (name: string) => errorOf(save({ scope: 'foodCategory', categoryId: null, parentId: null, name })).code;

      expect(code('   ')).toBe('NAME_EMPTY');
      expect(code('x'.repeat(201))).toBe('NAME_TOO_LONG');
      expect(code('meat')).toBe('NAME_DUPLICATE');
      expect(code('Other')).toBe('NAME_RESERVED');
      expect(errorOf(save({ scope: 'cuisine', categoryId: null, parentId: null, name: ' OTHER ' })).code).toBe('NAME_RESERVED');
    });

    it('judges the name before the Parent: an empty name under a Parent that is not there is NAME_EMPTY', () => {
      expect(errorOf(save({ scope: 'foodCategory', categoryId: null, parentId: 999, name: '' })).code).toBe('NAME_EMPTY');
    });

    it('refuses a Child under Other or under a Child (PARENT_INVALID) and under a category that is not there (CATEGORY_NOT_FOUND)', () => {
      const under = (parentId: number) => errorOf(save({ scope: 'foodCategory', categoryId: null, parentId, name: 'Snacks' })).code;

      expect(under(SYSTEM_IDS.FOOD_OTHER)).toBe('PARENT_INVALID');
      expect(under(POULTRY)).toBe('PARENT_INVALID');
      expect(under(999)).toBe('CATEGORY_NOT_FOUND');
    });

    it('refuses to rename Other (SYSTEM_PROTECTED) and a category that is not there (CATEGORY_NOT_FOUND)', () => {
      expect(errorOf(save({ scope: 'foodCategory', categoryId: SYSTEM_IDS.FOOD_OTHER, parentId: null, name: 'Misc' })).code).toBe('SYSTEM_PROTECTED');
      expect(errorOf(save({ scope: 'cuisine', categoryId: SYSTEM_IDS.CUISINE_OTHER, parentId: null, name: 'Misc' })).code).toBe('SYSTEM_PROTECTED');
      expect(errorOf(save({ scope: 'foodCategory', categoryId: 999, parentId: null, name: 'Misc' })).code).toBe('CATEGORY_NOT_FOUND');
    });
  });

  describe('deleteCategory', () => {
    it('moves what the category held to Other, drops the Children, and has no payload and no counter', () => {
      const outcome = valueOf(coordinator.handle({ type: 'DeleteCategory', payload: { scope: 'foodCategory', categoryId: MEAT } }, snapshot));
      const after = settle(snapshot, outcome);

      expect(outcome.payload).toBeUndefined();
      expect(outcome.changeSets?.[0]?.ops.some((op) => op.kind === 'putCounters')).toBe(false);
      expect(after.foodTypes.find((foodType) => foodType.id === CHICKEN)?.categoryId).toBe(SYSTEM_IDS.FOOD_OTHER);
      expect(after.foodCategories.map((category) => category.id)).toEqual([SYSTEM_IDS.FOOD_OTHER, DAIRY]);
    });

    it('deletes a cuisine and moves its recipes to the cuisine Other', () => {
      const after = settle(snapshot, valueOf(coordinator.handle({ type: 'DeleteCategory', payload: { scope: 'cuisine', categoryId: CHINESE } }, snapshot)));

      expect(after.recipes[0]?.recipeCategoryId).toBe(SYSTEM_IDS.CUISINE_OTHER);
    });

    it('refuses Other (SYSTEM_PROTECTED) and a category that is not there (CATEGORY_NOT_FOUND)', () => {
      const code = (scope: 'foodCategory' | 'cuisine', categoryId: number) =>
        errorOf(coordinator.handle({ type: 'DeleteCategory', payload: { scope, categoryId } }, snapshot)).code;

      expect(code('foodCategory', SYSTEM_IDS.FOOD_OTHER)).toBe('SYSTEM_PROTECTED');
      expect(code('cuisine', SYSTEM_IDS.CUISINE_OTHER)).toBe('SYSTEM_PROTECTED');
      expect(code('foodCategory', 999)).toBe('CATEGORY_NOT_FOUND');
    });
  });

  describe('setCategoryThreshold', () => {
    const set = (categoryId: number, thresholdDays: number | null) =>
      coordinator.handle({ type: 'SetCategoryThreshold', payload: { categoryId, thresholdDays } }, snapshot);

    it('sets a threshold on a Parent or a Child, which is validated first', () => {
      expect(settle(snapshot, valueOf(set(DAIRY, 4))).foodCategories.find((category) => category.id === DAIRY)?.customThresholdDays).toBe(4);
      expect(settle(snapshot, valueOf(set(POULTRY, 1))).foodCategories.find((category) => category.id === POULTRY)?.customThresholdDays).toBe(1);
    });

    it('clears it with null, without asking ScalarValidator about a value', () => {
      const cleared = settle(snapshot, valueOf(set(MEAT, null)));

      expect(cleared.foodCategories.find((category) => category.id === MEAT)?.customThresholdDays).toBeNull();
    });

    it('has no payload and no counter', () => {
      const outcome = valueOf(set(DAIRY, 4));

      expect(outcome.payload).toBeUndefined();
      expect(outcome.changeSets).toHaveLength(1);
      expect(outcome.changeSets?.[0]?.ops).toHaveLength(1);
    });

    it('refuses a threshold that is not a whole number of days of at least 1 (THRESHOLD_INVALID)', () => {
      for (const days of [0, -1, 1.5, 2 ** 60]) expect(errorOf(set(DAIRY, days)).code, `${days} days`).toBe('THRESHOLD_INVALID');
    });

    it('judges the threshold before the category: an invalid threshold on a category that is not there is THRESHOLD_INVALID', () => {
      expect(errorOf(set(999, 0)).code).toBe('THRESHOLD_INVALID');
    });

    it('refuses Other and a cuisine (THRESHOLD_FORBIDDEN), and a category that is not there (CATEGORY_NOT_FOUND)', () => {
      expect(errorOf(set(SYSTEM_IDS.FOOD_OTHER, 3)).code).toBe('THRESHOLD_FORBIDDEN');
      expect(errorOf(set(CHINESE, 3)).code).toBe('THRESHOLD_FORBIDDEN');
      expect(errorOf(set(999, 3)).code).toBe('CATEGORY_NOT_FOUND');
    });
  });

  describe('saveFoodType', () => {
    const save = (payload: { foodTypeId: number | null; name: string; categoryId: number | null; unit: string | null; thresholdDays: number | null }) =>
      coordinator.handle({ type: 'SaveFoodType', payload }, snapshot);
    const create = (over: Partial<Parameters<typeof save>[0]> = {}) =>
      save({ foodTypeId: null, name: 'Salt', categoryId: null, unit: 'grams', thresholdDays: null, ...over });

    it('creates a Food Type in Other by default: the next id, the counters bumped, the id in the answer, and no batch', () => {
      const outcome = valueOf(create());

      expect(outcome.payload).toEqual({ foodTypeId: NEXT_ID });
      expect(outcome.changeSets).toEqual([
        {
          ops: [
            { kind: 'putCounters', row: { nextId: NEXT_ID + 1, nextSeq: snapshot.counters.nextSeq } },
            { kind: 'putFoodType', row: { id: NEXT_ID, name: 'Salt', categoryId: SYSTEM_IDS.FOOD_OTHER, unit: 'grams', customThresholdDays: null } },
          ],
        },
      ]);
      expect(settle(snapshot, outcome).batches).toEqual(snapshot.batches);
    });

    it('creates a Food Type in a category, with a threshold of its own', () => {
      const after = settle(snapshot, valueOf(create({ name: 'Duck', categoryId: POULTRY, thresholdDays: 2 })));

      expect(after.foodTypes.at(-1)).toMatchObject({ name: 'Duck', categoryId: POULTRY, customThresholdDays: 2 });
    });

    it('edits a Food Type: no id is reserved, the answer is the id it was given, and the unit is never changed', () => {
      const outcome = valueOf(save({ foodTypeId: MILK, name: 'Oat Milk', categoryId: DAIRY, unit: 'kg', thresholdDays: 3 }));
      const after = settle(snapshot, outcome);

      expect(outcome.payload).toEqual({ foodTypeId: MILK });
      expect(outcome.changeSets?.[0]?.ops).toHaveLength(1);
      expect(after.foodTypes.find((foodType) => foodType.id === MILK)).toEqual({
        id: MILK,
        name: 'Oat Milk',
        categoryId: DAIRY,
        unit: 'ml',
        customThresholdDays: 3,
      });
    });

    it('does not ask for a unit when it edits: the unit field is not looked at', () => {
      expect(save({ foodTypeId: MILK, name: 'Milk', categoryId: null, unit: null, thresholdDays: null }).ok).toBe(true);
      expect(save({ foodTypeId: MILK, name: 'Milk', categoryId: null, unit: 'not a unit', thresholdDays: null }).ok).toBe(true);
    });

    it('lets a Food Type keep its own name, in another case, when it is edited', () => {
      expect(save({ foodTypeId: MILK, name: 'MILK', categoryId: null, unit: null, thresholdDays: null }).ok).toBe(true);
    });

    it('refuses a bad name with its code (NAME_EMPTY, NAME_TOO_LONG, NAME_DUPLICATE) and, on an edit, the name of another Food Type', () => {
      expect(errorOf(create({ name: '' })).code).toBe('NAME_EMPTY');
      expect(errorOf(create({ name: 'x'.repeat(201) })).code).toBe('NAME_TOO_LONG');
      expect(errorOf(create({ name: 'chicken' })).code).toBe('NAME_DUPLICATE');
      expect(errorOf(save({ foodTypeId: MILK, name: 'Rice', categoryId: null, unit: null, thresholdDays: null })).code).toBe('NAME_DUPLICATE');
    });

    it('validates the threshold only when the command carries one: null passes and a bad number is THRESHOLD_INVALID', () => {
      expect(create({ thresholdDays: null }).ok).toBe(true);
      expect(errorOf(create({ thresholdDays: 0 })).code).toBe('THRESHOLD_INVALID');
      expect(errorOf(save({ foodTypeId: MILK, name: 'Milk', categoryId: null, unit: null, thresholdDays: -2 })).code).toBe('THRESHOLD_INVALID');
    });

    it('needs a unit to create, spelled as in the list (UNIT_UNKNOWN)', () => {
      expect(errorOf(create({ unit: null })).code).toBe('UNIT_UNKNOWN');
      expect(errorOf(create({ unit: 'KG' })).code).toBe('UNIT_UNKNOWN');
      expect(errorOf(create({ unit: '' })).code).toBe('UNIT_UNKNOWN');
    });

    it('refuses a category that is not in the food tree (CATEGORY_NOT_FOUND) and a Food Type that is not there (FOOD_TYPE_NOT_FOUND)', () => {
      expect(errorOf(create({ categoryId: 999 })).code).toBe('CATEGORY_NOT_FOUND');
      expect(errorOf(create({ categoryId: CHINESE })).code).toBe('CATEGORY_NOT_FOUND');
      expect(errorOf(save({ foodTypeId: 999, name: 'Ghost', categoryId: null, unit: null, thresholdDays: null })).code).toBe('FOOD_TYPE_NOT_FOUND');
    });

    it('checks in the order name, threshold, unit, category', () => {
      expect(errorOf(create({ name: '', thresholdDays: 0, unit: null, categoryId: 999 })).code).toBe('NAME_EMPTY');
      expect(errorOf(create({ thresholdDays: 0, unit: null, categoryId: 999 })).code).toBe('THRESHOLD_INVALID');
      expect(errorOf(create({ unit: null, categoryId: 999 })).code).toBe('UNIT_UNKNOWN');
      expect(errorOf(create({ categoryId: 999 })).code).toBe('CATEGORY_NOT_FOUND');
    });
  });

  describe('deleteFoodType', () => {
    const remove = (foodTypeId: number) => coordinator.handle({ type: 'DeleteFoodType', payload: { foodTypeId } }, snapshot);

    it('deletes a Food Type with no batch and stamps its name on the recipe rows that use it', () => {
      const outcome = valueOf(remove(RICE));
      const after = settle(snapshot, outcome);

      expect(outcome.payload).toBeUndefined();
      expect(after.foodTypes.some((foodType) => foodType.id === RICE)).toBe(false);
      expect(after.recipeIngredients.find((row) => row.foodTypeId === RICE)?.deletedFoodTypeName).toBe('Rice');
    });

    it('refuses a Food Type that has a batch (HAS_BATCHES) and one that is not there (FOOD_TYPE_NOT_FOUND)', () => {
      expect(errorOf(remove(CHICKEN))).toMatchObject({ code: 'HAS_BATCHES', detail: 'Remove the 1 batch first' });
      expect(errorOf(remove(999)).code).toBe('FOOD_TYPE_NOT_FOUND');
    });
  });

  it('handles each of its six commands, and leaves the snapshot it was given as it was', () => {
    const before = structuredClone(snapshot);

    for (const command of [
      { type: 'SetSimulatedToday', payload: { date: null } },
      { type: 'SaveCategory', payload: { scope: 'cuisine', categoryId: null, parentId: null, name: 'French Cuisine' } },
      { type: 'DeleteCategory', payload: { scope: 'cuisine', categoryId: CHINESE } },
      { type: 'SetCategoryThreshold', payload: { categoryId: DAIRY, thresholdDays: 2 } },
      { type: 'SaveFoodType', payload: { foodTypeId: null, name: 'Salt', categoryId: null, unit: 'grams', thresholdDays: null } },
      { type: 'DeleteFoodType', payload: { foodTypeId: RICE } },
    ] as const) {
      expect(coordinator.handle(command, snapshot).ok, command.type).toBe(true);
    }

    expect(snapshot).toEqual(before);
  });
});
