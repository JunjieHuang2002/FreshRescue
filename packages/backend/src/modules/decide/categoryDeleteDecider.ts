import type { ChangeSet, EntityOp } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Id, Result } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import type { CategoryScope } from '@freshrescue/contract-rules';

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

/**
 * BC-22 CategoryDeleteDecider. Builds the ChangeSet that removes a category and re-homes what was in
 * it to the system `Other` of the same tree (spec 4.1.3 and exception row 9). `scope` says which tree.
 *
 * - Child food category: its Food Types move to the food `Other`.
 * - Parent food category: its Children are deleted with it, and the Food Types assigned to the Parent
 *   or to any of its Children move to the food `Other`.
 * - Cuisine: its recipes move to the cuisine `Other`.
 *
 * The moved records keep everything but their category, and their batches follow without an operation,
 * because a batch takes its category from its Food Type. A category's custom threshold is a field of
 * its record, so deleting the record deletes the threshold (spec 4.1.4), and the Food Types that moved
 * derive their `T_eff` again from the levels that are left. The moves come first and the deletes last,
 * so that no record is ever left pointing at a category that is gone.
 *
 * The system `Other` of either tree cannot be deleted (SYSTEM_PROTECTED), and an id that is not in
 * the tree is CATEGORY_NOT_FOUND.
 */
export function categoryDeleteDecider(scope: CategoryScope, categoryId: Id, snapshot: Snapshot): Result<ChangeSet, DomainError> {
  if (scope === 'cuisine') {
    const cuisine = snapshot.recipeCategories.find((candidate) => candidate.id === categoryId);
    if (cuisine === undefined) return fail('CATEGORY_NOT_FOUND', `there is no cuisine with id ${categoryId}`);
    if (cuisine.isSystem) return fail('SYSTEM_PROTECTED', `the system cuisine ${cuisine.name} cannot be deleted`);

    const moved = snapshot.recipes
      .filter((recipe) => recipe.recipeCategoryId === categoryId)
      .map((recipe): EntityOp => ({ kind: 'putRecipe', row: { ...recipe, recipeCategoryId: SYSTEM_IDS.CUISINE_OTHER } }));
    return { ok: true, value: { ops: [...moved, { kind: 'deleteRecipeCategory', id: categoryId }] } };
  }

  const category = snapshot.foodCategories.find((candidate) => candidate.id === categoryId);
  if (category === undefined) return fail('CATEGORY_NOT_FOUND', `there is no food category with id ${categoryId}`);
  if (category.isSystem) return fail('SYSTEM_PROTECTED', `the system category ${category.name} cannot be deleted`);

  const children = snapshot.foodCategories.filter((candidate) => candidate.parentId === category.id);
  const removed = new Set<Id>([category.id, ...children.map((child) => child.id)]);
  const moved = snapshot.foodTypes
    .filter((foodType) => removed.has(foodType.categoryId))
    .map((foodType): EntityOp => ({ kind: 'putFoodType', row: { ...foodType, categoryId: SYSTEM_IDS.FOOD_OTHER } }));
  const deletes = [...children, category].map((doomed): EntityOp => ({ kind: 'deleteFoodCategory', id: doomed.id }));
  return { ok: true, value: { ops: [...moved, ...deletes] } };
}
