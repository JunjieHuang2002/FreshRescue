import type { ChangeSet, EntityOp, WriteOp, WriteOps } from '@freshrescue/contract-changeset';

/** The storage-level operation of one record-level operation. */
function encode(op: EntityOp): WriteOp | undefined {
  switch (op.kind) {
    case 'putFoodCategory':
      return { op: 'put', table: 'foodCategories', row: op.row };
    case 'deleteFoodCategory':
      return { op: 'delete', table: 'foodCategories', key: { id: op.id } };
    case 'putFoodType':
      return { op: 'put', table: 'foodTypes', row: op.row };
    case 'deleteFoodType':
      return { op: 'delete', table: 'foodTypes', key: { id: op.id } };
    case 'putBatch':
      return { op: 'put', table: 'batches', row: op.row };
    case 'deleteBatch':
      return { op: 'delete', table: 'batches', key: { id: op.id } };
    case 'putRecipeCategory':
      return { op: 'put', table: 'recipeCategories', row: op.row };
    case 'deleteRecipeCategory':
      return { op: 'delete', table: 'recipeCategories', key: { id: op.id } };
    case 'putRecipe':
      return { op: 'put', table: 'recipes', row: op.row };
    case 'deleteRecipe':
      return { op: 'delete', table: 'recipes', key: { id: op.id } };
    case 'putIngredient':
      return { op: 'put', table: 'recipeIngredients', row: op.row };
    case 'deleteIngredientsOfRecipe':
      // a partial key: every row of the recipe, and none of another
      return { op: 'delete', table: 'recipeIngredients', key: { recipeId: op.recipeId } };
    case 'putSettings':
      return { op: 'put', table: 'settings', row: op.row };
    case 'putCounters':
      return { op: 'put', table: 'counters', row: op.row };
    default:
      return undefined;
  }
}

/**
 * BC-43 ChangeSetEncoder. Translates a ChangeSet into the storage-level `WriteOps` that
 * StoreWriteGateway applies all or nothing. Storage speaks in logical tables and the field names of
 * the entities, so only the MySQL gateway knows real table and column names (blueprint 1.9).
 *
 * Each operation becomes one write, in the same order: a put becomes a put of the same row into its
 * table, which inserts it or replaces the row with the same key (an ingredient row's key is its recipe
 * and its Food Type; the settings and the counters are one row each), and a delete becomes a delete by
 * the record's key. `deleteIngredientsOfRecipe` becomes a delete by the recipe alone, which removes
 * every row of that recipe. Replayed on plain rows, the writes give the same snapshot as
 * ChangeSetApplier gives, which is what lets the store be trusted to match the in-memory result.
 *
 * It decides nothing and checks nothing: ChangeSetApplier and SnapshotInvariantChecker have already
 * accepted the ChangeSet before it is encoded. An operation of a kind the store does not have, which
 * the applier refuses as UNKNOWN_TARGET, is not encoded.
 */
export function changeSetEncoder(changeSet: ChangeSet): WriteOps {
  return changeSet.ops.flatMap((op) => {
    const write = encode(op);
    return write === undefined ? [] : [write];
  });
}
