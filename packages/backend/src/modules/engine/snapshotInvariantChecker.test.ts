import { describe, expect, it } from 'vitest';
import { EMPTY_SNAPSHOT } from '@freshrescue/contract-entities';
import type { Batch, FoodCategory, FoodType, RecipeIngredient, Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
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
import { expiryResolver } from '../foundation/expiryResolver';
import { idAllocator } from '../foundation/idAllocator';
import { seedBundleParser } from '../parsing/seedBundleParser';
import { changeSetApplier } from '../state/changeSetApplier';
import { changeSetMerger } from './changeSetMerger';
import { seedPlanner } from './seedPlanner';
import { snapshotInvariantChecker } from './snapshotInvariantChecker';
import { systemDataInitializer } from './systemDataInitializer';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);

/** The keys of the rules that an INVARIANT_BROKEN error lists, in brackets, in its detail. */
const brokenRules = (result: Result<Snapshot, DomainError>): string[] =>
  result.ok ? [] : [...(result.err.detail ?? '').matchAll(/\[([A-Za-z]+)\]/g)].map((match) => match[1] ?? '');
const detailOf = (result: Result<Snapshot, DomainError>): string => (result.ok ? '' : (result.err.detail ?? ''));

// A valid store with something in every list. Ids: 1 and 2 are the system categories, 3 Meat (threshold
// 5 days), 4 Poultry under Meat, 5 Vegetables, 6 Chinese Cuisine, 7 Chicken, 8 Broccoli (threshold 2),
// 9 Egg in Other, 10 was Tofu and was deleted, 11 to 13 are batches (13 has expired), 14 and 15 are
// recipes. Tofu Soup keeps the deleted name on its row, and asks for Egg in grams, which is a Unit
// Conflict: a state the spec allows (it blocks the recipe), so it breaks no invariant.
const base: Snapshot = buildSnapshot({
  foodCategories: [
    buildFoodCategory({ id: 3, name: 'Meat', customThresholdDays: 5 }),
    buildFoodCategory({ id: 4, name: 'Poultry', parentId: 3 }),
    buildFoodCategory({ id: 5, name: 'Vegetables' }),
  ],
  recipeCategories: [buildRecipeCategory({ id: 6, name: 'Chinese Cuisine' })],
  foodTypes: [
    buildFoodType({ id: 7, name: 'Chicken', categoryId: 4 }),
    buildFoodType({ id: 8, name: 'Broccoli', categoryId: 5, customThresholdDays: 2 }),
    buildFoodType({ id: 9, name: 'Egg', unit: 'pieces' }),
  ],
  batches: [
    buildBatch({ id: 11, foodTypeId: 7, quantity: 300_000, inboundDate: '2026-10-01', expirationDate: '2026-10-04', createdSeq: 1 }),
    buildBatch({ id: 12, foodTypeId: 8, quantity: 250_000, inboundDate: '2026-10-01', expirationDate: '2026-10-08', createdSeq: 2 }),
    buildBatch({ id: 13, foodTypeId: 7, quantity: 100_000, inboundDate: '2026-09-20', expirationDate: '2026-09-25', createdSeq: 3 }),
  ],
  recipes: [buildRecipe({ id: 14, name: 'Chicken Fried Rice', recipeCategoryId: 6 }), buildRecipe({ id: 15, name: 'Tofu Soup' })],
  recipeIngredients: [
    buildIngredient({ recipeId: 14, foodTypeId: 7, requiredQuantity: 200_000 }),
    buildIngredient({ recipeId: 14, foodTypeId: 9, requiredQuantity: 2_000, requiredUnit: 'pieces' }),
    buildIngredient({ recipeId: 15, foodTypeId: 10, requiredQuantity: 100_000, deletedFoodTypeName: 'Tofu' }),
    buildIngredient({ recipeId: 15, foodTypeId: 8, requiredQuantity: 50_000 }),
    buildIngredient({ recipeId: 15, foodTypeId: 9, requiredQuantity: 1_000, requiredUnit: 'grams' }),
  ],
  settings: { simulatedToday: '2026-10-02', bootstrapped: true },
});

// ---- small editors, so that each case below reads as the one thing it breaks ----------------------

