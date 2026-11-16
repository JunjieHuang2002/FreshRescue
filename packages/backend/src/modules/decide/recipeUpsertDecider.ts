import type { ChangeSet, EntityOp } from '@freshrescue/contract-changeset';
import type { Snapshot, ValidRecipeDraft } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Id, Result, ValidName } from '@freshrescue/contract-primitives';

/**
 * BC-33 RecipeUpsertDecider. Builds the ChangeSet that creates a recipe, or replaces one together with
 * its ingredient rows (spec 4.4). The name has been through NameValidator, the draft through
 * RecipeDraftValidator, and the coordinator reserved `newId`, which is the id of a new recipe and is
 * not used when a recipe is edited.
 *
 * - `recipeId` is `null`: a new recipe with the id it was given
 * - `recipeId` names a recipe: that recipe is replaced where it stands. One that is not there is
 *   RECIPE_NOT_FOUND
 *
 * The ChangeSet has the same three parts for both: put the recipe, delete the rows it has, then put
 * the rows of the draft, in the order of the draft. That is the replacement the ChangeSet contract
 * describes. A new recipe has no rows to delete, and deleting none is not an error. An edit drops
 * every old row, a row that names a deleted Food Type included, which is how a blocked recipe is
 * repaired by picking another Food Type (spec 4.2.4.4). Every new row is a live one, so
 * `deletedFoodTypeName` is `null`. A Required Unit that differs from its Food Type's unit is kept as
 * it was entered: that is a Unit Conflict, derived later.
 */
export function recipeUpsertDecider(
  recipeId: Id | null,
  name: ValidName,
  draft: ValidRecipeDraft,
  snapshot: Snapshot,
  newId: Id,
): Result<ChangeSet, DomainError> {
  if (recipeId !== null && !snapshot.recipes.some((recipe) => recipe.id === recipeId)) {
    return { ok: false, err: { code: 'RECIPE_NOT_FOUND', detail: `there is no recipe with id ${recipeId}` } };
  }

  const id = recipeId ?? newId;
  const rows = draft.rows.map(
    (row): EntityOp => ({
      kind: 'putIngredient',
      row: {
        recipeId: id,
        foodTypeId: row.foodTypeId,
        requiredQuantity: row.requiredQuantity,
        requiredUnit: row.requiredUnit,
        deletedFoodTypeName: null,
      },
    }),
  );
  return {
    ok: true,
    value: {
      ops: [
        { kind: 'putRecipe', row: { id, name, recipeCategoryId: draft.recipeCategoryId } },
        { kind: 'deleteIngredientsOfRecipe', recipeId: id },
        ...rows,
      ],
    },
  };
}
