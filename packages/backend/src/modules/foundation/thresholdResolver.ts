import type { FoodCategory, FoodType, Snapshot } from '@freshrescue/contract-entities';
import type { Id } from '@freshrescue/contract-primitives';
import { LIMITS } from '@freshrescue/contract-rules';
import type { ThresholdEntry, ThresholdMap } from '@freshrescue/contract-views';

const GLOBAL: ThresholdEntry = { days: LIMITS.GLOBAL_THRESHOLD_DAYS, source: 'global' };

/** The first threshold that is set wins (spec 4.3.1): the Food Type, then its Child category, then its Parent, then the global 3 days. */
function entryOf(foodType: FoodType, categories: ReadonlyMap<Id, FoodCategory>): ThresholdEntry {
  if (foodType.customThresholdDays !== null) return { days: foodType.customThresholdDays, source: 'foodType' };

  const category = categories.get(foodType.categoryId);
  // `Other` has no custom threshold (spec 1.2), so a Food Type in it has Priority 1 or 4 only
  if (category === undefined || category.isSystem) return GLOBAL;

  if (category.parentId === null) {
    // the Food Type is assigned directly to a Parent
    return category.customThresholdDays === null ? GLOBAL : { days: category.customThresholdDays, source: 'parent' };
  }
  if (category.customThresholdDays !== null) return { days: category.customThresholdDays, source: 'child' };
  const parent = categories.get(category.parentId);
  return parent === undefined || parent.customThresholdDays === null
    ? GLOBAL
    : { days: parent.customThresholdDays, source: 'parent' };
}

/**
 * BC-07 ThresholdResolver. Derives the effective near-expiry threshold `T_eff` of every Food Type,
 * together with the level that decided it, by the four-level precedence of spec 4.3.1:
 *
 * 1. the Food Type's own threshold
 * 2. its Child category's threshold, when it is assigned to a Child
 * 3. its Parent's threshold: the Parent it is assigned to, or the Parent of the Child it is assigned to
 * 4. the global default of 3 days
 *
 * All batches of a Food Type share its `T_eff`, so the map is keyed by Food Type. Nothing here is
 * stored: it is recomputed from the snapshot on every request (spec 4.6), which is how a category
 * rename, a threshold change or a category deletion takes effect at once.
 */
export function thresholdResolver(snapshot: Snapshot): ThresholdMap {
  const categories = new Map(snapshot.foodCategories.map((category): [Id, FoodCategory] => [category.id, category]));
  const thresholds: Record<Id, ThresholdEntry> = {};
  for (const foodType of snapshot.foodTypes) thresholds[foodType.id] = entryOf(foodType, categories);
  return thresholds;
}
