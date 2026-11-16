import { describe, expect, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result, ValidName } from '@freshrescue/contract-primitives';
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
import { changeSetApplier } from '../state/changeSetApplier';
import { categoryRenameDecider } from './categoryRenameDecider';

const name = (text: string): ValidName => text as ValidName;
const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

const MEAT = 10;
const POULTRY = 11;
const CHINESE = 20;

/** Meat (10) has a threshold of 5 days, Poultry (11) is its Child with 2; Chicken (30) is in Poultry with a batch (40); Fried Rice (50) is a Chinese Cuisine (20) recipe. */
const snapshot = buildSnapshot({
  foodCategories: [
    buildFoodCategory({ id: MEAT, name: 'Meat', customThresholdDays: 5 }),
    buildFoodCategory({ id: POULTRY, name: 'Poultry', parentId: MEAT, customThresholdDays: 2 }),
  ],
  recipeCategories: [buildRecipeCategory({ id: CHINESE, name: 'Chinese Cuisine' })],
  foodTypes: [buildFoodType({ id: 30, name: 'Chicken', categoryId: POULTRY })],
  batches: [buildBatch({ id: 40, foodTypeId: 30 })],
  recipes: [buildRecipe({ id: 50, name: 'Fried Rice', recipeCategoryId: CHINESE })],
  recipeIngredients: [buildIngredient({ recipeId: 50, foodTypeId: 30 })],
});

describe('BC-21 CategoryRenameDecider', () => {
  it('renames a Parent and keeps everything else about it: its threshold, its place, its flags', () => {
    expect(valueOf(categoryRenameDecider('foodCategory', MEAT, name('Meats'), snapshot))).toEqual({
      ops: [{ kind: 'putFoodCategory', row: { id: MEAT, name: 'Meats', parentId: null, isSystem: false, customThresholdDays: 5 } }],
    });
  });

  it('renames a Child and keeps its Parent and its threshold', () => {
    expect(valueOf(categoryRenameDecider('foodCategory', POULTRY, name('Birds'), snapshot))).toEqual({
      ops: [{ kind: 'putFoodCategory', row: { id: POULTRY, name: 'Birds', parentId: MEAT, isSystem: false, customThresholdDays: 2 } }],
    });
  });

  it('renames a cuisine', () => {
    expect(valueOf(categoryRenameDecider('cuisine', CHINESE, name('Cantonese Cuisine'), snapshot))).toEqual({
      ops: [{ kind: 'putRecipeCategory', row: { id: CHINESE, name: 'Cantonese Cuisine', isSystem: false } }],
    });
  });

  it('is a rename to the same name in another case, which NameValidator allows (spec section 3)', () => {
    expect(valueOf(categoryRenameDecider('foodCategory', MEAT, name('MEAT'), snapshot)).ops).toEqual([
      { kind: 'putFoodCategory', row: expect.objectContaining({ id: MEAT, name: 'MEAT' }) },
    ]);
  });

  it('leaves every Food Type, batch and recipe bound to the category (spec exception row 8)', () => {
    const next = valueOf(changeSetApplier(snapshot, valueOf(categoryRenameDecider('foodCategory', POULTRY, name('Birds'), snapshot))));
    const nextCuisine = valueOf(changeSetApplier(snapshot, valueOf(categoryRenameDecider('cuisine', CHINESE, name('Cantonese Cuisine'), snapshot))));

    expect(next.foodCategories.map((category) => [category.id, category.name])).toEqual([[1, 'Other'], [MEAT, 'Meat'], [POULTRY, 'Birds']]);
    expect(next.foodTypes).toEqual(snapshot.foodTypes);
    expect(next.batches).toEqual(snapshot.batches);
    expect(nextCuisine.recipes).toEqual(snapshot.recipes);
    expect(snapshotInvariantChecker(next).ok).toBe(true);
    expect(snapshotInvariantChecker(nextCuisine).ok).toBe(true);
  });

  describe('CATEGORY_NOT_FOUND', () => {
    it('refuses an id that is not a category', () => {
      expect(errorOf(categoryRenameDecider('foodCategory', 999, name('X'), snapshot)).code).toBe('CATEGORY_NOT_FOUND');
      expect(errorOf(categoryRenameDecider('cuisine', 999, name('X'), snapshot)).code).toBe('CATEGORY_NOT_FOUND');
    });

    it('looks in the tree that `scope` names: a cuisine id is not a food category, nor the other way round', () => {
      expect(errorOf(categoryRenameDecider('foodCategory', CHINESE, name('X'), snapshot)).code).toBe('CATEGORY_NOT_FOUND');
      expect(errorOf(categoryRenameDecider('cuisine', MEAT, name('X'), snapshot)).code).toBe('CATEGORY_NOT_FOUND');
    });
  });

  describe('SYSTEM_PROTECTED: Other cannot be renamed (spec 4.1.2)', () => {
    it('refuses the food category Other', () => {
      const error = errorOf(categoryRenameDecider('foodCategory', SYSTEM_IDS.FOOD_OTHER, name('Misc'), snapshot));

      expect(error.code).toBe('SYSTEM_PROTECTED');
      expect(error.detail).toContain('Other');
    });

    it('refuses the cuisine Other', () => {
      expect(errorOf(categoryRenameDecider('cuisine', SYSTEM_IDS.CUISINE_OTHER, name('Misc'), snapshot)).code).toBe('SYSTEM_PROTECTED');
    });
  });

  it('never edits the snapshot it is given', () => {
    const before = structuredClone(snapshot);

    categoryRenameDecider('foodCategory', MEAT, name('Meats'), snapshot);
    categoryRenameDecider('foodCategory', SYSTEM_IDS.FOOD_OTHER, name('Misc'), snapshot);

    expect(snapshot).toEqual(before);
  });
});
