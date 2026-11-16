import type { Id, QtyMilli } from '@freshrescue/contract-primitives';
import type {
  BatchStatus,
  CookOutcome,
  EmptyState,
  IngredientState,
  RecipeErrorReason,
  RecipeStatus,
  RecommendationTier,
  SkipReason,
} from '@freshrescue/contract-rules';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  Allocation,
  BatchView,
  CatalogDto,
  CatalogRow,
  CookReportDto,
  CookReportEntry,
  FoodTypeDetailDto,
  InventoryListDto,
  MatchMap,
  PathMap,
  RecipeErrorRow,
  RecipeErrors,
  RecipeLine,
  RecipeMatch,
  RecommendationDto,
  ReferenceDataDto,
  StatusQuantities,
  StockMap,
  ThresholdEntry,
  ThresholdMap,
  WarningPanelDto,
  WarningRow,
} from './index';

describe('views', () => {
  it('describes the derived shapes that modules pass to each other', () => {
    expectTypeOf<keyof BatchView>().toEqualTypeOf<
      'id' | 'foodTypeId' | 'quantity' | 'inboundDate' | 'expirationDate' | 'createdSeq' | 'daysLeft' | 'status'
    >();
    expectTypeOf<BatchView['status']>().toEqualTypeOf<BatchStatus>();
    expectTypeOf<keyof StatusQuantities>().toEqualTypeOf<BatchStatus>();
    expectTypeOf<RecipeErrorRow['reason']>().toEqualTypeOf<RecipeErrorReason>();
    expectTypeOf<RecipeMatch['status']>().toEqualTypeOf<RecipeStatus>();
    expectTypeOf<Allocation['takes'][number]>().toEqualTypeOf<{
      readonly batchId: Id;
      readonly takeMilli: QtyMilli;
      readonly emptied: boolean;
    }>();

    // FEFO (spec 4.5): 300 g of Beef come from batch B (150 g, used up) and batch C (150 g of 200 g)
    const beef: Allocation = {
      foodTypeId: 1,
      takes: [
        { batchId: 2, takeMilli: 150_000, emptied: true },
        { batchId: 3, takeMilli: 150_000, emptied: false },
      ],
    };
    expect(beef.takes.reduce((sum, take) => sum + take.takeMilli, 0)).toBe(300_000);

    // a lookup that misses reads as undefined, so a module has to handle it
    const stock: StockMap = {
      1: { total: 450_000, avail: 350_000, near: 150_000, byStatus: { fresh: 200_000, nearExpiry: 150_000, expired: 100_000 }, overall: 'expired' },
    };
    const thresholds: ThresholdMap = { 1: { days: 3, source: 'global' } };
    expect(stock[1]?.avail).toBe(350_000);
    expect(stock[9]).toBeUndefined();
    expectTypeOf(thresholds[9]).toEqualTypeOf<ThresholdEntry | undefined>();

    // the Partial-match example of spec 4.5: 300 g Beef and 200 g Broccoli against 150 g and 250 g in stock
    const matches: MatchMap = {
      11: {
        status: 'partial',
        rows: [
          { foodTypeId: 9, qReq: 300_000, avail: 150_000, fulfilled: false, rescued: false },
          { foodTypeId: 10, qReq: 200_000, avail: 250_000, fulfilled: true, rescued: false },
        ],
        availableCount: 1,
        hasRescued: false,
      },
    };
    expect(matches[11]?.rows.filter((row) => row.fulfilled)).toHaveLength(matches[11]?.availableCount ?? -1);

    // the two errors that block a recipe, and the category path of a Food Type
    const errors: RecipeErrors = {
      12: [
        { reason: 'unitConflict', foodTypeId: 5, requiredUnit: 'grams', foodTypeUnit: 'pieces' },
        { reason: 'missingFoodType', foodTypeId: 99, deletedFoodTypeName: 'Tofu' },
      ],
    };
    const paths: PathMap = { 5: { categoryId: 4, names: ['Meat', 'Poultry'] } };
    expect(errors[12]?.map((row) => row.reason)).toEqual(['unitConflict', 'missingFoodType']);
    expect(paths[5]?.names.join(' → ')).toBe('Meat → Poultry');
  });

  it('gives each of the seven read models its fields', () => {
    expectTypeOf<keyof InventoryListDto>().toEqualTypeOf<'rows'>();
    expectTypeOf<keyof FoodTypeDetailDto>().toEqualTypeOf<
      | 'foodTypeId'
      | 'name'
      | 'categoryId'
      | 'categoryPath'
      | 'unit'
      | 'customThresholdDays'
      | 'threshold'
      | 'total'
      | 'byStatus'
      | 'overall'
      | 'batches'
      | 'referencingRecipes'
    >();
    expectTypeOf<keyof WarningPanelDto>().toEqualTypeOf<'nearExpiry' | 'expired'>();
    expectTypeOf<keyof RecommendationDto>().toEqualTypeOf<'tier' | 'recipes' | 'emptyState'>();
    expectTypeOf<keyof CatalogDto>().toEqualTypeOf<'cuisineId' | 'rows'>();
    expectTypeOf<keyof CookReportDto>().toEqualTypeOf<'reports'>();
    expectTypeOf<keyof ReferenceDataDto>().toEqualTypeOf<
      'today' | 'simulatedToday' | 'globalThresholdDays' | 'units' | 'foodCategories' | 'cuisines' | 'foodTypes'
    >();

    const reference: ReferenceDataDto = {
      today: '2026-10-01',
      simulatedToday: null,
      globalThresholdDays: 3,
      units: ['grams', 'kg', 'ml', 'liters', 'pieces', 'cartons'],
      foodCategories: [
        {
          id: 3,
          name: 'Meat',
          isSystem: false,
          customThresholdDays: null,
          children: [{ id: 4, name: 'Poultry', isSystem: false, customThresholdDays: 2, children: [] }],
        },
        { id: 1, name: 'Other', isSystem: true, customThresholdDays: null, children: [] },
      ],
      cuisines: [{ id: 2, name: 'Other', isSystem: true, customThresholdDays: null, children: [] }],
      foodTypes: [{ id: 5, name: 'Chicken', unit: 'grams', categoryId: 4 }],
    };
    expect(reference.foodCategories[0]?.children[0]?.name).toBe('Poultry');
    expect(reference.foodCategories.find((node) => node.isSystem)?.name).toBe('Other');

    // Feature 5 list (spec 4.7.1, exception rows 22 and 23): a breakdown by status, and a Food Type with no stock
    const inventory: InventoryListDto = {
      rows: [
        {
          foodTypeId: 5,
          name: 'Chicken',
          categoryPath: ['Meat', 'Poultry'],
          unit: 'grams',
          total: 550_000,
          byStatus: { fresh: 300_000, nearExpiry: 150_000, expired: 100_000 },
          overall: 'expired',
        },
        {
          foodTypeId: 8,
          name: 'Tomato',
          categoryPath: ['Vegetables'],
          unit: 'pieces',
          total: 0,
          byStatus: { fresh: 0, nearExpiry: 0, expired: 0 },
          overall: null,
        },
      ],
    };
    for (const row of inventory.rows) {
      expect(row.byStatus.fresh + row.byStatus.nearExpiry + row.byStatus.expired).toBe(row.total);
    }

    // the detail of Chicken with the two batches of spec 4.2.2, a day apart in expiry
    const detail: FoodTypeDetailDto = {
      foodTypeId: 5,
      name: 'Chicken',
      categoryId: 4,
      categoryPath: ['Meat', 'Poultry'],
      unit: 'grams',
      customThresholdDays: null,
      threshold: { days: 3, source: 'global' },
      total: 300_000,
      byStatus: { fresh: 0, nearExpiry: 300_000, expired: 0 },
      overall: 'nearExpiry',
      batches: [
        { id: 20, foodTypeId: 5, quantity: 100_000, inboundDate: '2026-10-01', expirationDate: '2026-10-03', createdSeq: 1, daysLeft: 1, status: 'nearExpiry' },
        { id: 21, foodTypeId: 5, quantity: 200_000, inboundDate: '2026-10-01', expirationDate: '2026-10-04', createdSeq: 2, daysLeft: 2, status: 'nearExpiry' },
      ],
      referencingRecipes: [{ recipeId: 12, name: 'Chicken Fried Rice' }],
    };
    expect(detail.batches.reduce((sum, batch) => sum + batch.quantity, 0)).toBe(detail.total);

    // the Warning Panel: a Near-Expiry batch, and an Expired one in its own section
    const warnings: WarningPanelDto = {
      nearExpiry: [
        { batchId: 20, foodTypeId: 5, foodTypeName: 'Chicken', unit: 'grams', quantity: 100_000, expirationDate: '2026-10-03', daysLeft: 1, status: 'nearExpiry' },
      ],
      expired: [
        { batchId: 17, foodTypeId: 9, foodTypeName: 'Beef', unit: 'grams', quantity: 100_000, expirationDate: '2026-09-30', daysLeft: -1, status: 'expired' },
      ],
    };
    expect(warnings.expired[0]?.daysLeft).toBeLessThan(0);

    // Feature 3, tier 1: a recipe that rescues Beef, which is near expiry
    const recommendation: RecommendationDto = {
      tier: 'full',
      emptyState: null,
      recipes: [
        {
          recipeId: 11,
          name: 'Beef and Broccoli Stir-Fry',
          cuisineName: 'Chinese Cuisine',
          availableCount: 2,
          totalCount: 2,
          ingredients: [
            { foodTypeId: 9, name: 'Beef', requiredQuantity: 300_000, requiredUnit: 'grams', available: 350_000, state: 'ok', rescued: true, foodTypeUnit: null },
            { foodTypeId: 10, name: 'Broccoli', requiredQuantity: 200_000, requiredUnit: 'grams', available: 250_000, state: 'ok', rescued: false, foodTypeUnit: null },
          ],
        },
      ],
    };
    expect(recommendation.recipes[0]?.ingredients.some((line) => line.rescued)).toBe(true);

    // Feature 4: a blocked recipe (exception row 6) shows its conflicting row, and none of its rows is evaluated
    const catalog: CatalogDto = {
      cuisineId: null,
      rows: [
        {
          recipeId: 12,
          name: 'Chicken Fried Rice',
          cuisineId: 14,
          cuisineName: 'Chinese Cuisine',
          status: 'blocked',
          availableCount: 0,
          totalCount: 2,
          ingredients: [
            { foodTypeId: 5, name: 'Chicken', requiredQuantity: 200_000, requiredUnit: 'grams', available: null, state: 'unitConflict', rescued: false, foodTypeUnit: 'pieces' },
            { foodTypeId: 11, name: 'Rice', requiredQuantity: 300_000, requiredUnit: 'grams', available: null, state: 'ok', rescued: false, foodTypeUnit: null },
          ],
        },
      ],
    };
    expect(catalog.rows[0]?.ingredients.every((line) => line.available === null)).toBe(true);

    // the Partial-match example of spec 4.5: Broccoli is deducted, Beef is missing (needed 300, available 150)
    const report: CookReportDto = {
      reports: [
        {
          recipeId: 11,
          recipeName: 'Beef and Broccoli Stir-Fry',
          outcome: 'cooked',
          reason: null,
          deducted: [{ foodTypeId: 10, name: 'Broccoli', quantity: 200_000, unit: 'grams' }],
          missing: [{ foodTypeId: 9, name: 'Beef', needed: 300_000, available: 150_000, unit: 'grams' }],
        },
      ],
    };
    expect(report.reports[0]?.missing[0]).toMatchObject({ needed: 300_000, available: 150_000 });
  });

  it('draws every status and empty state from the shared vocabularies', () => {
    expectTypeOf<WarningRow['status']>().toEqualTypeOf<BatchStatus>();
    expectTypeOf<RecommendationDto['tier']>().toEqualTypeOf<RecommendationTier | null>();
    expectTypeOf<RecommendationDto['emptyState']>().toEqualTypeOf<EmptyState | null>();
    expectTypeOf<CatalogRow['status']>().toEqualTypeOf<RecipeStatus>();
    expectTypeOf<RecipeLine['state']>().toEqualTypeOf<IngredientState>();
    expectTypeOf<CookReportEntry['outcome']>().toEqualTypeOf<CookOutcome>();
    expectTypeOf<CookReportEntry['reason']>().toEqualTypeOf<SkipReason | null>();

    // the two empty states of Feature 3 (spec 4.6, exception rows 13 and 17)
    const nothingNearExpiry: RecommendationDto = { tier: null, recipes: [], emptyState: 'noNearExpiry' };
    const nothingRescues: RecommendationDto = { tier: null, recipes: [], emptyState: 'noRescue' };
    expect([nothingNearExpiry.emptyState, nothingRescues.emptyState]).toEqual(['noNearExpiry', 'noRescue']);

    // a row that cannot be evaluated: its Food Type was deleted (exception row 7)
    const deleted: RecipeLine = {
      foodTypeId: 9,
      name: 'Tofu',
      requiredQuantity: 200_000,
      requiredUnit: 'grams',
      available: null,
      state: 'missingFoodType',
      rescued: false,
      foodTypeUnit: null,
    };
    // a recipe with nothing to deduct is skipped (exception row 16)
    const skipped: CookReportEntry = {
      recipeId: 7,
      recipeName: 'Chicken Fried Rice',
      outcome: 'skipped',
      reason: 'nothingAvailable',
      deducted: [],
      missing: [],
    };
    expect(deleted.available).toBeNull();
    expect(skipped.reason).toBe('nothingAvailable');
  });
});
