import type { DomainError } from '@freshrescue/contract-errors';
import type {
  BatchView,
  CatalogDto,
  CatalogRow,
  CategoryNode,
  CookReportDto,
  FoodTypeDetailDto,
  InventoryListDto,
  RecommendationDto,
  RecipeLine,
  ReferenceDataDto,
  WarningPanelDto,
} from '@freshrescue/contract-views';
import type { FieldHints, FormKind, FormMode, FormState, FormValues, OptionLists, ResourceState } from '@freshrescue/contract-ui';

// Sample read models for the tests of the frontend modules. They follow the examples of the
// specification (Appendix A, 4.5, 4.7) so that a test reads like the spec. This is a builder for
// tests: it is not a module, and production code never imports it.

const node = (id: number, name: string, customThresholdDays: number | null = null, children: readonly CategoryNode[] = [], isSystem = false): CategoryNode => ({
  id,
  name,
  isSystem,
  customThresholdDays,
  children,
});

// the preset categories and cuisines of Appendix A, each as a record that an event can carry
export const MEAT = node(3, 'Meat', 5, [node(4, 'Red Meat'), node(5, 'Poultry')]);
export const DAIRY = node(6, 'Dairy', null, [node(7, 'Liquid Dairy')]);
export const VEGETABLES = node(8, 'Vegetables', null, [node(9, 'Leafy Greens')]);
export const OTHER_FOOD = node(1, 'Other', null, [], true);
export const CHINESE = node(10, 'Chinese Cuisine');
export const VIETNAMESE = node(11, 'Vietnamese Cuisine');
export const FRENCH = node(12, 'French Cuisine');
export const OTHER_CUISINE = node(2, 'Other', null, [], true);

/** The reference data of 2026-10-02: the preset categories and cuisines, and the eight Food Types of Appendix A. */
export const REFERENCE: ReferenceDataDto = {
  today: '2026-10-02',
  simulatedToday: null,
  globalThresholdDays: 3,
  units: ['grams', 'kg', 'ml', 'liters', 'pieces', 'cartons'],
  foodCategories: [MEAT, DAIRY, VEGETABLES, OTHER_FOOD],
  cuisines: [CHINESE, VIETNAMESE, FRENCH, OTHER_CUISINE],
  foodTypes: [
    { id: 20, name: 'Beef', unit: 'grams', categoryId: 4 },
    { id: 21, name: 'Broccoli', unit: 'grams', categoryId: 8 },
    { id: 22, name: 'Chicken', unit: 'grams', categoryId: 5 },
    { id: 23, name: 'Egg', unit: 'pieces', categoryId: 1 },
    { id: 24, name: 'Milk', unit: 'ml', categoryId: 7 },
    { id: 25, name: 'Rice', unit: 'grams', categoryId: 1 },
    { id: 26, name: 'Spinach', unit: 'grams', categoryId: 9 },
    { id: 27, name: 'Tomato', unit: 'pieces', categoryId: 8 },
  ],
};

/** The Simulated Today variant of the reference data. */
export const REFERENCE_SIMULATED: ReferenceDataDto = { ...REFERENCE, today: '2026-10-05', simulatedToday: '2026-10-05' };

const NO_STOCK = { fresh: 0, nearExpiry: 0, expired: 0 } as const;

/** Beef has batches in three statuses (spec exception 23), Egg has none (exception 22). */
export const INVENTORY: InventoryListDto = {
  rows: [
    {
      foodTypeId: 20,
      name: 'Beef',
      categoryPath: ['Meat', 'Red Meat'],
      unit: 'grams',
      total: 550_000,
      byStatus: { fresh: 300_000, nearExpiry: 150_000, expired: 100_000 },
      overall: 'expired',
    },
    {
      foodTypeId: 21,
      name: 'Broccoli',
      categoryPath: ['Vegetables'],
      unit: 'grams',
      total: 250_000,
      byStatus: { fresh: 250_000, nearExpiry: 0, expired: 0 },
      overall: 'fresh',
    },
    {
      foodTypeId: 22,
      name: 'Chicken',
      categoryPath: ['Meat', 'Poultry'],
      unit: 'grams',
      total: 1500,
      byStatus: { fresh: 0, nearExpiry: 1500, expired: 0 },
      overall: 'nearExpiry',
    },
    { foodTypeId: 23, name: 'Egg', categoryPath: ['Other'], unit: 'pieces', total: 0, byStatus: NO_STOCK, overall: null },
  ],
};

