import { describe, expect, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result, ValidName } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import { buildFoodCategory, buildRecipeCategory, buildSnapshot } from '../../testing/fixtures';
import { snapshotInvariantChecker } from '../engine/snapshotInvariantChecker';
import { idAllocator } from '../foundation/idAllocator';
import { changeSetApplier } from '../state/changeSetApplier';
import { categoryCreateDecider } from './categoryCreateDecider';

const name = (text: string): ValidName => text as ValidName;
const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

const MEAT = 10;
const RED_MEAT = 11;
const DAIRY = 12;
const CHINESE = 20;

/** Meat (10) is a Parent with a threshold, Red Meat (11) is its Child, Dairy (12) is a Parent; Chinese Cuisine (20) is a cuisine. */
const snapshot = buildSnapshot({
  foodCategories: [
    buildFoodCategory({ id: MEAT, name: 'Meat', customThresholdDays: 5 }),
    buildFoodCategory({ id: RED_MEAT, name: 'Red Meat', parentId: MEAT }),
    buildFoodCategory({ id: DAIRY, name: 'Dairy' }),
  ],
  recipeCategories: [buildRecipeCategory({ id: CHINESE, name: 'Chinese Cuisine' })],
});

describe('BC-20 CategoryCreateDecider', () => {
  describe('the food tree', () => {
    it('adds a Parent when there is no parentId: top-level, not a system category, and with no custom threshold', () => {
      expect(valueOf(categoryCreateDecider('foodCategory', name('Fruit'), null, snapshot, 30))).toEqual({
        ops: [{ kind: 'putFoodCategory', row: { id: 30, name: 'Fruit', parentId: null, isSystem: false, customThresholdDays: null } }],
      });
    });

    it('adds a Child under an existing Parent, which may already have a Child and a threshold of its own', () => {
      // Meat has Red Meat and a threshold of 5 days: neither stops a second Child, and the Child does not inherit the threshold as its own
      expect(valueOf(categoryCreateDecider('foodCategory', name('Poultry'), MEAT, snapshot, 30))).toEqual({
        ops: [{ kind: 'putFoodCategory', row: { id: 30, name: 'Poultry', parentId: MEAT, isSystem: false, customThresholdDays: null } }],
      });
    });

    it('uses the id it is given and the name it is given, case and inner spaces kept', () => {
      const [op] = valueOf(categoryCreateDecider('foodCategory', name('Frozen   FOOD'), null, snapshot, 77)).ops;

      expect(op).toMatchObject({ kind: 'putFoodCategory', row: { id: 77, name: 'Frozen   FOOD' } });
    });

    it('makes exactly one operation: the counters belong to the ChangeSet of IdAllocator', () => {
      const { ops } = valueOf(categoryCreateDecider('foodCategory', name('Fruit'), MEAT, snapshot, 30));

      expect(ops).toHaveLength(1);
      expect(ops.some((op) => op.kind === 'putCounters')).toBe(false);
    });

    it('turns the snapshot into one that the invariant checker accepts, once the counters are bumped', () => {
      const alloc = idAllocator(snapshot.counters, { ids: 1, seqs: 0 });
      const id = alloc.ids[0] ?? expect.unreachable('no id was reserved');
      const created = valueOf(categoryCreateDecider('foodCategory', name('Poultry'), MEAT, snapshot, id));

      const next = valueOf(changeSetApplier(valueOf(changeSetApplier(snapshot, alloc.counterCs)), created));

      expect(next.foodCategories.at(-1)).toEqual({ id, name: 'Poultry', parentId: MEAT, isSystem: false, customThresholdDays: null });
      expect(snapshotInvariantChecker(next)).toEqual({ ok: true, value: next });
    });
  });

  describe('cuisines', () => {
    it('adds a cuisine, which is a plain tag with no Parent and no threshold', () => {
      expect(valueOf(categoryCreateDecider('cuisine', name('French Cuisine'), null, snapshot, 30))).toEqual({
        ops: [{ kind: 'putRecipeCategory', row: { id: 30, name: 'French Cuisine', isSystem: false } }],
      });
    });

    it('refuses any parentId, because a cuisine has one level (PARENT_INVALID)', () => {
      // a food category, a cuisine and an id that is nothing: none of them may be the Parent of a cuisine
      for (const parentId of [MEAT, CHINESE, 999]) {
        expect(errorOf(categoryCreateDecider('cuisine', name('French Cuisine'), parentId, snapshot, 30)).code).toBe('PARENT_INVALID');
      }
    });
  });

  describe('PARENT_INVALID: a Child needs a top-level Parent that is not Other (spec exception row 19)', () => {
    it('refuses a Child under the food category Other', () => {
      const error = errorOf(categoryCreateDecider('foodCategory', name('Snacks'), SYSTEM_IDS.FOOD_OTHER, snapshot, 30));

      expect(error.code).toBe('PARENT_INVALID');
      expect(error.detail).toContain('Other');
    });

    it('refuses a Child under a Child, because a food category has two levels', () => {
      const error = errorOf(categoryCreateDecider('foodCategory', name('Steak'), RED_MEAT, snapshot, 30));

      expect(error.code).toBe('PARENT_INVALID');
      expect(error.detail).toContain('Red Meat');
    });
  });

  describe('CATEGORY_NOT_FOUND: the Parent has to exist', () => {
    it('refuses a Parent that is not a category', () => {
      expect(errorOf(categoryCreateDecider('foodCategory', name('Steak'), 999, snapshot, 30))).toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
    });

    it('looks for the Parent in the food tree only: a cuisine is not one', () => {
      expect(errorOf(categoryCreateDecider('foodCategory', name('Steak'), CHINESE, snapshot, 30)).code).toBe('CATEGORY_NOT_FOUND');
      expect(errorOf(categoryCreateDecider('foodCategory', name('Steak'), SYSTEM_IDS.CUISINE_OTHER, snapshot, 30)).code).toBe('CATEGORY_NOT_FOUND');
    });
  });

  it('never edits the snapshot it is given, on success or on failure', () => {
    const before = structuredClone(snapshot);

    categoryCreateDecider('foodCategory', name('Fruit'), MEAT, snapshot, 30);
    categoryCreateDecider('foodCategory', name('Fruit'), RED_MEAT, snapshot, 30);
    categoryCreateDecider('cuisine', name('French Cuisine'), null, snapshot, 31);

    expect(snapshot).toEqual(before);
  });
});
