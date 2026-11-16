import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { DateISO, Id, Result } from '@freshrescue/contract-primitives';
import type { FoodTypeDetailDto } from '@freshrescue/contract-views';
import { buildBatch, buildFoodCategory, buildFoodType, buildIngredient, buildRecipe, buildSnapshot } from '../../testing/fixtures';
import { batchStatusClassifier } from '../foundation/batchStatusClassifier';
import { thresholdResolver } from '../foundation/thresholdResolver';
import { categoryPathResolver } from './categoryPathResolver';
import { foodTypeDetailProjector } from './foodTypeDetailProjector';
import { stockAggregator } from './stockAggregator';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);

/** getFoodTypeDetail in the blueprint's order: derive, paths, projection. */
function detail(snapshot: Snapshot, foodTypeId: Id, today: DateISO): Result<FoodTypeDetailDto, DomainError> {
  const thresholds = thresholdResolver(snapshot);
  const views = batchStatusClassifier(snapshot.batches, thresholds, today);
  return foodTypeDetailProjector(foodTypeId, snapshot, views, thresholds, stockAggregator(snapshot, views), categoryPathResolver(snapshot));
}

// Dairy (3) with the Child Liquid Dairy (4), whose threshold is 2 days. Milk (10) is in it. Butter (11)
// has a threshold of its own. Cheese (12) has no batch.
const dairy = buildSnapshot({
  foodCategories: [buildFoodCategory({ id: 3, name: 'Dairy', customThresholdDays: 5 }), buildFoodCategory({ id: 4, name: 'Liquid Dairy', parentId: 3, customThresholdDays: 2 })],
  foodTypes: [
    buildFoodType({ id: 10, name: 'Milk', categoryId: 4, unit: 'ml' }),
    buildFoodType({ id: 11, name: 'Butter', categoryId: 3, customThresholdDays: 7 }),
    buildFoodType({ id: 12, name: 'Cheese', categoryId: 3 }),
  ],
  batches: [
    // spec 4.2.1: 500 ml on Oct 1 with a 5-day shelf life, and 1000 ml on Oct 2 with a 10-day shelf life
    buildBatch({ id: 20, foodTypeId: 10, quantity: 500_000, inboundDate: '2026-10-01', expirationDate: '2026-10-06', createdSeq: 1 }),
    buildBatch({ id: 21, foodTypeId: 10, quantity: 1_000_000, inboundDate: '2026-10-02', expirationDate: '2026-10-12', createdSeq: 2 }),
    buildBatch({ id: 22, foodTypeId: 11, quantity: 250_000, inboundDate: '2026-10-02', expirationDate: '2026-10-05', createdSeq: 3 }),
  ],
  recipes: [buildRecipe({ id: 30, name: 'Pancakes' }), buildRecipe({ id: 31, name: 'Cheese Toast' }), buildRecipe({ id: 32, name: 'Custard' })],
  recipeIngredients: [
    buildIngredient({ recipeId: 30, foodTypeId: 10, requiredUnit: 'ml' }),
    buildIngredient({ recipeId: 31, foodTypeId: 12 }),
    buildIngredient({ recipeId: 32, foodTypeId: 11 }),
    buildIngredient({ recipeId: 32, foodTypeId: 10, requiredUnit: 'ml' }),
  ],
});