/** The Expired batch A, the Near-Expiry batch B and the Fresh batch C of Beef (spec 4.5). */
export const BATCH_A: BatchView = { id: 31, foodTypeId: 20, quantity: 100_000, inboundDate: '2026-09-20', expirationDate: '2026-10-01', createdSeq: 1, daysLeft: -1, status: 'expired' };
export const BATCH_B: BatchView = { id: 32, foodTypeId: 20, quantity: 150_000, inboundDate: '2026-09-25', expirationDate: '2026-10-03', createdSeq: 2, daysLeft: 1, status: 'nearExpiry' };
export const BATCH_C: BatchView = { id: 33, foodTypeId: 20, quantity: 300_000, inboundDate: '2026-10-01', expirationDate: '2026-10-09', createdSeq: 3, daysLeft: 7, status: 'fresh' };

/** The detail of Beef: the Expired batch A, the Near-Expiry batch B and the Fresh batch C of spec 4.5. */
export const DETAIL: FoodTypeDetailDto = {
  foodTypeId: 20,
  name: 'Beef',
  categoryId: 4,
  categoryPath: ['Meat', 'Red Meat'],
  unit: 'grams',
  customThresholdDays: null,
  threshold: { days: 5, source: 'parent' },
  total: 550_000,
  byStatus: { fresh: 300_000, nearExpiry: 150_000, expired: 100_000 },
  overall: 'expired',
  batches: [BATCH_A, BATCH_B, BATCH_C],
  referencingRecipes: [{ recipeId: 40, name: 'Beef and Broccoli Stir-Fry' }],
};

/** The detail of Chicken with the two batches of spec 4.2.2 (100 grams and 200 grams), and the two recipes that use it. */
export const DETAIL_CHICKEN: FoodTypeDetailDto = {
  foodTypeId: 22,
  name: 'Chicken',
  categoryId: 5,
  categoryPath: ['Meat', 'Poultry'],
  unit: 'grams',
  customThresholdDays: null,
  threshold: { days: 5, source: 'parent' },
  total: 300_000,
  byStatus: { fresh: 200_000, nearExpiry: 100_000, expired: 0 },
  overall: 'nearExpiry',
  batches: [
    { id: 11, foodTypeId: 22, quantity: 100_000, inboundDate: '2026-10-01', expirationDate: '2026-10-04', createdSeq: 1, daysLeft: 2, status: 'nearExpiry' },
    { id: 12, foodTypeId: 22, quantity: 200_000, inboundDate: '2026-10-02', expirationDate: '2026-10-09', createdSeq: 2, daysLeft: 7, status: 'fresh' },
  ],
  referencingRecipes: [
    { recipeId: 41, name: 'Chicken Fried Rice' },
    { recipeId: 45, name: 'Chicken Broccoli Gratin' },
  ],
};

/** The detail of Egg: registered, with no batch and no recipe. */
export const DETAIL_EMPTY: FoodTypeDetailDto = {
  foodTypeId: 23,
  name: 'Egg',
  categoryId: 1,
  categoryPath: ['Other'],
  unit: 'pieces',
  customThresholdDays: 2,
  threshold: { days: 2, source: 'foodType' },
  total: 0,
  byStatus: NO_STOCK,
  overall: null,
  batches: [],
  referencingRecipes: [],
};

