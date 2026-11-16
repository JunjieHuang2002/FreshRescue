import { describe, expect, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result, ValidThreshold } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import { buildFoodCategory, buildFoodType, buildRecipeCategory, buildSnapshot } from '../../testing/fixtures';
import { snapshotInvariantChecker } from '../engine/snapshotInvariantChecker';
import { thresholdResolver } from '../foundation/thresholdResolver';
import { changeSetApplier } from '../state/changeSetApplier';
import { categoryThresholdDecider } from './categoryThresholdDecider';

const days = (count: number): ValidThreshold => count as ValidThreshold;
const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

const [MEAT, POULTRY, DAIRY, CHINESE, CHICKEN] = [10, 11, 12, 20, 30];

/** Meat (10) has a threshold of 5 days, its Child Poultry (11) has 2, Dairy (12) has none; Chicken (30) is in Poultry; Chinese Cuisine (20) is a cuisine. */
const snapshot = buildSnapshot({
  foodCategories: [
    buildFoodCategory({ id: MEAT, name: 'Meat', customThresholdDays: 5 }),
    buildFoodCategory({ id: POULTRY, name: 'Poultry', parentId: MEAT, customThresholdDays: 2 }),
    buildFoodCategory({ id: DAIRY, name: 'Dairy' }),
  ],
  recipeCategories: [buildRecipeCategory({ id: CHINESE, name: 'Chinese Cuisine' })],
  foodTypes: [buildFoodType({ id: CHICKEN, name: 'Chicken', categoryId: POULTRY })],
});

describe('BC-23 CategoryThresholdDecider', () => {
  it('sets the threshold of a Parent that had none, and changes nothing else about it', () => {
    expect(valueOf(categoryThresholdDecider(DAIRY, days(4), snapshot))).toEqual({
      ops: [{ kind: 'putFoodCategory', row: { id: DAIRY, name: 'Dairy', parentId: null, isSystem: false, customThresholdDays: 4 } }],
    });
  });

  it('sets the threshold of a Child, and keeps its Parent', () => {
    expect(valueOf(categoryThresholdDecider(POULTRY, days(1), snapshot))).toEqual({
      ops: [{ kind: 'putFoodCategory', row: { id: POULTRY, name: 'Poultry', parentId: MEAT, isSystem: false, customThresholdDays: 1 } }],
    });
  });

  it('replaces a threshold that is already set', () => {
    const [op] = valueOf(categoryThresholdDecider(MEAT, days(9), snapshot)).ops;

    expect(op).toMatchObject({ kind: 'putFoodCategory', row: { id: MEAT, customThresholdDays: 9 } });
  });

  it('clears the threshold with null, which reverts the category to inheritance (spec 4.1.5)', () => {
    expect(valueOf(categoryThresholdDecider(POULTRY, null, snapshot))).toEqual({
      ops: [{ kind: 'putFoodCategory', row: { id: POULTRY, name: 'Poultry', parentId: MEAT, isSystem: false, customThresholdDays: null } }],
    });
  });

  it('changes T_eff of the Food Types in the category at once, with nothing written to them (spec 4.3.1, 4.6)', () => {
    const set = valueOf(changeSetApplier(snapshot, valueOf(categoryThresholdDecider(POULTRY, days(1), snapshot))));
    const cleared = valueOf(changeSetApplier(snapshot, valueOf(categoryThresholdDecider(POULTRY, null, snapshot))));

    expect(thresholdResolver(snapshot)[CHICKEN]).toEqual({ days: 2, source: 'child' });
    expect(thresholdResolver(set)[CHICKEN]).toEqual({ days: 1, source: 'child' });
    expect(thresholdResolver(cleared)[CHICKEN]).toEqual({ days: 5, source: 'parent' }); // inherits from Meat again
    expect(set.foodTypes).toEqual(snapshot.foodTypes);
    expect(snapshotInvariantChecker(set).ok && snapshotInvariantChecker(cleared).ok).toBe(true);
  });

  describe('THRESHOLD_FORBIDDEN: only a Parent or a Child can carry one', () => {
    it('refuses the system category Other, set or clear (spec 1.2)', () => {
      expect(errorOf(categoryThresholdDecider(SYSTEM_IDS.FOOD_OTHER, days(4), snapshot)).code).toBe('THRESHOLD_FORBIDDEN');
      expect(errorOf(categoryThresholdDecider(SYSTEM_IDS.FOOD_OTHER, null, snapshot)).code).toBe('THRESHOLD_FORBIDDEN');
    });

    it('refuses a cuisine, which is not a food category (blueprint 3.2: refused for Other and for cuisines)', () => {
      expect(errorOf(categoryThresholdDecider(CHINESE, days(4), snapshot))).toMatchObject({ code: 'THRESHOLD_FORBIDDEN' });
      expect(errorOf(categoryThresholdDecider(SYSTEM_IDS.CUISINE_OTHER, days(4), snapshot)).code).toBe('THRESHOLD_FORBIDDEN');
    });
  });

  describe('CATEGORY_NOT_FOUND', () => {
    it('refuses an id that is no category in either tree', () => {
      expect(errorOf(categoryThresholdDecider(999, days(4), snapshot)).code).toBe('CATEGORY_NOT_FOUND');
    });

    it('does not take a Food Type for a category', () => {
      expect(errorOf(categoryThresholdDecider(CHICKEN, days(4), snapshot)).code).toBe('CATEGORY_NOT_FOUND');
    });
  });

  it('never edits the snapshot it is given', () => {
    const before = structuredClone(snapshot);

    categoryThresholdDecider(MEAT, days(9), snapshot);
    categoryThresholdDecider(MEAT, null, snapshot);
    categoryThresholdDecider(SYSTEM_IDS.FOOD_OTHER, days(9), snapshot);

    expect(snapshot).toEqual(before);
  });
});
