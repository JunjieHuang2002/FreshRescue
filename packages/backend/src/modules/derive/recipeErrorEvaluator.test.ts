import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@freshrescue/contract-entities';
import { buildBatch, buildFoodType, buildIngredient, buildRecipe, buildSnapshot } from '../../testing/fixtures';
import { recipeErrorEvaluator } from './recipeErrorEvaluator';

// Chicken (10) is in grams, Egg (11) and Tomato (12) in pieces. Tofu had the id 9 and was deleted, so
// the row that used it keeps its name.
const kitchen = (): Snapshot =>
  buildSnapshot({
    foodTypes: [
      buildFoodType({ id: 10, name: 'Chicken' }),
      buildFoodType({ id: 11, name: 'Egg', unit: 'pieces' }),
      buildFoodType({ id: 12, name: 'Tomato', unit: 'pieces' }),
    ],
    recipes: [
      buildRecipe({ id: 20, name: 'Chicken Fried Rice' }),
      buildRecipe({ id: 21, name: 'Tofu Soup' }),
      buildRecipe({ id: 22, name: 'Chicken Skewers' }),
      buildRecipe({ id: 23, name: 'Tomato Tofu Bake' }),
    ],
    recipeIngredients: [
      buildIngredient({ recipeId: 20, foodTypeId: 10, requiredQuantity: 200_000 }),
      buildIngredient({ recipeId: 20, foodTypeId: 11, requiredQuantity: 2_000, requiredUnit: 'pieces' }),
      buildIngredient({ recipeId: 21, foodTypeId: 9, requiredQuantity: 300_000, deletedFoodTypeName: 'Tofu' }),
      buildIngredient({ recipeId: 21, foodTypeId: 11, requiredQuantity: 1_000, requiredUnit: 'pieces' }),
      buildIngredient({ recipeId: 22, foodTypeId: 10, requiredQuantity: 4_000, requiredUnit: 'pieces' }),
      buildIngredient({ recipeId: 23, foodTypeId: 12, requiredQuantity: 500, requiredUnit: 'grams' }),
      buildIngredient({ recipeId: 23, foodTypeId: 11, requiredQuantity: 1_000, requiredUnit: 'pieces' }),
      buildIngredient({ recipeId: 23, foodTypeId: 9, requiredQuantity: 200_000, deletedFoodTypeName: 'Tofu' }),
    ],
  });

describe('BC-12 RecipeErrorEvaluator', () => {
  it('gives no entry to a recipe without an error', () => {
    expect(recipeErrorEvaluator(kitchen())[20]).toBeUndefined();
    expect(recipeErrorEvaluator(buildSnapshot())).toEqual({});
  });

  it('finds a row whose Food Type was deleted, with the name it had (spec 4.2.4, exception row 7)', () => {
    expect(recipeErrorEvaluator(kitchen())[21]).toEqual([{ reason: 'missingFoodType', foodTypeId: 9, deletedFoodTypeName: 'Tofu' }]);
  });

  it('finds a row whose Required Unit is not the Food Type\'s unit, with both units (spec 4.4.A, exception row 6)', () => {
    expect(recipeErrorEvaluator(kitchen())[22]).toEqual([{ reason: 'unitConflict', foodTypeId: 10, requiredUnit: 'pieces', foodTypeUnit: 'grams' }]);
  });

  it('shows both errors of one recipe, each on its row, in the order of the rows, and leaves the fine row out', () => {
    expect(recipeErrorEvaluator(kitchen())[23]).toEqual([
      { reason: 'unitConflict', foodTypeId: 12, requiredUnit: 'grams', foodTypeUnit: 'pieces' },
      { reason: 'missingFoodType', foodTypeId: 9, deletedFoodTypeName: 'Tofu' },
    ]);
  });

  it('has an entry for exactly the recipes with an error', () => {
    expect(Object.keys(recipeErrorEvaluator(kitchen())).map(Number)).toEqual([21, 22, 23]);
  });

  it('judges a unit against the Food Type\'s unit whatever the stock, so a Food Type with no batch can conflict', () => {
    const withStock = { ...kitchen(), batches: [buildBatch({ id: 30, foodTypeId: 10, quantity: 900_000 })] };

    expect(recipeErrorEvaluator(withStock)[22]).toEqual(recipeErrorEvaluator(kitchen())[22]);
    expect(recipeErrorEvaluator(kitchen())[22]).toHaveLength(1);
  });

  it('compares units by exact equality, with no conversion: kg is not grams', () => {
    const snapshot = buildSnapshot({
      foodTypes: [buildFoodType({ id: 10, name: 'Beef', unit: 'kg' })],
      recipes: [buildRecipe({ id: 20, name: 'Stew' })],
      recipeIngredients: [buildIngredient({ recipeId: 20, foodTypeId: 10, requiredUnit: 'grams' })],
    });

    expect(recipeErrorEvaluator(snapshot)[20]).toEqual([{ reason: 'unitConflict', foodTypeId: 10, requiredUnit: 'grams', foodTypeUnit: 'kg' }]);
  });

  it('turns a recipe into a Unit Conflict as soon as its Food Type changes unit, without rewriting it (spec 4.2.2)', () => {
    const converted = { ...kitchen(), foodTypes: kitchen().foodTypes.map((f) => (f.id === 10 ? { ...f, unit: 'pieces' } : f)) };

    expect(recipeErrorEvaluator(converted)[20]).toEqual([{ reason: 'unitConflict', foodTypeId: 10, requiredUnit: 'grams', foodTypeUnit: 'pieces' }]);
    // the recipe that asked for pieces of Chicken is now fine
    expect(recipeErrorEvaluator(converted)[22]).toBeUndefined();
  });

  it('is not repaired by a new Food Type with the deleted name: rows name a Food Type by id (spec 4.2.4)', () => {
    const recreated = { ...kitchen(), foodTypes: [...kitchen().foodTypes, buildFoodType({ id: 40, name: 'Tofu' })] };

    expect(recipeErrorEvaluator(recreated)[21]).toEqual([{ reason: 'missingFoodType', foodTypeId: 9, deletedFoodTypeName: 'Tofu' }]);
  });

  it('takes either sign of a deletion: a Food Type that is gone, or a row that carries a deleted name', () => {
    const snapshot = buildSnapshot({
      foodTypes: [buildFoodType({ id: 10, name: 'Chicken' })],
      recipes: [buildRecipe({ id: 20, name: 'A' }), buildRecipe({ id: 21, name: 'B' })],
      recipeIngredients: [
        // gone, and no name was kept
        buildIngredient({ recipeId: 20, foodTypeId: 9 }),
        // a name was kept although the Food Type is there: the recipe stays blocked, the safe side
        buildIngredient({ recipeId: 21, foodTypeId: 10, deletedFoodTypeName: 'Chicken' }),
      ],
    });

    expect(recipeErrorEvaluator(snapshot)).toEqual({
      20: [{ reason: 'missingFoodType', foodTypeId: 9, deletedFoodTypeName: null }],
      21: [{ reason: 'missingFoodType', foodTypeId: 10, deletedFoodTypeName: 'Chicken' }],
    });
  });

  it('leaves out a row whose recipe is not in the snapshot', () => {
    const orphan = { ...kitchen(), recipeIngredients: [...kitchen().recipeIngredients, buildIngredient({ recipeId: 99, foodTypeId: 9 })] };

    expect(recipeErrorEvaluator(orphan)[99]).toBeUndefined();
  });
});