const foodCategory = (id: number, change: Partial<FoodCategory>) => (s: Snapshot): Snapshot => ({
  ...s,
  foodCategories: s.foodCategories.map((c) => (c.id === id ? { ...c, ...change } : c)),
});
const foodType = (id: number, change: Partial<FoodType>) => (s: Snapshot): Snapshot => ({
  ...s,
  foodTypes: s.foodTypes.map((f) => (f.id === id ? { ...f, ...change } : f)),
});
const batch = (id: number, change: Partial<Batch>) => (s: Snapshot): Snapshot => ({
  ...s,
  batches: s.batches.map((b) => (b.id === id ? { ...b, ...change } : b)),
});
const row = (recipeId: number, foodTypeId: number, change: Partial<RecipeIngredient>) => (s: Snapshot): Snapshot => ({
  ...s,
  recipeIngredients: s.recipeIngredients.map((r) => (r.recipeId === recipeId && r.foodTypeId === foodTypeId ? { ...r, ...change } : r)),
});
const both = (...edits: ((s: Snapshot) => Snapshot)[]) => (s: Snapshot): Snapshot => edits.reduce((next, edit) => edit(next), s);

/** A shelf life of 3,000,000 days from Oct 1, 2026, worked out by ExpiryResolver: a date past the year 9999. */
const farFuture = valueOf(expiryResolver({ days: 3_000_000 }, '2026-10-01')).expirationDate;

type Case = { readonly rule: string; readonly what: string; readonly edit: (s: Snapshot) => Snapshot };