describe('BC-17 FoodTypeDetailProjector', () => {
  it('lists the two Milk batches of spec 4.2.1 separately, with their days left on Oct 2', () => {
    const milk = valueOf(detail(dairy, 10, '2026-10-02'));

    expect(milk.categoryPath.join(' → ')).toBe('Dairy → Liquid Dairy');
    // "500 ml of Milk — expires in 4 days" and "1000 ml of Milk — expires in 10 days"
    expect(milk.batches.map((b) => [b.quantity, b.daysLeft])).toEqual([[500_000, 4], [1_000_000, 10]]);
    expect(milk.total).toBe(1_500_000);
  });

  it('gives the header of spec 4.7.2: name, path, unit, totals, breakdown and T_eff with its source', () => {
    expect(valueOf(detail(dairy, 10, '2026-10-05'))).toMatchObject({
      foodTypeId: 10,
      name: 'Milk',
      categoryId: 4,
      categoryPath: ['Dairy', 'Liquid Dairy'],
      unit: 'ml',
      customThresholdDays: null,
      // the Child's 2 days beat the Parent's 5
      threshold: { days: 2, source: 'child' },
      total: 1_500_000,
      byStatus: { fresh: 1_000_000, nearExpiry: 500_000, expired: 0 },
      overall: 'nearExpiry',
    });
  });

  it('shows the Food Type\'s own threshold, and that it decided T_eff', () => {
    expect(valueOf(detail(dairy, 11, '2026-10-02'))).toMatchObject({ customThresholdDays: 7, threshold: { days: 7, source: 'foodType' } });
  });

  it('lists every batch of the Food Type, Expired ones included, by D_exp and then createdSeq', () => {
    const snapshot = {
      ...dairy,
      batches: [
        buildBatch({ id: 40, foodTypeId: 10, quantity: 1, expirationDate: '2026-10-09', createdSeq: 7 }),
        buildBatch({ id: 41, foodTypeId: 10, quantity: 2, expirationDate: '2026-10-03', createdSeq: 8 }),
        buildBatch({ id: 42, foodTypeId: 11, quantity: 3, expirationDate: '2026-10-01', createdSeq: 9 }),
        buildBatch({ id: 43, foodTypeId: 10, quantity: 4, expirationDate: '2026-10-09', createdSeq: 5 }),
        buildBatch({ id: 44, foodTypeId: 10, quantity: 5, expirationDate: '2026-09-30', createdSeq: 6 }),
      ],
    };
    const milk = valueOf(detail(snapshot, 10, '2026-10-05'));

    expect(milk.batches.map((b) => b.id)).toEqual([44, 41, 43, 40]);
    expect(milk.batches.map((b) => b.status)).toEqual(['expired', 'expired', 'fresh', 'fresh']);
  });

  it('carries each batch with its dates, days left and status', () => {
    expect(valueOf(detail(dairy, 11, '2026-10-02')).batches).toEqual([
      { id: 22, foodTypeId: 11, quantity: 250_000, inboundDate: '2026-10-02', expirationDate: '2026-10-05', createdSeq: 3, daysLeft: 3, status: 'nearExpiry' },
    ]);
  });

  it('lists the recipes that use the Food Type, for the delete confirmation (spec 4.2.4)', () => {
    expect(valueOf(detail(dairy, 10, '2026-10-02')).referencingRecipes).toEqual([
      { recipeId: 30, name: 'Pancakes' },
      { recipeId: 32, name: 'Custard' },
    ]);
    expect(valueOf(detail(dairy, 12, '2026-10-02')).referencingRecipes).toEqual([{ recipeId: 31, name: 'Cheese Toast' }]);
  });

  it('shows a Food Type without a batch with no batches, quantity 0 and no status', () => {
    expect(valueOf(detail(dairy, 12, '2026-10-02'))).toMatchObject({
      batches: [],
      total: 0,
      byStatus: { fresh: 0, nearExpiry: 0, expired: 0 },
      overall: null,
      threshold: { days: 5, source: 'parent' },
    });
  });

  it('answers FOOD_TYPE_NOT_FOUND for an id that names no Food Type', () => {
    const result = detail(dairy, 404, '2026-10-02');

    expect(result).toMatchObject({ ok: false, err: { code: 'FOOD_TYPE_NOT_FOUND' } });
    expect(result.ok ? '' : result.err.detail).toContain('404');
    // a batch id is not a Food Type id
    expect(detail(dairy, 20, '2026-10-02')).toMatchObject({ ok: false, err: { code: 'FOOD_TYPE_NOT_FOUND' } });
  });
});
