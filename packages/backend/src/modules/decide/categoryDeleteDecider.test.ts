import { describe, expect, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import {
  buildBatch,
  buildFoodCategory,
  buildFoodType,
  buildIngredient,
  buildRecipe,
  buildRecipeCategory,
  buildSnapshot,
} from '../../testing/fixtures';
import { snapshotInvariantChecker } from '../engine/snapshotInvariantChecker';
import { thresholdResolver } from '../foundation/thresholdResolver';
import { changeSetApplier } from '../state/changeSetApplier';
import { categoryDeleteDecider } from './categoryDeleteDecider';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

const [MEAT, RED_MEAT, POULTRY, DAIRY, LIQUID_DAIRY, EMPTY_PARENT] = [10, 11, 12, 13, 14, 15];
const [CHINESE, FRENCH] = [20, 21];
const [BEEF, CHICKEN, PORK, MILK, BUTTER, RICE, SALT] = [30, 31, 32, 33, 34, 35, 36];

/**
 * The food tree: Meat (10, 5 days) has Red Meat (11, 2 days) and Poultry (12); Dairy (13) has Liquid Dairy (14);
 * Empty Parent (15) has nothing in it. Beef is in Red Meat, Chicken and Salt are in Poultry (Salt has a threshold of
 * 7 days of its own), Pork is directly in Meat, Milk is in Liquid Dairy, Butter is directly in Dairy and Rice is in Other.
 * Beef and Chicken have a batch each. The cuisines are Chinese (20) with two recipes and French (21) with one.
 */
const snapshot = buildSnapshot({
  foodCategories: [
    buildFoodCategory({ id: MEAT, name: 'Meat', customThresholdDays: 5 }),
    buildFoodCategory({ id: RED_MEAT, name: 'Red Meat', parentId: MEAT, customThresholdDays: 2 }),
    buildFoodCategory({ id: POULTRY, name: 'Poultry', parentId: MEAT }),
    buildFoodCategory({ id: DAIRY, name: 'Dairy' }),
    buildFoodCategory({ id: LIQUID_DAIRY, name: 'Liquid Dairy', parentId: DAIRY }),
    buildFoodCategory({ id: EMPTY_PARENT, name: 'Empty Parent' }),
  ],
  recipeCategories: [buildRecipeCategory({ id: CHINESE, name: 'Chinese Cuisine' }), buildRecipeCategory({ id: FRENCH, name: 'French Cuisine' })],
  foodTypes: [
    buildFoodType({ id: BEEF, name: 'Beef', categoryId: RED_MEAT }),
    buildFoodType({ id: CHICKEN, name: 'Chicken', categoryId: POULTRY }),
    buildFoodType({ id: PORK, name: 'Pork', categoryId: MEAT }),
    buildFoodType({ id: MILK, name: 'Milk', categoryId: LIQUID_DAIRY, unit: 'ml' }),
    buildFoodType({ id: BUTTER, name: 'Butter', categoryId: DAIRY }),
    buildFoodType({ id: RICE, name: 'Rice' }),
    buildFoodType({ id: SALT, name: 'Salt', categoryId: POULTRY, customThresholdDays: 7 }),
  ],
  batches: [buildBatch({ id: 40, foodTypeId: BEEF }), buildBatch({ id: 41, foodTypeId: CHICKEN })],
  recipes: [
    buildRecipe({ id: 50, name: 'Stir-Fry', recipeCategoryId: CHINESE }),
    buildRecipe({ id: 51, name: 'Fried Rice', recipeCategoryId: CHINESE }),
    buildRecipe({ id: 52, name: 'Gratin', recipeCategoryId: FRENCH }),
  ],
  recipeIngredients: [
    buildIngredient({ recipeId: 50, foodTypeId: BEEF }),
    buildIngredient({ recipeId: 51, foodTypeId: RICE }),
    buildIngredient({ recipeId: 52, foodTypeId: MILK, requiredUnit: 'ml' }),
  ],
});

const foodTypeOf = (id: number) => snapshot.foodTypes.find((foodType) => foodType.id === id) ?? expect.unreachable(`no Food Type ${id}`);
/** The put that moves a Food Type of the snapshot to a category and changes nothing else about it. */
const foodTypeIn = (id: number, categoryId: number) => ({ kind: 'putFoodType', row: { ...foodTypeOf(id), categoryId } });
const recipeIn = (id: number, recipeCategoryId: number) => ({
  kind: 'putRecipe',
  row: { ...(snapshot.recipes.find((recipe) => recipe.id === id) ?? expect.unreachable(`no recipe ${id}`)), recipeCategoryId },
});

describe('BC-22 CategoryDeleteDecider', () => {
  describe('a Parent food category (exception row 9)', () => {
    const changeSet = valueOf(categoryDeleteDecider('foodCategory', MEAT, snapshot));

    it('moves the Food Types of the Parent and of every Child to Other, then deletes the Children and the Parent', () => {
      expect(changeSet).toEqual({
        ops: [
          foodTypeIn(BEEF, SYSTEM_IDS.FOOD_OTHER), // from Red Meat, a Child
          foodTypeIn(CHICKEN, SYSTEM_IDS.FOOD_OTHER), // from Poultry, a Child
          foodTypeIn(PORK, SYSTEM_IDS.FOOD_OTHER), // from Meat itself
          foodTypeIn(SALT, SYSTEM_IDS.FOOD_OTHER),
          { kind: 'deleteFoodCategory', id: RED_MEAT },
          { kind: 'deleteFoodCategory', id: POULTRY },
          { kind: 'deleteFoodCategory', id: MEAT },
        ],
      });
    });

    it('finds the Children wherever they stand in the list: it does not rely on the order of the categories', () => {
      const childrenFirst = {
        ...snapshot,
        foodCategories: [
          ...snapshot.foodCategories.filter((candidate) => candidate.parentId === MEAT),
          ...snapshot.foodCategories.filter((candidate) => candidate.parentId !== MEAT),
        ],
      };

      expect(childrenFirst.foodCategories[0]?.parentId).toBe(MEAT);
      expect(valueOf(categoryDeleteDecider('foodCategory', MEAT, childrenFirst))).toEqual(changeSet);
    });

    it('leaves the other trees alone: Milk, Butter and Rice are not touched', () => {
      const touched = changeSet.ops.flatMap((op) => (op.kind === 'putFoodType' ? [op.row.id] : []));

      expect(touched).toEqual([BEEF, CHICKEN, PORK, SALT]);
    });

    it('keeps each moved Food Type as it was but for its category: name, unit and its own threshold', () => {
      const next = valueOf(changeSetApplier(snapshot, changeSet));

      expect(next.foodTypes.find((foodType) => foodType.id === SALT)).toEqual({
        id: SALT,
        name: 'Salt',
        categoryId: SYSTEM_IDS.FOOD_OTHER,
        unit: 'grams',
        customThresholdDays: 7,
      });
      expect(next.foodTypes.map((foodType) => foodType.id)).toEqual(snapshot.foodTypes.map((foodType) => foodType.id));
    });

    it('moves no batch: they follow their Food Type, which holds the category (spec 4.1.3)', () => {
      expect(changeSet.ops.some((op) => op.kind === 'putBatch' || op.kind === 'deleteBatch')).toBe(false);
      expect(valueOf(changeSetApplier(snapshot, changeSet)).batches).toEqual(snapshot.batches);
    });

    it('drops the thresholds of the Parent and of its Children, so the moved Food Types derive T_eff again', () => {
      const before = thresholdResolver(snapshot);
      const after = thresholdResolver(valueOf(changeSetApplier(snapshot, changeSet)));

      expect(before[BEEF]).toEqual({ days: 2, source: 'child' }); // Red Meat's threshold won
      expect(before[PORK]).toEqual({ days: 5, source: 'parent' }); // Meat's
      expect(before[CHICKEN]).toEqual({ days: 5, source: 'parent' }); // Poultry has none, so Meat's is inherited
      expect(after[BEEF]).toEqual({ days: 3, source: 'global' });
      expect(after[PORK]).toEqual({ days: 3, source: 'global' });
      expect(after[CHICKEN]).toEqual({ days: 3, source: 'global' });
      expect(after[SALT]).toEqual({ days: 7, source: 'foodType' }); // its own threshold is not a category's, so it stays
    });

    it('leaves no record that points at a category that is gone: the invariant checker accepts the result', () => {
      const next = valueOf(changeSetApplier(snapshot, changeSet));

      expect(next.foodCategories.map((category) => category.id)).toEqual([SYSTEM_IDS.FOOD_OTHER, DAIRY, LIQUID_DAIRY, EMPTY_PARENT]);
      expect(snapshotInvariantChecker(next)).toEqual({ ok: true, value: next });
    });
  });

  describe('a Child food category (exception row 9)', () => {
    it('moves only its own Food Types to Other and deletes only the Child', () => {
      expect(valueOf(categoryDeleteDecider('foodCategory', RED_MEAT, snapshot))).toEqual({
        ops: [foodTypeIn(BEEF, SYSTEM_IDS.FOOD_OTHER), { kind: 'deleteFoodCategory', id: RED_MEAT }],
      });
    });

    it('leaves its Parent, its siblings and their Food Types where they are', () => {
      const next = valueOf(changeSetApplier(snapshot, valueOf(categoryDeleteDecider('foodCategory', RED_MEAT, snapshot))));

      expect(next.foodCategories.map((category) => category.id)).toEqual([SYSTEM_IDS.FOOD_OTHER, MEAT, POULTRY, DAIRY, LIQUID_DAIRY, EMPTY_PARENT]);
      expect(next.foodTypes.find((foodType) => foodType.id === CHICKEN)?.categoryId).toBe(POULTRY);
      expect(next.foodTypes.find((foodType) => foodType.id === PORK)?.categoryId).toBe(MEAT);
      expect(snapshotInvariantChecker(next).ok).toBe(true);
    });
  });

  it('deletes a category that holds nothing with a single operation', () => {
    expect(valueOf(categoryDeleteDecider('foodCategory', EMPTY_PARENT, snapshot))).toEqual({
      ops: [{ kind: 'deleteFoodCategory', id: EMPTY_PARENT }],
    });
  });

  describe('a cuisine (exception row 9)', () => {
    const changeSet = valueOf(categoryDeleteDecider('cuisine', CHINESE, snapshot));

    it('moves its recipes to the cuisine Other, then deletes the cuisine', () => {
      expect(changeSet).toEqual({
        ops: [recipeIn(50, SYSTEM_IDS.CUISINE_OTHER), recipeIn(51, SYSTEM_IDS.CUISINE_OTHER), { kind: 'deleteRecipeCategory', id: CHINESE }],
      });
    });

    it('keeps the recipes, their rows and the other cuisines, and the result is a legal state', () => {
      const next = valueOf(changeSetApplier(snapshot, changeSet));

      expect(next.recipes.map((recipe) => [recipe.id, recipe.recipeCategoryId])).toEqual([
        [50, SYSTEM_IDS.CUISINE_OTHER],
        [51, SYSTEM_IDS.CUISINE_OTHER],
        [52, FRENCH],
      ]);
      expect(next.recipeIngredients).toEqual(snapshot.recipeIngredients);
      expect(next.recipeCategories.map((cuisine) => cuisine.id)).toEqual([SYSTEM_IDS.CUISINE_OTHER, FRENCH]);
      expect(snapshotInvariantChecker(next)).toEqual({ ok: true, value: next });
    });

    it('does not touch a Food Type, whichever ids the two trees hold', () => {
      expect(changeSet.ops.some((op) => op.kind === 'putFoodType' || op.kind === 'deleteFoodCategory')).toBe(false);
    });

    it('deletes a cuisine with no recipe with a single operation', () => {
      const alone = buildSnapshot({ recipeCategories: [buildRecipeCategory({ id: 20, name: 'Vietnamese Cuisine' })] });

      expect(valueOf(categoryDeleteDecider('cuisine', 20, alone))).toEqual({ ops: [{ kind: 'deleteRecipeCategory', id: 20 }] });
    });
  });

  describe('SYSTEM_PROTECTED: Other cannot be deleted (spec 4.1.3)', () => {
    it('refuses the food category Other', () => {
      expect(errorOf(categoryDeleteDecider('foodCategory', SYSTEM_IDS.FOOD_OTHER, snapshot)).code).toBe('SYSTEM_PROTECTED');
    });

    it('refuses the cuisine Other', () => {
      expect(errorOf(categoryDeleteDecider('cuisine', SYSTEM_IDS.CUISINE_OTHER, snapshot)).code).toBe('SYSTEM_PROTECTED');
    });
  });

  describe('CATEGORY_NOT_FOUND', () => {
    it('refuses an id that is not a category', () => {
      expect(errorOf(categoryDeleteDecider('foodCategory', 999, snapshot)).code).toBe('CATEGORY_NOT_FOUND');
      expect(errorOf(categoryDeleteDecider('cuisine', 999, snapshot)).code).toBe('CATEGORY_NOT_FOUND');
    });

    it('looks in the tree that `scope` names, so a Parent id with the cuisine scope deletes nothing', () => {
      expect(errorOf(categoryDeleteDecider('cuisine', MEAT, snapshot)).code).toBe('CATEGORY_NOT_FOUND');
      expect(errorOf(categoryDeleteDecider('foodCategory', CHINESE, snapshot)).code).toBe('CATEGORY_NOT_FOUND');
    });
  });

  it('never edits the snapshot it is given', () => {
    const before = structuredClone(snapshot);

    categoryDeleteDecider('foodCategory', MEAT, snapshot);
    categoryDeleteDecider('cuisine', CHINESE, snapshot);
    categoryDeleteDecider('foodCategory', SYSTEM_IDS.FOOD_OTHER, snapshot);

    expect(snapshot).toEqual(before);
  });
});