/** At least one snapshot for every rule, each breaking that rule and no other. */
const CASES: readonly Case[] = [
  { rule: 'positiveIds', what: 'a batch has the id 0', edit: batch(13, { id: 0 }) },
  { rule: 'positiveIds', what: 'a batch has a fractional id', edit: batch(13, { id: 13.5 }) },
  { rule: 'uniqueIds', what: 'a batch has the id of a Food Type', edit: batch(13, { id: 7 }) },
  { rule: 'counters', what: 'nextId is the highest id in use, so the next record would reuse it', edit: (s) => ({ ...s, counters: { ...s.counters, nextId: 15 } }) },
  { rule: 'counters', what: 'nextSeq is the highest createdSeq in use', edit: (s) => ({ ...s, counters: { ...s.counters, nextSeq: 3 } }) },
  { rule: 'systemCategories', what: 'the food category Other was renamed', edit: foodCategory(1, { name: 'Others' }) },
  { rule: 'systemCategories', what: 'a second food category is marked as a system one', edit: foodCategory(3, { isSystem: true }) },
  { rule: 'systemCategories', what: 'the cuisine Other is not marked as the system one', edit: (s) => ({ ...s, recipeCategories: s.recipeCategories.map((c) => (c.id === 2 ? { ...c, isSystem: false } : c)) }) },
  { rule: 'otherIsLeaf', what: 'Other has a custom threshold', edit: foodCategory(1, { customThresholdDays: 4 }) },
  { rule: 'otherIsLeaf', what: 'a Child sits under Other', edit: foodCategory(4, { parentId: 1 }) },
  { rule: 'otherIsLeaf', what: 'Other sits under a Parent', edit: foodCategory(1, { parentId: 3 }) },
  { rule: 'parentExists', what: 'a Child names a Parent that does not exist', edit: foodCategory(4, { parentId: 99 }) },
  { rule: 'twoLevels', what: 'a category sits under a Child', edit: foodCategory(5, { parentId: 4 }) },
  { rule: 'names', what: 'a Food Type name is not trimmed', edit: foodType(9, { name: ' Egg' }) },
  { rule: 'names', what: 'a recipe name has 201 characters', edit: (s) => ({ ...s, recipes: s.recipes.map((r) => (r.id === 14 ? { ...r, name: 'x'.repeat(201) } : r)) }) },
  { rule: 'names', what: 'a category name is empty', edit: foodCategory(5, { name: '' }) },
  { rule: 'names', what: 'a deleted name that a row keeps is not trimmed', edit: row(15, 10, { deletedFoodTypeName: 'Tofu ' }) },
  { rule: 'uniqueNames', what: 'two Food Types share a name in different case', edit: foodType(8, { name: 'CHICKEN' }) },
  { rule: 'uniqueNames', what: 'a Parent and a Child share a name', edit: foodCategory(4, { name: 'meat' }) },
  { rule: 'uniqueNames', what: 'a food category is named like the reserved Other', edit: foodCategory(5, { name: 'other' }) },
  { rule: 'uniqueNames', what: 'two recipes share a name', edit: (s) => ({ ...s, recipes: s.recipes.map((r) => (r.id === 15 ? { ...r, name: 'chicken fried rice' } : r)) }) },
  { rule: 'thresholds', what: 'a Food Type has a threshold of 0 days', edit: foodType(8, { customThresholdDays: 0 }) },
  { rule: 'thresholds', what: 'a category has a threshold of 1.5 days', edit: foodCategory(3, { customThresholdDays: 1.5 }) },
  { rule: 'foodTypeCategory', what: 'a Food Type names a category that does not exist', edit: foodType(9, { categoryId: 99 }) },
  { rule: 'units', what: 'a Food Type is in a unit that is not on the list', edit: foodType(9, { unit: 'dozen' }) },
  { rule: 'units', what: 'a row requires a unit that is not on the list', edit: row(14, 7, { requiredUnit: 'cups' }) },
  { rule: 'batchFoodType', what: 'a batch names a Food Type that does not exist', edit: batch(12, { foodTypeId: 99 }) },
  { rule: 'quantities', what: 'a batch holds 0', edit: batch(11, { quantity: 0 }) },
  { rule: 'quantities', what: 'a row requires a fraction of a thousandth', edit: row(15, 8, { requiredQuantity: 1.5 }) },
  { rule: 'quantities', what: 'a row requires more than 500,000', edit: row(14, 7, { requiredQuantity: 500_000_001 }) },
  { rule: 'dates', what: 'a batch came in on Feb 30', edit: batch(12, { inboundDate: '2026-02-30' }) },
  { rule: 'dates', what: 'a batch came in on Feb 29 of a year that is not a leap year', edit: batch(12, { inboundDate: '2026-02-29' }) },
  { rule: 'dates', what: 'a batch came in on Feb 30 of a leap year', edit: batch(12, { inboundDate: '2028-02-30' }) },
  { rule: 'dates', what: 'a batch expires on Feb 29, 1900, a century that was no leap year', edit: batch(13, { expirationDate: '1900-02-29' }) },
  { rule: 'dates', what: 'a batch expires after the year 9999, from a shelf life of 3,000,000 days', edit: batch(12, { expirationDate: farFuture }) },
  { rule: 'dates', what: 'Simulated Today is in month 13', edit: (s) => ({ ...s, settings: { ...s.settings, simulatedToday: '2026-13-01' } }) },
  { rule: 'expiryAfterInbound', what: 'a batch expires the day before it came in', edit: batch(12, { inboundDate: '2026-10-09', expirationDate: '2026-10-08' }) },
  { rule: 'createdSeq', what: 'two batches share a createdSeq', edit: batch(12, { createdSeq: 1 }) },
  { rule: 'createdSeq', what: 'a batch has the createdSeq 0', edit: batch(13, { createdSeq: 0 }) },
  { rule: 'cap', what: 'the batches of Chicken total 500,000.001', edit: both(batch(11, { quantity: 400_000_000 }), batch(13, { quantity: 100_000_001 })) },
  { rule: 'recipeCuisine', what: 'a recipe names a cuisine that does not exist', edit: (s) => ({ ...s, recipes: s.recipes.map((r) => (r.id === 14 ? { ...r, recipeCategoryId: 99 } : r)) }) },
  { rule: 'recipeHasRows', what: 'a recipe has no ingredient row', edit: (s) => ({ ...s, recipeIngredients: s.recipeIngredients.filter((r) => r.recipeId !== 14) }) },
  { rule: 'rowRecipe', what: 'a row belongs to a recipe that does not exist', edit: (s) => ({ ...s, recipeIngredients: [...s.recipeIngredients, buildIngredient({ recipeId: 99, foodTypeId: 7 })] }) },
  { rule: 'rowOnce', what: 'a recipe has two rows for one Food Type', edit: (s) => ({ ...s, recipeIngredients: [...s.recipeIngredients, buildIngredient({ recipeId: 14, foodTypeId: 7, requiredQuantity: 5_000 })] }) },
  { rule: 'rowFoodType', what: 'a row keeps a deleted name although its Food Type exists', edit: row(14, 7, { deletedFoodTypeName: 'Chicken' }) },
  { rule: 'rowFoodType', what: 'a row names a Food Type that is gone and keeps no name', edit: row(15, 10, { deletedFoodTypeName: null }) },
];

/** The 23 rules of the checker, in the order its error lists them. */
const RULES = [
  'positiveIds', 'uniqueIds', 'counters', 'systemCategories', 'otherIsLeaf', 'parentExists', 'twoLevels', 'names',
  'uniqueNames', 'thresholds', 'foodTypeCategory', 'units', 'batchFoodType', 'quantities', 'dates', 'expiryAfterInbound',
  'createdSeq', 'cap', 'recipeCuisine', 'recipeHasRows', 'rowRecipe', 'rowOnce', 'rowFoodType',
];

