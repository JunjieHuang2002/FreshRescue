import { describe, expect, it } from 'vitest';
import { EMPTY_SNAPSHOT } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result, ValidName, ValidThreshold, ValidUnit } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import { buildFoodCategory, buildFoodType, buildRecipeCategory, buildSnapshot } from '../../testing/fixtures';
import { snapshotInvariantChecker } from '../engine/snapshotInvariantChecker';
import { idAllocator } from '../foundation/idAllocator';
import { changeSetApplier } from '../state/changeSetApplier';
import { foodTypeCreateDecider } from './foodTypeCreateDecider';

const name = (text: string): ValidName => text as ValidName;
const unit = (text: string): ValidUnit => text as ValidUnit;
const days = (count: number): ValidThreshold => count as ValidThreshold;
const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

const [MEAT, POULTRY, CHINESE] = [10, 11, 20];

/** Meat (10) is a Parent, Poultry (11) is its Child, Chinese Cuisine (20) is a cuisine, and Chicken (30) is a Food Type that already exists. */
const snapshot = buildSnapshot({
  foodCategories: [buildFoodCategory({ id: MEAT, name: 'Meat' }), buildFoodCategory({ id: POULTRY, name: 'Poultry', parentId: MEAT })],
  recipeCategories: [buildRecipeCategory({ id: CHINESE, name: 'Chinese Cuisine' })],
  foodTypes: [buildFoodType({ id: 30, name: 'Chicken', categoryId: POULTRY })],
});

describe('BC-24 FoodTypeCreateDecider', () => {
  it('puts the category on Other when none is given, which is the default (spec section 3)', () => {
    expect(valueOf(foodTypeCreateDecider(name('Rice'), null, unit('grams'), null, snapshot, 40))).toEqual({
      ops: [{ kind: 'putFoodType', row: { id: 40, name: 'Rice', categoryId: SYSTEM_IDS.FOOD_OTHER, unit: 'grams', customThresholdDays: null } }],
    });
  });

  it('puts the Food Type in the Parent or the Child that is named', () => {
    const inParent = valueOf(foodTypeCreateDecider(name('Pork'), MEAT, unit('grams'), null, snapshot, 40));
    const inChild = valueOf(foodTypeCreateDecider(name('Duck'), POULTRY, unit('grams'), null, snapshot, 41));

    expect(inParent.ops).toEqual([{ kind: 'putFoodType', row: expect.objectContaining({ id: 40, categoryId: MEAT }) }]);
    expect(inChild.ops).toEqual([{ kind: 'putFoodType', row: expect.objectContaining({ id: 41, categoryId: POULTRY }) }]);
  });

  it('keeps the unit it is given, one of the six, whatever it is', () => {
    for (const given of ['grams', 'kg', 'ml', 'liters', 'pieces', 'cartons']) {
      const [op] = valueOf(foodTypeCreateDecider(name('Thing'), null, unit(given), null, snapshot, 40)).ops;

      expect(op).toMatchObject({ kind: 'putFoodType', row: { unit: given } });
    }
  });

  it('keeps a threshold when it is given, and leaves the Food Type to inherit when it is null', () => {
    const own = valueOf(foodTypeCreateDecider(name('Fish'), null, unit('grams'), days(2), snapshot, 40));
    const inherits = valueOf(foodTypeCreateDecider(name('Fish'), null, unit('grams'), null, snapshot, 40));

    expect(own.ops).toEqual([{ kind: 'putFoodType', row: expect.objectContaining({ customThresholdDays: 2 }) }]);
    expect(inherits.ops).toEqual([{ kind: 'putFoodType', row: expect.objectContaining({ customThresholdDays: null }) }]);
  });

  it('keeps the name as it was validated, case included', () => {
    const [op] = valueOf(foodTypeCreateDecider(name('Soy MILK'), null, unit('ml'), null, snapshot, 40)).ops;

    expect(op).toMatchObject({ row: { name: 'Soy MILK' } });
  });

  it('adds a Food Type and nothing else: no batch, and no counters, which are the job of IdAllocator (spec 4.2.5)', () => {
    const { ops } = valueOf(foodTypeCreateDecider(name('Rice'), null, unit('grams'), null, snapshot, 40));

    expect(ops.map((op) => op.kind)).toEqual(['putFoodType']);
  });

  it('turns the snapshot into one that the invariant checker accepts, once the counters are bumped', () => {
    const alloc = idAllocator(snapshot.counters, { ids: 1, seqs: 0 });
    const id = alloc.ids[0] ?? expect.unreachable('no id was reserved');
    const created = valueOf(foodTypeCreateDecider(name('Duck'), POULTRY, unit('grams'), days(2), snapshot, id));

    const next = valueOf(changeSetApplier(valueOf(changeSetApplier(snapshot, alloc.counterCs)), created));

    expect(next.foodTypes.at(-1)).toEqual({ id, name: 'Duck', categoryId: POULTRY, unit: 'grams', customThresholdDays: 2 });
    expect(snapshotInvariantChecker(next)).toEqual({ ok: true, value: next });
  });

  describe('CATEGORY_NOT_FOUND', () => {
    it('refuses a category that is not in the food tree', () => {
      expect(errorOf(foodTypeCreateDecider(name('Rice'), 999, unit('grams'), null, snapshot, 40)).code).toBe('CATEGORY_NOT_FOUND');
    });

    it('does not take a cuisine for a category, not even the cuisine Other', () => {
      expect(errorOf(foodTypeCreateDecider(name('Rice'), CHINESE, unit('grams'), null, snapshot, 40)).code).toBe('CATEGORY_NOT_FOUND');
      expect(errorOf(foodTypeCreateDecider(name('Rice'), SYSTEM_IDS.CUISINE_OTHER, unit('grams'), null, snapshot, 40)).code).toBe(
        'CATEGORY_NOT_FOUND',
      );
    });

    it('looks up the default like any other id, so a snapshot without Other cannot be given a Food Type', () => {
      expect(errorOf(foodTypeCreateDecider(name('Rice'), null, unit('grams'), null, EMPTY_SNAPSHOT, 40)).code).toBe('CATEGORY_NOT_FOUND');
    });
  });

  it('judges no name: a duplicate is NameValidator\'s to refuse, and the invariant checker would catch it as well', () => {
    const duplicate = valueOf(foodTypeCreateDecider(name('chicken'), null, unit('grams'), null, snapshot, 40));
    const next = valueOf(changeSetApplier(snapshot, duplicate));

    expect(snapshotInvariantChecker(next)).toMatchObject({ ok: false, err: { code: 'INVARIANT_BROKEN' } });
  });

  it('never edits the snapshot it is given', () => {
    const before = structuredClone(snapshot);

    foodTypeCreateDecider(name('Rice'), MEAT, unit('grams'), days(3), snapshot, 40);
    foodTypeCreateDecider(name('Rice'), 999, unit('grams'), null, snapshot, 40);

    expect(snapshot).toEqual(before);
  });
});
