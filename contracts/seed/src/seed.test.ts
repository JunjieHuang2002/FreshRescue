import { describe, expect, expectTypeOf, it } from 'vitest';
import { SEED_ID_ORDER } from './index';
import type { ParsedSeed, SeedBundle, SeedIdList } from './index';

// Appendix A of the specification, as a seed: it shows that the schema can say everything the sample
// data says. It is non-normative, and the real file is written in phase 7.
const APPENDIX_A: SeedBundle = {
  foodCategories: [
    { key: 'meat', name: 'Meat', parentKey: null },
    { key: 'red-meat', name: 'Red Meat', parentKey: 'meat' },
    { key: 'poultry', name: 'Poultry', parentKey: 'meat' },
    { key: 'dairy', name: 'Dairy', parentKey: null },
    { key: 'liquid-dairy', name: 'Liquid Dairy', parentKey: 'dairy' },
    { key: 'vegetables', name: 'Vegetables', parentKey: null },
    { key: 'leafy-greens', name: 'Leafy Greens', parentKey: 'vegetables' },
  ],
  cuisines: [
    { key: 'chinese', name: 'Chinese Cuisine' },
    { key: 'vietnamese', name: 'Vietnamese Cuisine' },
    { key: 'french', name: 'French Cuisine' },
  ],
  foodTypes: [
    { key: 'beef', name: 'Beef', categoryKey: 'red-meat', unit: 'grams' },
    { key: 'broccoli', name: 'Broccoli', categoryKey: 'vegetables', unit: 'grams' },
    { key: 'chicken', name: 'Chicken', categoryKey: 'poultry', unit: 'grams' },
    { key: 'egg', name: 'Egg', categoryKey: null, unit: 'pieces' },
    { key: 'milk', name: 'Milk', categoryKey: 'liquid-dairy', unit: 'ml' },
    { key: 'rice', name: 'Rice', categoryKey: null, unit: 'grams' },
    { key: 'spinach', name: 'Spinach', categoryKey: 'leafy-greens', unit: 'grams' },
    { key: 'tomato', name: 'Tomato', categoryKey: 'vegetables', unit: 'pieces' },
  ],
  recipes: [
    {
      key: 'beef-broccoli',
      name: 'Beef and Broccoli Stir-Fry',
      cuisineKey: 'chinese',
      ingredients: [
        { foodTypeKey: 'beef', quantity: 300_000, unit: 'grams' },
        { foodTypeKey: 'broccoli', quantity: 200_000, unit: 'grams' },
      ],
    },
    {
      key: 'chicken-gratin',
      name: 'Chicken Broccoli Gratin',
      cuisineKey: 'french',
      ingredients: [
        { foodTypeKey: 'chicken', quantity: 250_000, unit: 'grams' },
        { foodTypeKey: 'broccoli', quantity: 150_000, unit: 'grams' },
        { foodTypeKey: 'milk', quantity: 100_000, unit: 'ml' },
      ],
    },
    {
      key: 'chicken-fried-rice',
      name: 'Chicken Fried Rice',
      cuisineKey: 'chinese',
      ingredients: [
        { foodTypeKey: 'chicken', quantity: 200_000, unit: 'grams' },
        { foodTypeKey: 'rice', quantity: 300_000, unit: 'grams' },
        { foodTypeKey: 'egg', quantity: 2_000, unit: 'pieces' },
      ],
    },
    {
      key: 'spinach-omelette',
      name: 'Spinach Omelette',
      cuisineKey: 'french',
      ingredients: [
        { foodTypeKey: 'egg', quantity: 3_000, unit: 'pieces' },
        { foodTypeKey: 'spinach', quantity: 50_000, unit: 'grams' },
        { foodTypeKey: 'milk', quantity: 50_000, unit: 'ml' },
      ],
    },
    {
      key: 'tomato-egg',
      name: 'Tomato Egg Stir-Fry',
      cuisineKey: 'chinese',
      ingredients: [
        { foodTypeKey: 'tomato', quantity: 2_000, unit: 'pieces' },
        { foodTypeKey: 'egg', quantity: 3_000, unit: 'pieces' },
      ],
    },
    {
      key: 'vietnamese-chicken-rice',
      name: 'Vietnamese Chicken Rice',
      cuisineKey: 'vietnamese',
      ingredients: [
        { foodTypeKey: 'chicken', quantity: 250_000, unit: 'grams' },
        { foodTypeKey: 'rice', quantity: 300_000, unit: 'grams' },
      ],
    },
  ],
};

describe('seed', () => {
  it('consumes ids in the order food categories, cuisines, Food Types, recipes', () => {
    expect(SEED_ID_ORDER).toEqual(['foodCategories', 'cuisines', 'foodTypes', 'recipes']);
    expectTypeOf<SeedIdList>().toEqualTypeOf<keyof SeedBundle>();
  });

  it('can say everything that Appendix A says, and the keys can be checked', () => {
    const { foodCategories, cuisines, foodTypes, recipes } = APPENDIX_A;
    const foodCategoryKeys = new Set(foodCategories.map((category) => category.key));
    const cuisineKeys = new Set(cuisines.map((cuisine) => cuisine.key));
    const foodTypeUnit = new Map(foodTypes.map((foodType) => [foodType.key, foodType.unit]));

    expect([foodCategories.length, cuisines.length, foodTypes.length, recipes.length]).toEqual([7, 3, 8, 6]);
    for (const category of foodCategories) {
      expect(category.parentKey === null || foodCategoryKeys.has(category.parentKey)).toBe(true);
    }
    for (const foodType of foodTypes) {
      expect(foodType.categoryKey === null || foodCategoryKeys.has(foodType.categoryKey)).toBe(true);
    }
    for (const recipe of recipes) {
      expect(recipe.cuisineKey === null || cuisineKeys.has(recipe.cuisineKey)).toBe(true);
      // every ingredient uses its Food Type's unit, so no recipe starts red
      for (const row of recipe.ingredients) expect(foodTypeUnit.get(row.foodTypeKey)).toBe(row.unit);
    }
    // quantities are thousandths: 300 grams of Beef is 300,000
    expect(recipes[0]?.ingredients[0]?.quantity).toBe(300_000);
  });

  it('adds only the id demand to a parsed seed', () => {
    const idDemand = SEED_ID_ORDER.reduce((sum, list) => sum + APPENDIX_A[list].length, 0);
    const parsed: ParsedSeed = { ...APPENDIX_A, idDemand };

    expect(parsed.idDemand).toBe(24);
    expectTypeOf<ParsedSeed>().toExtend<SeedBundle>();
    expectTypeOf<keyof ParsedSeed>().toEqualTypeOf<keyof SeedBundle | 'idDemand'>();
  });
});
