import { ENTITY_OP_KINDS } from '@freshrescue/contract-changeset';
import type { ChangeSet, EntityOp } from '@freshrescue/contract-changeset';
import type {
  Batch,
  Counters,
  FoodCategory,
  FoodType,
  Recipe,
  RecipeCategory,
  RecipeIngredient,
  Settings,
  Snapshot,
} from '@freshrescue/contract-entities';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Id, Result } from '@freshrescue/contract-primitives';

/** The snapshot while it is being built. Its lists are copies, so the snapshot that came in is never touched. */
type Working = {
  foodCategories: FoodCategory[];
  foodTypes: FoodType[];
  batches: Batch[];
  recipeCategories: RecipeCategory[];
  recipes: Recipe[];
  recipeIngredients: RecipeIngredient[];
  settings: Settings;
  counters: Counters;
};

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

/** The record that an operation changes, in words. Two operations with the same text change the same record. */
function recordOf(op: EntityOp): string {
  switch (op.kind) {
    case 'putFoodCategory':
      return `food category ${op.row.id}`;
    case 'deleteFoodCategory':
      return `food category ${op.id}`;
    case 'putFoodType':
      return `Food Type ${op.row.id}`;
    case 'deleteFoodType':
      return `Food Type ${op.id}`;
    case 'putBatch':
      return `batch ${op.row.id}`;
    case 'deleteBatch':
      return `batch ${op.id}`;
    case 'putRecipeCategory':
      return `cuisine ${op.row.id}`;
    case 'deleteRecipeCategory':
      return `cuisine ${op.id}`;
    case 'putRecipe':
      return `recipe ${op.row.id}`;
    case 'deleteRecipe':
      return `recipe ${op.id}`;
    case 'putIngredient':
      return `the row of recipe ${op.row.recipeId} for Food Type ${op.row.foodTypeId}`;
    case 'deleteIngredientsOfRecipe':
      return `the rows of recipe ${op.recipeId}`;
    case 'putSettings':
      return 'the settings';
    case 'putCounters':
      return 'the counters';
  }
}

/** Inserts the row at the end of the list, or replaces the row with the same id where it stands. */
function put<T extends { readonly id: Id }>(list: T[], row: T): true {
  const at = list.findIndex((existing) => existing.id === row.id);
  if (at < 0) list.push(row);
  else list[at] = row;
  return true;
}

/** Removes the row with the id. It returns false when there is none. */
function remove<T extends { readonly id: Id }>(list: T[], id: Id): boolean {
  const at = list.findIndex((existing) => existing.id === id);
  if (at >= 0) list.splice(at, 1);
  return at >= 0;
}

/** Applies one operation to the working copy. It returns false when a delete found nothing to delete. */
function apply(work: Working, op: EntityOp): boolean {
  switch (op.kind) {
    case 'putFoodCategory':
      return put(work.foodCategories, op.row);
    case 'deleteFoodCategory':
      return remove(work.foodCategories, op.id);
    case 'putFoodType':
      return put(work.foodTypes, op.row);
    case 'deleteFoodType':
      return remove(work.foodTypes, op.id);
    case 'putBatch':
      return put(work.batches, op.row);
    case 'deleteBatch':
      return remove(work.batches, op.id);
    case 'putRecipeCategory':
      return put(work.recipeCategories, op.row);
    case 'deleteRecipeCategory':
      return remove(work.recipeCategories, op.id);
    case 'putRecipe':
      return put(work.recipes, op.row);
    case 'deleteRecipe':
      return remove(work.recipes, op.id);
    case 'putIngredient': {
      // a row is named by its recipe and its Food Type, and a replaced row keeps its place
      const at = work.recipeIngredients.findIndex((row) => row.recipeId === op.row.recipeId && row.foodTypeId === op.row.foodTypeId);
      if (at < 0) work.recipeIngredients.push(op.row);
      else work.recipeIngredients[at] = op.row;
      return true;
    }
    case 'deleteIngredientsOfRecipe':
      // the rows of a recipe are a set and not a record, so a recipe with no row, which a new recipe is,
      // has nothing to delete, and that is not an error: the same as a partial-key delete of WriteOps
      work.recipeIngredients = work.recipeIngredients.filter((row) => row.recipeId !== op.recipeId);
      return true;
    case 'putSettings':
      work.settings = op.row;
      return true;
    case 'putCounters':
      work.counters = op.row;
      return true;
  }
}

/**
 * BS-01 ChangeSetApplier. Computes the next `Snapshot` from the current one plus one `ChangeSet`.
 * It decides nothing: it carries out the record-level operations that a decider chose, in order.
 * The snapshot that came in is not touched, and no half-applied result is ever returned: the
 * answer is the whole next snapshot or an error.
 *
 * - A put inserts a record at the end of its list, or replaces the record with the same id where it
 *   stands, so each list stays in creation order. An ingredient row is named by its recipe and its
 *   Food Type.
 * - A record may appear in a ChangeSet once. A second operation on a record is CONFLICTING_OPS,
 *   whatever the two operations are. The ingredient rows of a recipe are the one exception: they
 *   are replaced by one `deleteIngredientsOfRecipe` followed by the new `putIngredient`s. A
 *   `deleteIngredientsOfRecipe` after a `putIngredient` of the same recipe is CONFLICTING_OPS too,
 *   because it would delete the rows that were just put.
 * - A delete of a record that is not there is UNKNOWN_TARGET, and so is an operation of a kind that the
 *   store does not have. The rows of a recipe are the exception again: they are a set and not a
 *   record, so `deleteIngredientsOfRecipe` for a recipe that has no row changes nothing and is not an
 *   error. A new recipe has no row to replace, and the sequence "delete the rows, then put the new
 *   ones" must work for it as it does for an edit, whichever way a decider chooses to write it.
 *
 * It does not check what a change means. A deleted Food Type leaves the rows that name it where they
 * are, and the cascades are the deciders' work. SnapshotInvariantChecker looks at the result.
 */
export function changeSetApplier(snapshot: Snapshot, changeSet: ChangeSet): Result<Snapshot, DomainError> {
  const work: Working = {
    ...snapshot,
    foodCategories: [...snapshot.foodCategories],
    foodTypes: [...snapshot.foodTypes],
    batches: [...snapshot.batches],
    recipeCategories: [...snapshot.recipeCategories],
    recipes: [...snapshot.recipes],
    recipeIngredients: [...snapshot.recipeIngredients],
  };
  const changed = new Map<string, number>();
  const recipesWithPutRows = new Set<Id>();

  for (const [index, op] of changeSet.ops.entries()) {
    const label = `operation ${index + 1} (${op.kind})`;
    if (!(ENTITY_OP_KINDS as readonly string[]).includes(op.kind)) {
      return fail('UNKNOWN_TARGET', `${label} is not an operation that the store has`);
    }

    const record = recordOf(op);
    const earlier = changed.get(record);
    if (earlier !== undefined) {
      return fail('CONFLICTING_OPS', `${label} changes ${record}, which operation ${earlier + 1} already changed`);
    }
    if (op.kind === 'deleteIngredientsOfRecipe' && recipesWithPutRows.has(op.recipeId)) {
      return fail('CONFLICTING_OPS', `${label} deletes rows that an earlier operation put: delete the rows first, then put the new ones`);
    }
    changed.set(record, index);
    if (op.kind === 'putIngredient') recipesWithPutRows.add(op.row.recipeId);

    if (!apply(work, op)) return fail('UNKNOWN_TARGET', `${label} deletes ${record}, and there is none`);
  }
  return { ok: true, value: work };
}