describe('BC-41 SnapshotInvariantChecker', () => {
  it('passes a valid store and returns the same snapshot, unchanged', () => {
    expect(snapshotInvariantChecker(base)).toEqual({ ok: true, value: base });
    expect(valueOf(snapshotInvariantChecker(base))).toBe(base);
  });

  it('takes the states the spec allows: an Expired batch, a deleted Food Type kept by name, and a Unit Conflict', () => {
    // batch 13 expired before Simulated Today, Tofu Soup keeps "Tofu", and it asks for Egg in grams
    expect(base.batches.some((b) => b.expirationDate < (base.settings.simulatedToday ?? ''))).toBe(true);
    expect(snapshotInvariantChecker(base).ok).toBe(true);
  });

  it('takes what the calendar has: Feb 29 of a leap year, and a batch that expires on the day it came in (a shelf life of 0)', () => {
    const leapDays = both(batch(12, { inboundDate: '2028-02-29', expirationDate: '2028-02-29' }), batch(13, { inboundDate: '2000-02-29', expirationDate: '2000-03-01' }))(base);

    expect(snapshotInvariantChecker(leapDays).ok).toBe(true);
  });

  it('passes a store with only the two system categories', () => {
    expect(snapshotInvariantChecker(buildSnapshot()).ok).toBe(true);
  });

  it('passes the seed that SeedPlanner builds from the Appendix A data', () => {
    const parsed = valueOf(seedBundleParser(APPENDIX_A_SEED));
    const alloc = idAllocator(EMPTY_SNAPSHOT.counters, { ids: parsed.idDemand, seqs: 0 });
    const seeded = valueOf(changeSetApplier(EMPTY_SNAPSHOT, changeSetMerger([systemDataInitializer(EMPTY_SNAPSHOT), alloc.counterCs, seedPlanner(parsed, alloc.ids, EMPTY_SNAPSHOT)])));

    expect(seeded.foodTypes).toHaveLength(8);
    expect(seeded.recipes).toHaveLength(6);
    expect(snapshotInvariantChecker(seeded)).toEqual({ ok: true, value: seeded });
  });

  it('has a case below for every one of its 23 rules', () => {
    expect([...new Set(CASES.map((c) => c.rule))]).toEqual(RULES);
    expect(detailOf(snapshotInvariantChecker(EMPTY_SNAPSHOT))).toMatch(/ of 23 rules broken/);
  });

  describe('one snapshot per rule, each breaking exactly that rule', () => {
    it.each(CASES)('$rule: refused when $what', ({ rule, edit }) => {
      const result = snapshotInvariantChecker(edit(base));

      expect(result).toMatchObject({ ok: false, err: { code: 'INVARIANT_BROKEN' } });
      expect(brokenRules(result)).toEqual([rule]);
    });
  });

  it('lists both rules when a snapshot breaks two, with what broke each', () => {
    const twice = both(batch(11, { quantity: 400_000_000 }), batch(13, { quantity: 100_000_001 }), foodType(8, { name: 'chicken' }))(base);
    const result = snapshotInvariantChecker(twice);

    expect(brokenRules(result)).toEqual(['uniqueNames', 'cap']);
    expect(detailOf(result)).toMatch(/^2 of 23 rules broken\./);
    expect(detailOf(result)).toContain('Food Type 7 totals 500000.001');
    expect(detailOf(result)).toContain('the Food Types 7, 8 share the name "chicken"');
  });

  it('refuses a store without the system categories, such as the empty store before its bootstrap', () => {
    const result = snapshotInvariantChecker(EMPTY_SNAPSHOT);

    expect(brokenRules(result)).toEqual(['systemCategories']);
    expect(detailOf(result)).toContain('the food category Other (id 1) is missing');
    expect(detailOf(result)).toContain('the cuisine Other (id 2) is missing');
  });

  it('spells out the first three faults of a rule and counts the rest', () => {
    const fiveZeros = { ...base, batches: base.batches.map((b) => ({ ...b, quantity: 0 })), recipeIngredients: base.recipeIngredients.slice(0, 2).map((r) => ({ ...r, requiredQuantity: 0 })) };
    const detail = detailOf(snapshotInvariantChecker(fiveZeros));

    expect(detail).toContain('[quantities]');
    expect(detail).toContain('batch 11 holds 0, batch 12 holds 0, batch 13 holds 0 and 2 more');
  });

  it('checks every rule on every call and stops at none, so a snapshot that breaks many lists them all', () => {
    const many = both(
      batch(11, { quantity: 0 }),
      foodType(9, { unit: 'dozen' }),
      foodCategory(4, { parentId: 99 }),
      (s) => ({ ...s, counters: { ...s.counters, nextSeq: 1 } }),
    )(base);

    expect(brokenRules(snapshotInvariantChecker(many))).toEqual(['counters', 'parentExists', 'units', 'quantities']);
  });
});
