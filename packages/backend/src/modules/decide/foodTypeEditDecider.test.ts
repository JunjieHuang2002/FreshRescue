import { describe, expect, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result, ValidName, ValidThreshold } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import { buildBatch, buildFoodCategory, buildFoodType, buildRecipeCategory, buildSnapshot } from '../../testing/fixtures';
import { snapshotInvariantChecker } from '../engine/snapshotInvariantChecker';
import { thresholdResolver } from '../foundation/thresholdResolver';
import { changeSetApplier } from '../state/changeSetApplier';
import { foodTypeEditDecider } from './foodTypeEditDecider';

const name = (text: string): ValidName => text as ValidName;
const days = (count: number): ValidThreshold => count as ValidThreshold;
const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

const [MEAT, POULTRY, DAIRY, CHINESE, CHICKEN, MILK] = [10, 11, 12, 20, 30, 31];

/**
 * Chicken (30) is in Poultry (11), a Child of Meat (10, 5 days), with a threshold of 4 days of its own and a batch (40).
 * Milk (31) is in ml, in Other. Dairy (12) has 6 days. Chinese Cuisine (20) is a cuisine.
 */
const snapshot = buildSnapshot({
  foodCategories: [
    buildFoodCategory({ id: MEAT, name: 'Meat', customThresholdDays: 5 }),
    buildFoodCategory({ id: POULTRY, name: 'Poultry', parentId: MEAT }),
    buildFoodCategory({ id: DAIRY, name: 'Dairy', customThresholdDays: 6 }),
  ],
  recipeCategories: [buildRecipeCategory({ id: CHINESE, name: 'Chinese Cuisine' })],
  foodTypes: [
    buildFoodType({ id: CHICKEN, name: 'Chicken', categoryId: POULTRY, customThresholdDays: 4 }),
    buildFoodType({ id: MILK, name: 'Milk', unit: 'ml' }),
  ],
  batches: [buildBatch({ id: 40, foodTypeId: CHICKEN })],
});

