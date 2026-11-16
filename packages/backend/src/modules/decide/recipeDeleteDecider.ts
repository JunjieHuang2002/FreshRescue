import type { ChangeSet } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Id, Result } from '@freshrescue/contract-primitives';

/**
 * BC-34 RecipeDeleteDecider. Builds the ChangeSet that removes one recipe together with its ingredient
 * rows, because a row belongs to a recipe and cannot outlive it (spec 4.4.E: a built-in recipe has the
 * same delete right as any other). The rows go first and the recipe last. Food Types, batches and
 * cuisines are not touched. A recipe that is not there is RECIPE_NOT_FOUND: the cook loop reports a
 * queued recipe that was deleted as skipped, but a delete request for it is an error.
 */
export function recipeDeleteDecider(recipeId: Id, snapshot: Snapshot): Result<ChangeSet, DomainError> {
  if (!snapshot.recipes.some((recipe) => recipe.id === recipeId)) {
    return { ok: false, err: { code: 'RECIPE_NOT_FOUND', detail: `there is no recipe with id ${recipeId}` } };
  }
  return { ok: true, value: { ops: [{ kind: 'deleteIngredientsOfRecipe', recipeId }, { kind: 'deleteRecipe', id: recipeId }] } };
}
