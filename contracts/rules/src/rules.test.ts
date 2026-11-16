import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BATCH_STATUSES,
  CATEGORY_SCOPES,
  COOK_OUTCOMES,
  EMPTY_STATES,
  FIRST_FREE_ID,
  INGREDIENT_STATES,
  LIMITS,
  NAME_SCOPES,
  RECIPE_ERROR_REASONS,
  RECIPE_STATUSES,
  RECOMMENDATION_TIERS,
  SKIP_REASONS,
  STATUS_URGENCY,
  SYSTEM_IDS,
  THRESHOLD_SOURCES,
  UNIT_LIST,
} from './index';
import type { CategoryScope, IngredientState, NameScope, RecipeErrorReason, Unit } from './index';

describe('rules', () => {
  it('pins the limits of the input dictionary', () => {
    expect(LIMITS).toEqual({
      NAME_MIN_LENGTH: 1,
      NAME_MAX_LENGTH: 200,
      QTY_MIN_MILLI: 1,
      QTY_MAX_MILLI: 500_000_000,
      QTY_DECIMALS: 3,
      CAP_MILLI: 500_000_000,
      GLOBAL_THRESHOLD_DAYS: 3,
      THRESHOLD_MIN_DAYS: 1,
    });
    // thousandths: 0.001 is 1 and the cap of 500,000 is 500,000,000
    expect(LIMITS.QTY_MAX_MILLI).toBe(500_000 * 1000);
    expect(LIMITS.CAP_MILLI).toBe(LIMITS.QTY_MAX_MILLI);
  });

  it('fixes the six units, the four name scopes and the two reserved ids', () => {
    expect(UNIT_LIST).toEqual(['grams', 'kg', 'ml', 'liters', 'pieces', 'cartons']);
    expect(NAME_SCOPES).toEqual(['foodType', 'recipe', 'foodCategory', 'cuisine']);
    expect(CATEGORY_SCOPES).toEqual(['foodCategory', 'cuisine']);
    expectTypeOf<Unit>().toEqualTypeOf<'grams' | 'kg' | 'ml' | 'liters' | 'pieces' | 'cartons'>();
    expectTypeOf<CategoryScope>().toExtend<NameScope>();

    // ids 1 and 2 are the two `Other` categories, and the counter starts after them
    expect(SYSTEM_IDS).toEqual({ FOOD_OTHER: 1, CUISINE_OTHER: 2 });
    expect(FIRST_FREE_ID).toBe(Math.max(...Object.values(SYSTEM_IDS)) + 1);
  });

  it('names the status vocabularies and ranks the freshness statuses', () => {
    expect(BATCH_STATUSES).toEqual(['fresh', 'nearExpiry', 'expired']);
    expect(STATUS_URGENCY.expired).toBeGreaterThan(STATUS_URGENCY.nearExpiry);
    expect(STATUS_URGENCY.nearExpiry).toBeGreaterThan(STATUS_URGENCY.fresh);
    expect(THRESHOLD_SOURCES).toEqual(['foodType', 'child', 'parent', 'global']);
    expect(RECIPE_STATUSES).toEqual(['full', 'partial', 'nothing', 'blocked']);
    expect(RECIPE_ERROR_REASONS).toEqual(['missingFoodType', 'unitConflict']);
    expect(INGREDIENT_STATES).toEqual(['ok', 'missing', ...RECIPE_ERROR_REASONS]);
    expect(RECOMMENDATION_TIERS).toEqual(['full', 'partial']);
    expect(EMPTY_STATES).toEqual(['noNearExpiry', 'noRescue']);
    expect(COOK_OUTCOMES).toEqual(['cooked', 'skipped']);
    expect(SKIP_REASONS).toEqual(['blocked', 'nothingAvailable', 'recipeNotFound']);
    expectTypeOf<IngredientState>().toEqualTypeOf<'ok' | 'missing' | RecipeErrorReason>();
  });
});
