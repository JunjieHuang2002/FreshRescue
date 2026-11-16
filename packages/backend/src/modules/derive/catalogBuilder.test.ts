import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { DateISO, Id, Result } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import type { CatalogDto, CatalogRow } from '@freshrescue/contract-views';
import { buildBatch, buildFoodCategory, buildFoodType, buildIngredient, buildRecipe, buildRecipeCategory, buildSnapshot } from '../../testing/fixtures';
import { batchStatusClassifier } from '../foundation/batchStatusClassifier';
import { thresholdResolver } from '../foundation/thresholdResolver';
import { catalogBuilder } from './catalogBuilder';
import { nameSorter } from './nameSorter';
import { recipeErrorEvaluator } from './recipeErrorEvaluator';
import { recipeMatchEvaluator } from './recipeMatchEvaluator';
import { stockAggregator } from './stockAggregator';

const TODAY = '2026-10-10';
const FRESH = '2026-10-20';
const NEAR = '2026-10-11';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);

/** getCatalog in the blueprint's order: derive, errors, matches, order, catalog. */
function catalog(snapshot: Snapshot, cuisineId?: Id | null, today: DateISO = TODAY): Result<CatalogDto, DomainError> {
  const stock = stockAggregator(snapshot, batchStatusClassifier(snapshot.batches, thresholdResolver(snapshot), today));
  const errors = recipeErrorEvaluator(snapshot);
  const matches = valueOf(recipeMatchEvaluator(snapshot, stock, errors, null));
  return catalogBuilder(matches, errors, snapshot, nameSorter(snapshot.recipes), cuisineId);
}
const rowNamed = (dto: CatalogDto, name: string): CatalogRow | undefined => dto.rows.find((row) => row.name === name);

const batch = (id: number, foodTypeId: number, quantity: number, expirationDate = FRESH) =>
  buildBatch({ id, foodTypeId, quantity, inboundDate: '2026-10-01', expirationDate });

// Food Types: Beef 10, Broccoli 11, Chicken 12 (held in pieces), Rice 13, Egg 14 (pieces). Tofu had the id 9 and was deleted.
// Cuisines: Chinese 5, French 6. Recipes are created out of A to Z order on purpose.
const kitchen: Snapshot = buildSnapshot({
  foodCategories: [buildFoodCategory({ id: 7, name: 'Meat' })],
  foodTypes: [
    buildFoodType({ id: 10, name: 'Beef', categoryId: 7 }),
    buildFoodType({ id: 11, name: 'Broccoli' }),
    buildFoodType({ id: 12, name: 'Chicken', unit: 'pieces' }),
    buildFoodType({ id: 13, name: 'Rice' }),
    buildFoodType({ id: 14, name: 'Egg', unit: 'pieces' }),
  ],
  recipeCategories: [buildRecipeCategory({ id: 5, name: 'Chinese Cuisine' }), buildRecipeCategory({ id: 6, name: 'French Cuisine' })],
  recipes: [
    buildRecipe({ id: 20, name: 'Tofu Soup', recipeCategoryId: SYSTEM_IDS.CUISINE_OTHER }),
    buildRecipe({ id: 21, name: 'Beef and Broccoli Stir-Fry', recipeCategoryId: 5 }),
    buildRecipe({ id: 22, name: 'Chicken Fried Rice', recipeCategoryId: 5 }),
    buildRecipe({ id: 23, name: 'Egg Fried Rice', recipeCategoryId: 5 }),
    buildRecipe({ id: 24, name: 'Beef Stew', recipeCategoryId: 6 }),
  ],
  recipeIngredients: [
    buildIngredient({ recipeId: 20, foodTypeId: 9, requiredQuantity: 300_000, deletedFoodTypeName: 'Tofu' }),
    buildIngredient({ recipeId: 20, foodTypeId: 14, requiredQuantity: 1_000, requiredUnit: 'pieces' }),
    buildIngredient({ recipeId: 21, foodTypeId: 10, requiredQuantity: 300_000 }),
    buildIngredient({ recipeId: 21, foodTypeId: 11, requiredQuantity: 200_000 }),
    // Chicken is held in pieces, so 200 grams of it is a Unit Conflict
    buildIngredient({ recipeId: 22, foodTypeId: 12, requiredQuantity: 200_000 }),
    buildIngredient({ recipeId: 22, foodTypeId: 13, requiredQuantity: 300_000 }),
    buildIngredient({ recipeId: 23, foodTypeId: 14, requiredQuantity: 2_000, requiredUnit: 'pieces' }),
    buildIngredient({ recipeId: 23, foodTypeId: 13, requiredQuantity: 300_000 }),
    buildIngredient({ recipeId: 23, foodTypeId: 11, requiredQuantity: 50_000 }),
    buildIngredient({ recipeId: 24, foodTypeId: 10, requiredQuantity: 500_000 }),
  ],
  // 150 g Beef and 250 g Broccoli as in spec 4.5; 300 g Rice and 2 Eggs; no Broccoli shortage for the fried rice
  batches: [batch(30, 10, 150_000, NEAR), batch(31, 11, 250_000), batch(32, 13, 300_000), batch(33, 14, 2_000)],
});