export const WARNINGS: WarningPanelDto = {
  nearExpiry: [
    {
      batchId: 32,
      foodTypeId: 20,
      foodTypeName: 'Beef',
      unit: 'grams',
      quantity: 150_000,
      expirationDate: '2026-10-03',
      daysLeft: 1,
      status: 'nearExpiry',
    },
    {
      batchId: 34,
      foodTypeId: 22,
      foodTypeName: 'Chicken',
      unit: 'grams',
      quantity: 1500,
      expirationDate: '2026-10-02',
      daysLeft: 0,
      status: 'nearExpiry',
    },
  ],
  expired: [
    {
      batchId: 31,
      foodTypeId: 20,
      foodTypeName: 'Beef',
      unit: 'grams',
      quantity: 100_000,
      expirationDate: '2026-10-01',
      daysLeft: -3,
      status: 'expired',
    },
  ],
};

const line = (foodTypeId: number, name: string, requiredQuantity: number, requiredUnit: string, rest: Partial<RecipeLine> = {}): RecipeLine => ({
  foodTypeId,
  name,
  requiredQuantity,
  requiredUnit,
  available: requiredQuantity,
  state: 'ok',
  rescued: false,
  foodTypeUnit: null,
  ...rest,
});

/** A full match that rescues the Near-Expiry Chicken (spec 4.4.B, tier 1). */
export const RECOMMENDATIONS: RecommendationDto = {
  tier: 'full',
  recipes: [
    {
      recipeId: 41,
      name: 'Chicken Fried Rice',
      cuisineName: 'Chinese Cuisine',
      availableCount: 3,
      totalCount: 3,
      ingredients: [
        line(22, 'Chicken', 200_000, 'grams', { available: 500_000, rescued: true }),
        line(25, 'Rice', 300_000, 'grams', { available: 400_000 }),
        line(23, 'Egg', 2000, 'pieces', { available: 6000 }),
      ],
    },
  ],
  emptyState: null,
};

/** Tier 2: the partial matches that show when there is no full match (exception 11). */
export const RECOMMENDATIONS_PARTIAL: RecommendationDto = {
  tier: 'partial',
  recipes: [
    {
      recipeId: 40,
      name: 'Beef and Broccoli Stir-Fry',
      cuisineName: 'Chinese Cuisine',
      availableCount: 1,
      totalCount: 2,
      ingredients: [
        line(20, 'Beef', 300_000, 'grams', { available: 150_000, state: 'missing' }),
        line(21, 'Broccoli', 200_000, 'grams', { available: 250_000, rescued: true }),
      ],
    },
  ],
  emptyState: null,
};

export const RECOMMENDATIONS_NO_NEAR_EXPIRY: RecommendationDto = { tier: null, recipes: [], emptyState: 'noNearExpiry' };
export const RECOMMENDATIONS_NO_RESCUE: RecommendationDto = { tier: null, recipes: [], emptyState: 'noRescue' };

/** One recipe of each status, and the two reasons that block a recipe (spec 4.4.A), each as a record that an event can carry. */
export const STIR_FRY: CatalogRow = {
  recipeId: 40,
  name: 'Beef and Broccoli Stir-Fry',
  cuisineId: 10,
  cuisineName: 'Chinese Cuisine',
  status: 'partial',
  availableCount: 1,
  totalCount: 2,
  ingredients: [
    line(20, 'Beef', 300_000, 'grams', { available: 150_000, state: 'missing' }),
    line(21, 'Broccoli', 200_000, 'grams', { available: 250_000 }),
  ],
};

export const FRIED_RICE: CatalogRow = {
  recipeId: 41,
  name: 'Chicken Fried Rice',
  cuisineId: 10,
  cuisineName: 'Chinese Cuisine',
  status: 'full',
  availableCount: 3,
  totalCount: 3,
  ingredients: [line(22, 'Chicken', 200_000, 'grams'), line(25, 'Rice', 300_000, 'grams'), line(23, 'Egg', 2000, 'pieces')],
};

