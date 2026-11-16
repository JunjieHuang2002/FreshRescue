import { describe, expect, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import type { RecipeDraft, RecipeDraftRow } from '@freshrescue/contract-messages';
import type { Result } from '@freshrescue/contract-primitives';
import { LIMITS, SYSTEM_IDS, UNIT_LIST } from '@freshrescue/contract-rules';
import { buildFoodCategory, buildFoodType, buildRecipeCategory, buildSnapshot } from '../../testing/fixtures';
import { scalarValidator } from '../foundation/scalarValidator';
import { recipeDraftValidator } from './recipeDraftValidator';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

const [BEEF, BROCCOLI, EGG] = [30, 31, 32];
const [MEAT, CHINESE] = [10, 20];

/** Beef and Broccoli are in grams, Egg is in pieces. Meat (10) is a food category, Chinese Cuisine (20) is a cuisine. */
const snapshot = buildSnapshot({
  foodCategories: [buildFoodCategory({ id: MEAT, name: 'Meat' })],
  recipeCategories: [buildRecipeCategory({ id: CHINESE, name: 'Chinese Cuisine' })],
  foodTypes: [
    buildFoodType({ id: BEEF, name: 'Beef' }),
    buildFoodType({ id: BROCCOLI, name: 'Broccoli' }),
    buildFoodType({ id: EGG, name: 'Egg', unit: 'pieces' }),
  ],
});

const row = (foodTypeId: number, quantity: number, unit: string): RecipeDraftRow => ({ foodTypeId, quantity, unit });
const draftOf = (rows: readonly RecipeDraftRow[], cuisineId: number | null = null): RecipeDraft => ({ cuisineId, rows });
const STIR_FRY = [row(BEEF, 300_000, 'grams'), row(BROCCOLI, 200_000, 'grams')];

describe('BC-32 RecipeDraftValidator', () => {
  describe('a valid draft', () => {
    it('comes back in the vocabulary of the entities, with its cuisine and its rows in the order they were entered', () => {
      expect(valueOf(recipeDraftValidator(draftOf(STIR_FRY, CHINESE), snapshot))).toEqual({
        recipeCategoryId: CHINESE,
        rows: [
          { foodTypeId: BEEF, requiredQuantity: 300_000, requiredUnit: 'grams' },
          { foodTypeId: BROCCOLI, requiredQuantity: 200_000, requiredUnit: 'grams' },
        ],
      });
    });

    it('puts a recipe with no cuisine in the cuisine Other, which is the default (spec section 3)', () => {
      expect(valueOf(recipeDraftValidator(draftOf(STIR_FRY, null), snapshot)).recipeCategoryId).toBe(SYSTEM_IDS.CUISINE_OTHER);
    });

    it('accepts a recipe with a single row', () => {
      expect(valueOf(recipeDraftValidator(draftOf([row(EGG, 2_000, 'pieces')]), snapshot)).rows).toHaveLength(1);
    });

    it('accepts the smallest and the largest quantity: 0.001 and 500,000 (spec section 3)', () => {
      const result = valueOf(recipeDraftValidator(draftOf([row(BEEF, LIMITS.QTY_MIN_MILLI, 'grams'), row(BROCCOLI, LIMITS.QTY_MAX_MILLI, 'grams')]), snapshot));

      expect(result.rows.map((r) => r.requiredQuantity)).toEqual([1, 500_000_000]);
    });

    it('accepts every unit of the list', () => {
      for (const unit of UNIT_LIST) {
        expect(valueOf(recipeDraftValidator(draftOf([row(BEEF, 1_000, unit)]), snapshot)).rows[0]?.requiredUnit).toBe(unit);
      }
    });

    it('accepts a Required Unit that differs from the Food Type\'s unit: that makes a Unit Conflict, which is derived later (spec section 3)', () => {
      expect(valueOf(recipeDraftValidator(draftOf([row(BEEF, 300, 'kg'), row(EGG, 2_000, 'grams')]), snapshot)).rows.map((r) => r.requiredUnit)).toEqual([
        'kg',
        'grams',
      ]);
    });
  });

  describe('NO_INGREDIENTS', () => {
    it('refuses a recipe with no ingredient row (spec section 3)', () => {
      expect(errorOf(recipeDraftValidator(draftOf([], CHINESE), snapshot)).code).toBe('NO_INGREDIENTS');
    });
  });

  describe('DUP_INGREDIENT', () => {
    it('refuses the same Food Type twice, next to each other or apart, with the same quantity or not', () => {
      expect(errorOf(recipeDraftValidator(draftOf([row(BEEF, 1_000, 'grams'), row(BEEF, 2_000, 'grams')]), snapshot)).code).toBe('DUP_INGREDIENT');
      expect(errorOf(recipeDraftValidator(draftOf([row(BEEF, 1_000, 'grams'), row(EGG, 1_000, 'pieces'), row(BEEF, 1_000, 'grams')]), snapshot)).code).toBe(
        'DUP_INGREDIENT',
      );
    });

    it('refuses it whatever the unit of the second row', () => {
      expect(errorOf(recipeDraftValidator(draftOf([row(BEEF, 1_000, 'grams'), row(BEEF, 1, 'kg')]), snapshot)).code).toBe('DUP_INGREDIENT');
    });

    it('names the row that repeats', () => {
      expect(errorOf(recipeDraftValidator(draftOf([row(BEEF, 1_000, 'grams'), row(EGG, 1_000, 'pieces'), row(BEEF, 1_000, 'grams')]), snapshot)).detail).toContain('row 3');
    });
  });

  describe('UNKNOWN_FOOD_TYPE', () => {
    it('refuses a row that names a Food Type that does not exist', () => {
      expect(errorOf(recipeDraftValidator(draftOf([row(BEEF, 1_000, 'grams'), row(999, 1_000, 'grams')]), snapshot)).code).toBe('UNKNOWN_FOOD_TYPE');
    });

    it('does not take a category for a Food Type', () => {
      expect(errorOf(recipeDraftValidator(draftOf([row(MEAT, 1_000, 'grams')]), snapshot)).code).toBe('UNKNOWN_FOOD_TYPE');
    });

    it('names the row', () => {
      expect(errorOf(recipeDraftValidator(draftOf([row(BEEF, 1_000, 'grams'), row(999, 1_000, 'grams')]), snapshot)).detail).toContain('row 2');
    });
  });

  describe('the quantity of a row (spec section 3)', () => {
    const quantityCode = (quantity: number): string => errorOf(recipeDraftValidator(draftOf([row(BEEF, quantity, 'grams')]), snapshot)).code;

    it('refuses 0 and a negative number as QTY_NOT_POSITIVE', () => {
      expect(quantityCode(0)).toBe('QTY_NOT_POSITIVE');
      expect(quantityCode(-1_000)).toBe('QTY_NOT_POSITIVE');
    });

    it('refuses a fraction of a thousandth as QTY_NOT_INTEGER: more than 3 decimals is never rounded', () => {
      expect(quantityCode(1.5)).toBe('QTY_NOT_INTEGER');
      expect(quantityCode(0.5)).toBe('QTY_NOT_INTEGER'); // below the minimum, but it is not whole, which comes first
      expect(quantityCode(-1.5)).toBe('QTY_NOT_INTEGER');
    });

    it('refuses a number that is no integer at all as QTY_NOT_INTEGER', () => {
      expect(quantityCode(Number.NaN)).toBe('QTY_NOT_INTEGER');
      expect(quantityCode(Number.POSITIVE_INFINITY)).toBe('QTY_NOT_INTEGER');
    });

    it('refuses more than 500,000 as QTY_TOO_LARGE', () => {
      expect(quantityCode(LIMITS.QTY_MAX_MILLI + 1)).toBe('QTY_TOO_LARGE');
      expect(quantityCode(Number.MAX_SAFE_INTEGER)).toBe('QTY_TOO_LARGE');
    });

    it('names the row and the number', () => {
      const error = errorOf(recipeDraftValidator(draftOf([row(BEEF, 1_000, 'grams'), row(BROCCOLI, 0, 'grams')]), snapshot));

      expect(error.detail).toContain('row 2');
      expect(error.detail).toContain('0');
    });
  });

  describe('UNIT_UNKNOWN: a unit is one of the six, spelled exactly (spec section 3)', () => {
    it('refuses a unit that is not on the list, however close', () => {
      for (const unit of ['tbsp', 'gram', 'KG', 'Grams', ' kg', 'kg ', '']) {
        expect(errorOf(recipeDraftValidator(draftOf([row(BEEF, 1_000, unit)]), snapshot)).code).toBe('UNIT_UNKNOWN');
      }
    });

    it('names the row and the unit', () => {
      const error = errorOf(recipeDraftValidator(draftOf([row(BEEF, 1_000, 'grams'), row(EGG, 1_000, 'dozen')]), snapshot));

      expect(error.detail).toContain('row 2');
      expect(error.detail).toContain('"dozen"');
    });
  });

  describe('CATEGORY_NOT_FOUND: the cuisine has to exist', () => {
    it('refuses a cuisine that does not exist', () => {
      expect(errorOf(recipeDraftValidator(draftOf(STIR_FRY, 999), snapshot)).code).toBe('CATEGORY_NOT_FOUND');
    });

    it('does not take a food category for a cuisine', () => {
      expect(errorOf(recipeDraftValidator(draftOf(STIR_FRY, MEAT), snapshot)).code).toBe('CATEGORY_NOT_FOUND');
    });

    it('looks up the default like any other id, so a snapshot without the cuisine Other cannot take a recipe', () => {
      const noCuisines = { ...snapshot, recipeCategories: [] };

      expect(errorOf(recipeDraftValidator(draftOf(STIR_FRY, null), noCuisines)).code).toBe('CATEGORY_NOT_FOUND');
    });
  });

  describe('the order of the checks (blueprint 3.2): rows, then no duplicate, known Food Types, quantities and units, the cuisine', () => {
    it('answers NO_INGREDIENTS before it looks at the cuisine', () => {
      expect(errorOf(recipeDraftValidator(draftOf([], 999), snapshot)).code).toBe('NO_INGREDIENTS');
    });

    it('answers DUP_INGREDIENT before UNKNOWN_FOOD_TYPE', () => {
      expect(errorOf(recipeDraftValidator(draftOf([row(999, 1_000, 'grams'), row(999, 1_000, 'grams')]), snapshot)).code).toBe('DUP_INGREDIENT');
    });

    it('answers UNKNOWN_FOOD_TYPE for any row before it judges the quantity of an earlier one', () => {
      expect(errorOf(recipeDraftValidator(draftOf([row(BEEF, 0, 'grams'), row(999, 1_000, 'grams')]), snapshot)).code).toBe('UNKNOWN_FOOD_TYPE');
    });

    it('judges the rows one after the other, the quantity and then the unit of each', () => {
      // row 1 has a bad unit and row 2 a bad quantity: the first row decides
      expect(errorOf(recipeDraftValidator(draftOf([row(BEEF, 1_000, 'tbsp'), row(BROCCOLI, 0, 'grams')]), snapshot)).code).toBe('UNIT_UNKNOWN');
      // one row with both faults: the quantity decides
      expect(errorOf(recipeDraftValidator(draftOf([row(BEEF, 0, 'tbsp')]), snapshot)).code).toBe('QTY_NOT_POSITIVE');
    });

    it('answers a bad quantity or unit before the cuisine', () => {
      expect(errorOf(recipeDraftValidator(draftOf([row(BEEF, 0, 'grams')], 999), snapshot)).code).toBe('QTY_NOT_POSITIVE');
      expect(errorOf(recipeDraftValidator(draftOf([row(BEEF, 1_000, 'tbsp')], 999), snapshot)).code).toBe('UNIT_UNKNOWN');
    });
  });

  it('judges a quantity and a unit exactly as ScalarValidator does, the one that a batch is judged by (spec section 3: one rule)', () => {
    const quantities = [-5, -1.5, 0, 0.5, 1, 1.5, 999, 500_000_000, 500_000_001, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER];
    for (const quantity of quantities) {
      const mine = recipeDraftValidator(draftOf([row(BEEF, quantity, 'grams')]), snapshot);
      const theirs = scalarValidator('qty', quantity);

      expect(mine.ok).toBe(theirs.ok);
      if (!mine.ok && !theirs.ok) expect(mine.err.code).toBe(theirs.err.code);
    }
    for (const unit of [...UNIT_LIST, 'tbsp', 'KG', ' kg', '']) {
      const mine = recipeDraftValidator(draftOf([row(BEEF, 1_000, unit)]), snapshot);
      const theirs = scalarValidator('unit', unit);

      expect(mine.ok).toBe(theirs.ok);
      if (!mine.ok && !theirs.ok) expect(mine.err.code).toBe(theirs.err.code);
    }
  });

  it('never edits the draft or the snapshot it is given', () => {
    const before = structuredClone({ snapshot, draft: draftOf(STIR_FRY, CHINESE) });
    const draft = draftOf(STIR_FRY, CHINESE);

    recipeDraftValidator(draft, snapshot);
    recipeDraftValidator(draftOf([], 999), snapshot);

    expect(snapshot).toEqual(before.snapshot);
    expect(draft).toEqual(before.draft);
  });
});
