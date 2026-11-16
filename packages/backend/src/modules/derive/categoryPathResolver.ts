import type { FoodCategory, Snapshot } from '@freshrescue/contract-entities';
import type { Id } from '@freshrescue/contract-primitives';
import type { PathEntry, PathMap } from '@freshrescue/contract-views';

/**
 * BC-10 CategoryPathResolver. Resolves the category of every Food Type into its name path (spec
 * 4.7.1). A Food Type in a Child reads as the Parent and then the Child, such as `Meat`, `Poultry`;
 * one assigned to a Parent directly, or to `Other`, reads as that one name, such as `Vegetables` or
 * `Other`. The arrow between the names is the screen's to draw.
 *
 * The names are looked up on every request, so a rename shows at once and changes no binding (spec
 * 4.1). A category that is not in the snapshot has no name to give and adds none: the path holds only
 * the names that exist, and no name is made up. SnapshotInvariantChecker never lets a Food Type point
 * at a missing category, or a Child at a missing Parent.
 */
export function categoryPathResolver(snapshot: Snapshot): PathMap {
  const categories = new Map(snapshot.foodCategories.map((category): [Id, FoodCategory] => [category.id, category]));
  const paths: Record<Id, PathEntry> = {};
  for (const foodType of snapshot.foodTypes) {
    const category = categories.get(foodType.categoryId);
    const parentId = category?.parentId ?? null;
    const parent = parentId === null ? undefined : categories.get(parentId);
    const names = [parent?.name, category?.name].filter((name): name is string => name !== undefined);
    paths[foodType.id] = { categoryId: foodType.categoryId, names };
  }
  return paths;
}