export const OMELETTE: CatalogRow = {
  recipeId: 42,
  name: 'Spinach Omelette',
  cuisineId: 12,
  cuisineName: 'French Cuisine',
  status: 'nothing',
  availableCount: 0,
  totalCount: 3,
  ingredients: [
    line(23, 'Egg', 3000, 'pieces', { available: 0, state: 'missing' }),
    line(26, 'Spinach', 50_000, 'grams', { available: 0, state: 'missing' }),
    line(24, 'Milk', 50_000, 'ml', { available: 0, state: 'missing' }),
  ],
};

/** Blocked because its Tomato was deleted (spec exception 7). */
export const TOMATO_EGG: CatalogRow = {
  recipeId: 43,
  name: 'Tomato Egg Stir-Fry',
  cuisineId: 10,
  cuisineName: 'Chinese Cuisine',
  status: 'blocked',
  availableCount: 0,
  totalCount: 2,
  ingredients: [
    line(99, 'Tomato', 2000, 'pieces', { available: null, state: 'missingFoodType' }),
    line(23, 'Egg', 3000, 'pieces', { available: null }),
  ],
};

/** Blocked by a unit conflict: it needs Chicken in pieces, and Chicken is held in grams (spec exception 6). */
export const CHICKEN_RICE: CatalogRow = {
  recipeId: 44,
  name: 'Vietnamese Chicken Rice',
  cuisineId: 11,
  cuisineName: 'Vietnamese Cuisine',
  status: 'blocked',
  availableCount: 0,
  totalCount: 2,
  ingredients: [
    line(22, 'Chicken', 250_000, 'pieces', { available: null, state: 'unitConflict', foodTypeUnit: 'grams' }),
    line(25, 'Rice', 300_000, 'grams', { available: null }),
  ],
};

export const CATALOG: CatalogDto = { cuisineId: null, rows: [STIR_FRY, FRIED_RICE, OMELETTE, TOMATO_EGG, CHICKEN_RICE] };

/** A cook report with a cooked recipe that has a Missing Ingredient (spec 4.5), and the three kinds of skip. */
export const COOK_REPORT: CookReportDto = {
  reports: [
    {
      recipeId: 40,
      recipeName: 'Beef and Broccoli Stir-Fry',
      outcome: 'cooked',
      reason: null,
      deducted: [{ foodTypeId: 21, name: 'Broccoli', quantity: 200_000, unit: 'grams' }],
      missing: [{ foodTypeId: 20, name: 'Beef', needed: 300_000, available: 150_000, unit: 'grams' }],
    },
    { recipeId: 42, recipeName: 'Spinach Omelette', outcome: 'skipped', reason: 'nothingAvailable', deducted: [], missing: [] },
    { recipeId: 44, recipeName: 'Vietnamese Chicken Rice', outcome: 'skipped', reason: 'blocked', deducted: [], missing: [] },
    { recipeId: 99, recipeName: 'Recipe 99', outcome: 'skipped', reason: 'recipeNotFound', deducted: [], missing: [] },
  ],
};

// ---- slice states --------------------------------------------------------------------------

export const readyOf = <T>(data: T): ResourceState<T> => ({ value: 'ready', context: { data, error: null } });
export const loadingOf = <T>(data: T | null = null): ResourceState<T> => ({ value: 'loading', context: { data, error: null } });
export const failedOf = <T>(error: DomainError = { code: 'NETWORK_ERROR' }): ResourceState<T> => ({ value: 'failed', context: { data: null, error } });
export const idleOf = <T>(): ResourceState<T> => ({ value: 'idle', context: { data: null, error: null } });

export const CLOSED_FORM: FormState = { value: 'closed', context: { kind: null, values: {}, options: {}, hints: {}, returnTo: 'editing' } };

/** A form in the given mode, with its texts, its drop-down entries and its hints. */
export const formOf = (
  kind: FormKind,
  values: FormValues,
  options: OptionLists = {},
  mode: Exclude<FormMode, 'closed'> = 'editing',
  hints: FieldHints = {},
): FormState => ({
  value: mode,
  context: { kind, values, options, hints, returnTo: mode === 'confirming' ? 'confirming' : 'editing' },
});
