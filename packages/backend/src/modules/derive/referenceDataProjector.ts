import type { FoodCategory, RecipeCategory, Snapshot } from '@freshrescue/contract-entities';
import type { DateISO } from '@freshrescue/contract-primitives';
import { LIMITS, UNIT_LIST } from '@freshrescue/contract-rules';
import type { CategoryNode, ReferenceDataDto } from '@freshrescue/contract-views';

const foodNode = (category: FoodCategory, children: readonly CategoryNode[]): CategoryNode => ({
  id: category.id,
  name: category.name,
  isSystem: category.isSystem,
  customThresholdDays: category.customThresholdDays,
  children,
});

/** A cuisine is a single-level tag with no threshold. */
const cuisineNode = (cuisine: RecipeCategory): CategoryNode => ({
  id: cuisine.id,
  name: cuisine.name,
  isSystem: cuisine.isSystem,
  customThresholdDays: null,
  children: [],
});

/** The user's categories first and the system `Other` last, each group in creation order. */
const otherLast = <T extends { readonly isSystem: boolean }>(categories: readonly T[]): T[] => [
  ...categories.filter((category) => !category.isSystem),
  ...categories.filter((category) => category.isSystem),
];

/**
 * BC-19 ReferenceDataProjector. Projects a snapshot into what the forms, the filters and the demo
 * control are built from:
 *
 * - `today`, the date every other figure of the request was derived for, and the stored Simulated
 *   Today, which is null when the device date is used (spec 4.3.4)
 * - the global default threshold of 3 days, which cannot be edited, and the fixed list of six units
 * - the food category tree: each Parent with its Children, then `Other`, with each category's own
 *   threshold (spec 4.1). A food category has two levels at most, so a Child has no children here
 * - the cuisines in the same shape, with no children and no threshold, `Other` last
 * - every Food Type as a picker offers it: its name, its unit and its category
 *
 * Lists keep creation order. The A to Z order of spec 4.4.D is for the recipe and inventory lists,
 * not for pickers, and the frontend never sorts or computes anything itself.
 */
export function referenceDataProjector(snapshot: Snapshot, today: DateISO): ReferenceDataDto {
  const childrenOf = (parent: FoodCategory): CategoryNode[] =>
    snapshot.foodCategories.filter((category) => category.parentId === parent.id).map((child) => foodNode(child, []));
  const topLevel = snapshot.foodCategories.filter((category) => category.parentId === null);

  return {
    today,
    simulatedToday: snapshot.settings.simulatedToday,
    globalThresholdDays: LIMITS.GLOBAL_THRESHOLD_DAYS,
    units: [...UNIT_LIST],
    foodCategories: otherLast(topLevel).map((parent) => foodNode(parent, childrenOf(parent))),
    cuisines: otherLast(snapshot.recipeCategories).map(cuisineNode),
    foodTypes: snapshot.foodTypes.map((foodType) => ({ id: foodType.id, name: foodType.name, unit: foodType.unit, categoryId: foodType.categoryId })),
  };
}