describe('BC-25 FoodTypeEditDecider', () => {
  it('renames the Food Type and keeps its category, its unit and its threshold', () => {
    expect(valueOf(foodTypeEditDecider(CHICKEN, name('Hen'), POULTRY, days(4), snapshot))).toEqual({
      ops: [{ kind: 'putFoodType', row: { id: CHICKEN, name: 'Hen', categoryId: POULTRY, unit: 'grams', customThresholdDays: 4 } }],
    });
  });

  it('moves the Food Type to another category, a Parent or a Child', () => {
    const toParent = valueOf(foodTypeEditDecider(CHICKEN, name('Chicken'), DAIRY, days(4), snapshot));
    const toChild = valueOf(foodTypeEditDecider(MILK, name('Milk'), POULTRY, null, snapshot));

    expect(toParent.ops).toEqual([{ kind: 'putFoodType', row: expect.objectContaining({ id: CHICKEN, categoryId: DAIRY }) }]);
    expect(toChild.ops).toEqual([{ kind: 'putFoodType', row: expect.objectContaining({ id: MILK, categoryId: POULTRY }) }]);
  });

  it('moves the Food Type to Other when the category is null (spec section 3)', () => {
    expect(valueOf(foodTypeEditDecider(CHICKEN, name('Chicken'), null, days(4), snapshot)).ops).toEqual([
      { kind: 'putFoodType', row: expect.objectContaining({ id: CHICKEN, categoryId: SYSTEM_IDS.FOOD_OTHER }) },
    ]);
  });

  it('sets a threshold, replaces one, and clears one with null (spec 4.2.5)', () => {
    const set = valueOf(foodTypeEditDecider(MILK, name('Milk'), SYSTEM_IDS.FOOD_OTHER, days(2), snapshot));
    const replaced = valueOf(foodTypeEditDecider(CHICKEN, name('Chicken'), POULTRY, days(9), snapshot));
    const cleared = valueOf(foodTypeEditDecider(CHICKEN, name('Chicken'), POULTRY, null, snapshot));

    expect(set.ops).toEqual([{ kind: 'putFoodType', row: expect.objectContaining({ customThresholdDays: 2 }) }]);
    expect(replaced.ops).toEqual([{ kind: 'putFoodType', row: expect.objectContaining({ customThresholdDays: 9 }) }]);
    expect(cleared.ops).toEqual([{ kind: 'putFoodType', row: expect.objectContaining({ customThresholdDays: null }) }]);
  });

  it('never changes the unit: the unit is not an input, and it changes only with its batches (spec 4.2.2)', () => {
    const [op] = valueOf(foodTypeEditDecider(MILK, name('Oat Milk'), DAIRY, null, snapshot)).ops;

    expect(op).toMatchObject({ kind: 'putFoodType', row: { id: MILK, unit: 'ml' } });
  });

  it('writes one Food Type and nothing else: the batches follow it without an operation', () => {
    const changeSet = valueOf(foodTypeEditDecider(CHICKEN, name('Chicken'), DAIRY, null, snapshot));
    const next = valueOf(changeSetApplier(snapshot, changeSet));

    expect(changeSet.ops).toHaveLength(1);
    expect(next.batches).toEqual(snapshot.batches);
    expect(snapshotInvariantChecker(next)).toEqual({ ok: true, value: next });
  });

  it('re-derives T_eff for the batches at once when the category or the threshold changes (spec 4.2.5)', () => {
    const moved = valueOf(changeSetApplier(snapshot, valueOf(foodTypeEditDecider(CHICKEN, name('Chicken'), DAIRY, null, snapshot))));
    const cleared = valueOf(changeSetApplier(snapshot, valueOf(foodTypeEditDecider(CHICKEN, name('Chicken'), POULTRY, null, snapshot))));

    expect(thresholdResolver(snapshot)[CHICKEN]).toEqual({ days: 4, source: 'foodType' });
    expect(thresholdResolver(moved)[CHICKEN]).toEqual({ days: 6, source: 'parent' }); // Dairy's, and no longer its own
    expect(thresholdResolver(cleared)[CHICKEN]).toEqual({ days: 5, source: 'parent' }); // Poultry has none, so Meat's
  });

  describe('FOOD_TYPE_NOT_FOUND', () => {
    it('refuses an id that is not a Food Type', () => {
      expect(errorOf(foodTypeEditDecider(999, name('X'), null, null, snapshot)).code).toBe('FOOD_TYPE_NOT_FOUND');
    });

    it('does not take a category or a batch for a Food Type', () => {
      expect(errorOf(foodTypeEditDecider(MEAT, name('X'), null, null, snapshot)).code).toBe('FOOD_TYPE_NOT_FOUND');
      expect(errorOf(foodTypeEditDecider(40, name('X'), null, null, snapshot)).code).toBe('FOOD_TYPE_NOT_FOUND');
    });
  });

  describe('CATEGORY_NOT_FOUND', () => {
    it('refuses a category that is not in the food tree', () => {
      expect(errorOf(foodTypeEditDecider(CHICKEN, name('Chicken'), 999, null, snapshot)).code).toBe('CATEGORY_NOT_FOUND');
    });

    it('does not take a cuisine for a category', () => {
      expect(errorOf(foodTypeEditDecider(CHICKEN, name('Chicken'), CHINESE, null, snapshot)).code).toBe('CATEGORY_NOT_FOUND');
    });

    it('judges the Food Type first: a Food Type that is not there and a category that is not there is FOOD_TYPE_NOT_FOUND', () => {
      expect(errorOf(foodTypeEditDecider(999, name('X'), 999, null, snapshot)).code).toBe('FOOD_TYPE_NOT_FOUND');
    });
  });

  it('never edits the snapshot it is given', () => {
    const before = structuredClone(snapshot);

    foodTypeEditDecider(CHICKEN, name('Hen'), DAIRY, null, snapshot);
    foodTypeEditDecider(999, name('Hen'), DAIRY, null, snapshot);

    expect(snapshot).toEqual(before);
  });
});