describe('BC-15 CatalogBuilder', () => {
  it('lists every recipe A to Z, whatever its status and whether or not it uses near-expiry stock (spec 4.4.C)', () => {
    const dto = valueOf(catalog(kitchen));

    expect(dto.rows.map((row) => row.name)).toEqual(['Beef and Broccoli Stir-Fry', 'Beef Stew', 'Chicken Fried Rice', 'Egg Fried Rice', 'Tofu Soup']);
    expect(dto.cuisineId).toBeNull();
  });

  it('shows a Full Match with every row available', () => {
    expect(rowNamed(valueOf(catalog(kitchen)), 'Egg Fried Rice')).toMatchObject({ status: 'full', availableCount: 3, totalCount: 3 });
  });

  it('shows the Partial Match of spec 4.5 with its Missing row badged and "1 of 2 ingredients available"', () => {
    const stirFry = rowNamed(valueOf(catalog(kitchen)), 'Beef and Broccoli Stir-Fry');

    expect(stirFry).toEqual({
      recipeId: 21,
      name: 'Beef and Broccoli Stir-Fry',
      cuisineId: 5,
      cuisineName: 'Chinese Cuisine',
      status: 'partial',
      availableCount: 1,
      totalCount: 2,
      ingredients: [
        { foodTypeId: 10, name: 'Beef', requiredQuantity: 300_000, requiredUnit: 'grams', available: 150_000, state: 'missing', rescued: false, foodTypeUnit: null },
        { foodTypeId: 11, name: 'Broccoli', requiredQuantity: 200_000, requiredUnit: 'grams', available: 250_000, state: 'ok', rescued: false, foodTypeUnit: null },
      ],
    });
  });

  it('shows a recipe with no available ingredient as nothing, which cannot be cooked (exception row 16)', () => {
    expect(rowNamed(valueOf(catalog(kitchen)), 'Beef Stew')).toMatchObject({ status: 'nothing', availableCount: 0, totalCount: 1 });
  });

  it('shows a Unit Conflict red with both units on its row, and evaluates no row of it (exception row 6)', () => {
    const friedRice = rowNamed(valueOf(catalog(kitchen)), 'Chicken Fried Rice');

    expect(friedRice).toMatchObject({ status: 'blocked', availableCount: 0, totalCount: 2 });
    expect(friedRice?.ingredients).toEqual([
      { foodTypeId: 12, name: 'Chicken', requiredQuantity: 200_000, requiredUnit: 'grams', available: null, state: 'unitConflict', rescued: false, foodTypeUnit: 'pieces' },
      { foodTypeId: 13, name: 'Rice', requiredQuantity: 300_000, requiredUnit: 'grams', available: null, state: 'ok', rescued: false, foodTypeUnit: null },
    ]);
  });

  it('shows a recipe whose Food Type was deleted red, with the deleted name for "Missing food type: Tofu" (exception row 7)', () => {
    const soup = rowNamed(valueOf(catalog(kitchen)), 'Tofu Soup');

    expect(soup).toMatchObject({ status: 'blocked', cuisineId: SYSTEM_IDS.CUISINE_OTHER, cuisineName: 'Other' });
    expect(soup?.ingredients.map((line) => [line.name, line.state, line.available])).toEqual([
      ['Tofu', 'missingFoodType', null],
      ['Egg', 'ok', null],
    ]);
  });

  describe('the cuisine filter', () => {
    it('lists only the recipes of the chosen cuisine, still A to Z, and repeats the filter', () => {
      const chinese = valueOf(catalog(kitchen, 5));

      expect(chinese.cuisineId).toBe(5);
      expect(chinese.rows.map((row) => row.name)).toEqual(['Beef and Broccoli Stir-Fry', 'Chicken Fried Rice', 'Egg Fried Rice']);
      expect(valueOf(catalog(kitchen, 6)).rows.map((row) => row.name)).toEqual(['Beef Stew']);
    });

    it('takes the system cuisine Other as a cuisine like any other', () => {
      expect(valueOf(catalog(kitchen, SYSTEM_IDS.CUISINE_OTHER)).rows.map((row) => row.name)).toEqual(['Tofu Soup']);
    });

    it('lists every recipe with no filter, whether it is null or left out (the default: All)', () => {
      expect(valueOf(catalog(kitchen, null)).rows).toHaveLength(5);
      expect(valueOf(catalog(kitchen)).rows).toHaveLength(5);
    });

    it('answers CATEGORY_NOT_FOUND for a cuisine that does not exist, such as one deleted since it was chosen', () => {
      const result = catalog(kitchen, 404);

      expect(result).toMatchObject({ ok: false, err: { code: 'CATEGORY_NOT_FOUND' } });
      expect(result.ok ? '' : result.err.detail).toContain('404');
    });

    it('answers CATEGORY_NOT_FOUND for a food category, which is not a cuisine', () => {
      expect(catalog(kitchen, 7)).toMatchObject({ ok: false, err: { code: 'CATEGORY_NOT_FOUND' } });
      expect(catalog(kitchen, SYSTEM_IDS.FOOD_OTHER)).toMatchObject({ ok: false, err: { code: 'CATEGORY_NOT_FOUND' } });
    });
  });

  it('gives an empty catalog when there is no recipe', () => {
    expect(valueOf(catalog(buildSnapshot()))).toEqual({ cuisineId: null, rows: [] });
  });
});
