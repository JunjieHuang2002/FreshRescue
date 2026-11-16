import { EMPTY_SNAPSHOT } from '@freshrescue/contract-entities';
import type {
  Batch,
  FoodCategory,
  FoodType,
  RawStore,
  Recipe,
  RecipeCategory,
  RecipeIngredient,
  Snapshot,
} from '@freshrescue/contract-entities';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import type { SeedBundle } from '@freshrescue/contract-seed';

// Builders for the backend tests (plan, phase 3). This is not a module and production code never
// imports it. Each builder takes the fields a test cares about and fills in the rest with plain
// defaults, so a test reads as the scenario it describes.

/** The system category `Other` of the food tree, as SystemDataInitializer stores it. */
export const OTHER_FOOD_CATEGORY: FoodCategory = {
  id: SYSTEM_IDS.FOOD_OTHER,
  name: 'Other',
  parentId: null,
  isSystem: true,
  customThresholdDays: null,
};

/** The system category `Other` of the cuisine tree. */
export const OTHER_CUISINE: RecipeCategory = { id: SYSTEM_IDS.CUISINE_OTHER, name: 'Other', isSystem: true };

export const buildFoodCategory = (fields: Pick<FoodCategory, 'id' | 'name'> & Partial<FoodCategory>): FoodCategory => ({
  parentId: null,
  isSystem: false,
  customThresholdDays: null,
  ...fields,
});

/** A Food Type in the category `Other`, in grams, with no custom threshold, unless the test says otherwise. */
export const buildFoodType = (fields: Pick<FoodType, 'id' | 'name'> & Partial<FoodType>): FoodType => ({
  categoryId: SYSTEM_IDS.FOOD_OTHER,
  unit: 'grams',
  customThresholdDays: null,
  ...fields,
});

/** A batch of 1 unit (1000 thousandths) added on Oct 1, 2026 and expiring on Oct 4, 2026. Its `createdSeq` follows its id. */
export const buildBatch = (fields: Pick<Batch, 'id' | 'foodTypeId'> & Partial<Batch>): Batch => ({
  quantity: 1000,
  inboundDate: '2026-10-01',
  expirationDate: '2026-10-04',
  createdSeq: fields.id,
  ...fields,
});

export const buildRecipeCategory = (fields: Pick<RecipeCategory, 'id' | 'name'> & Partial<RecipeCategory>): RecipeCategory => ({
  isSystem: false,
  ...fields,
});

/** A recipe in the cuisine `Other`. */
export const buildRecipe = (fields: Pick<Recipe, 'id' | 'name'> & Partial<Recipe>): Recipe => ({
  recipeCategoryId: SYSTEM_IDS.CUISINE_OTHER,
  ...fields,
});

/** An ingredient row of 1 gram of a live Food Type. */
export const buildIngredient = (fields: Pick<RecipeIngredient, 'recipeId' | 'foodTypeId'> & Partial<RecipeIngredient>): RecipeIngredient => ({
  requiredQuantity: 1000,
  requiredUnit: 'grams',
  deletedFoodTypeName: null,
  ...fields,
});

/**
 * A snapshot that starts from the two system categories, as the store looks after startup, and adds
 * the records a test passes in: pass only the extra categories. The counters are worked out from the
 * records (one counter serves every kind of record) unless the test sets them. For a store that has
 * nothing in it at all, use `EMPTY_SNAPSHOT`.
 */
export function buildSnapshot(parts: Partial<Snapshot> = {}): Snapshot {
  const foodCategories = [OTHER_FOOD_CATEGORY, ...(parts.foodCategories ?? [])];
  const recipeCategories = [OTHER_CUISINE, ...(parts.recipeCategories ?? [])];
  const { foodTypes = [], batches = [], recipes = [], recipeIngredients = [] } = parts;
  const ids = [...foodCategories, ...recipeCategories, ...foodTypes, ...batches, ...recipes].map((row) => row.id);
  return {
    foodCategories,
    foodTypes,
    batches,
    recipeCategories,
    recipes,
    recipeIngredients,
    settings: parts.settings ?? EMPTY_SNAPSHOT.settings,
    counters: parts.counters ?? {
      nextId: Math.max(...ids) + 1,
      nextSeq: Math.max(0, ...batches.map((batch) => batch.createdSeq)) + 1,
    },
  };
}

/** What the store would hold for a snapshot: the same data as a JSON document that has been through the wire. */
export const rawStoreOf = (snapshot: Snapshot): RawStore => JSON.parse(JSON.stringify(snapshot));

