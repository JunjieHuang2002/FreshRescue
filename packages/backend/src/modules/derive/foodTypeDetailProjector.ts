import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Id, Result } from '@freshrescue/contract-primitives';
import { LIMITS } from '@freshrescue/contract-rules';
import type { BatchView, FoodTypeDetailDto, PathMap, StockEntry, StockMap, ThresholdEntry, ThresholdMap } from '@freshrescue/contract-views';

/** The stock of a Food Type that has no batch. */
const NO_STOCK: StockEntry = { total: 0, avail: 0, near: 0, byStatus: { fresh: 0, nearExpiry: 0, expired: 0 }, overall: null };
const GLOBAL: ThresholdEntry = { days: LIMITS.GLOBAL_THRESHOLD_DAYS, source: 'global' };

/** By `D_exp`, earliest first, then by `createdSeq`. `YYYY-MM-DD` text sorts as the calendar does. */
const byExpiry = (a: BatchView, b: BatchView): number => {
  if (a.expirationDate !== b.expirationDate) return a.expirationDate < b.expirationDate ? -1 : 1;
  return a.createdSeq - b.createdSeq;
};

/**
 * BC-17 FoodTypeDetailProjector. Projects one Food Type into its Feature 5 detail read model (spec
 * 4.7.2):
 *
 * - the header: its name, category path, unit and total quantity, the status breakdown of the
 *   inventory list, its own threshold, and its effective threshold `T_eff` with the level that decided
 *   it (Food Type, Child category, Parent category or the global default)
 * - every batch, Fresh, Near-Expiry and Expired alike, with its dates, days left and status, sorted
 *   by `D_exp` ascending and then by `createdSeq`. A Food Type without a batch has none, which the screen
 *   draws as "No batches"
 * - the recipes that use it, in creation order: the delete confirmation lists them, because deleting
 *   the Food Type would make them blocked (spec 4.2.4)
 *
 * An id that names no Food Type is FOOD_TYPE_NOT_FOUND.
 */
export function foodTypeDetailProjector(
  foodTypeId: Id,
  snapshot: Snapshot,
  batches: readonly BatchView[],
  thresholds: ThresholdMap,
  stock: StockMap,
  paths: PathMap,
): Result<FoodTypeDetailDto, DomainError> {
  const foodType = snapshot.foodTypes.find((candidate) => candidate.id === foodTypeId);
  if (foodType === undefined) return { ok: false, err: { code: 'FOOD_TYPE_NOT_FOUND', detail: `there is no Food Type with id ${foodTypeId}` } };

  const { total, byStatus, overall } = stock[foodTypeId] ?? NO_STOCK;
  const users = new Set(snapshot.recipeIngredients.filter((row) => row.foodTypeId === foodTypeId).map((row) => row.recipeId));
  return {
    ok: true,
    value: {
      foodTypeId,
      name: foodType.name,
      categoryId: foodType.categoryId,
      categoryPath: paths[foodTypeId]?.names ?? [],
      unit: foodType.unit,
      customThresholdDays: foodType.customThresholdDays,
      threshold: thresholds[foodTypeId] ?? GLOBAL,
      total,
      byStatus,
      overall,
      batches: batches.filter((batch) => batch.foodTypeId === foodTypeId).sort(byExpiry),
      referencingRecipes: snapshot.recipes.filter((recipe) => users.has(recipe.id)).map((recipe) => ({ recipeId: recipe.id, name: recipe.name })),
    },
  };
}