/**
 * The sample pre-load of spec Appendix A as a seed bundle: the preset food categories and cuisines,
 * the 8 Food Types and the 6 built-in recipes, with quantities in thousandths, no batch and no
 * threshold. Every Required Unit equals its Food Type's unit, so no recipe starts red. A null key is
 * the system `Other`. Phase 7 stores the same data as packages/backend/seed/freshrescue.seed.json.
 */
export const APPENDIX_A_SEED: SeedBundle = {
  foodCategories: [
    { key: 'meat', name: 'Meat', parentKey: null },
    { key: 'redMeat', name: 'Red Meat', parentKey: 'meat' },
    { key: 'poultry', name: 'Poultry', parentKey: 'meat' },
    { key: 'dairy', name: 'Dairy', parentKey: null },
    { key: 'liquidDairy', name: 'Liquid Dairy', parentKey: 'dairy' },
    { key: 'vegetables', name: 'Vegetables', parentKey: null },
    { key: 'leafyGreens', name: 'Leafy Greens', parentKey: 'vegetables' },
  ],
  cuisines: [
    { key: 'chinese', name: 'Chinese Cuisine' },
    { key: 'vietnamese', name: 'Vietnamese Cuisine' },
    { key: 'french', name: 'French Cuisine' },
  ],
  foodTypes: [
    { key: 'beef', name: 'Beef', categoryKey: 'redMeat', unit: 'grams' },
    { key: 'broccoli', name: 'Broccoli', categoryKey: 'vegetables', unit: 'grams' },
    { key: 'chicken', name: 'Chicken', categoryKey: 'poultry', unit: 'grams' },
    { key: 'egg', name: 'Egg', categoryKey: null, unit: 'pieces' },
    { key: 'milk', name: 'Milk', categoryKey: 'liquidDairy', unit: 'ml' },
    { key: 'rice', name: 'Rice', categoryKey: null, unit: 'grams' },
    { key: 'spinach', name: 'Spinach', categoryKey: 'leafyGreens', unit: 'grams' },
    { key: 'tomato', name: 'Tomato', categoryKey: 'vegetables', unit: 'pieces' },
  ],
  recipes: [
    {
      key: 'beefBroccoliStirFry',
      name: 'Beef and Broccoli Stir-Fry',
      cuisineKey: 'chinese',
      ingredients: [
        { foodTypeKey: 'beef', quantity: 300_000, unit: 'grams' },
        { foodTypeKey: 'broccoli', quantity: 200_000, unit: 'grams' },
      ],
    },
    {
      key: 'chickenBroccoliGratin',
      name: 'Chicken Broccoli Gratin',
      cuisineKey: 'french',
      ingredients: [
        { foodTypeKey: 'chicken', quantity: 250_000, unit: 'grams' },
        { foodTypeKey: 'broccoli', quantity: 150_000, unit: 'grams' },
        { foodTypeKey: 'milk', quantity: 100_000, unit: 'ml' },
      ],
    },
    {
      key: 'chickenFriedRice',
      name: 'Chicken Fried Rice',
      cuisineKey: 'chinese',
      ingredients: [
        { foodTypeKey: 'chicken', quantity: 200_000, unit: 'grams' },
        { foodTypeKey: 'rice', quantity: 300_000, unit: 'grams' },
        { foodTypeKey: 'egg', quantity: 2_000, unit: 'pieces' },
      ],
    },
    {
      key: 'spinachOmelette',
      name: 'Spinach Omelette',
      cuisineKey: 'french',
      ingredients: [
        { foodTypeKey: 'egg', quantity: 3_000, unit: 'pieces' },
        { foodTypeKey: 'spinach', quantity: 50_000, unit: 'grams' },
        { foodTypeKey: 'milk', quantity: 50_000, unit: 'ml' },
      ],
    },
    {
      key: 'tomatoEggStirFry',
      name: 'Tomato Egg Stir-Fry',
      cuisineKey: 'chinese',
      ingredients: [
        { foodTypeKey: 'tomato', quantity: 2_000, unit: 'pieces' },
        { foodTypeKey: 'egg', quantity: 3_000, unit: 'pieces' },
      ],
    },
    {
      key: 'vietnameseChickenRice',
      name: 'Vietnamese Chicken Rice',
      cuisineKey: 'vietnamese',
      ingredients: [
        { foodTypeKey: 'chicken', quantity: 250_000, unit: 'grams' },
        { foodTypeKey: 'rice', quantity: 300_000, unit: 'grams' },
      ],
    },
  ],
};
