import type { ChangeSet, EntityOp } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Id, Result } from '@freshrescue/contract-primitives';

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

/**
 * BC-26 FoodTypeDeleteDecider. Builds the ChangeSet that deletes a Food Type that has no batch (spec
 * 4.2.4). A Food Type with a batch of any status, Expired included, is refused with HAS_BATCHES: "Remove
 * all N batches first." (spec exception row 15). A Food Type that is not there is FOOD_TYPE_NOT_FOUND.
 *
 * Every recipe row that names the Food Type is kept, and stamped with the name the Food Type had
 * (`deletedFoodTypeName`): the recipe stays visible and is blocked as Missing food type: {name}
 * (spec exception row 7). References are by id, so a Food Type that is created later with the same
 * name does not repair those rows. The Food Type's custom threshold is a field of its record, so it
 * goes with it (spec 4.2.4). The stamps come first and the delete last, so that no row is ever left
 * naming a Food Type that is gone without its name.
 */
export function foodTypeDeleteDecider(foodTypeId: Id, snapshot: Snapshot): Result<ChangeSet, DomainError> {
  const foodType = snapshot.foodTypes.find((candidate) => candidate.id === foodTypeId);
  if (foodType === undefined) return fail('FOOD_TYPE_NOT_FOUND', `there is no Food Type with id ${foodTypeId}`);

  const batchCount = snapshot.batches.filter((batch) => batch.foodTypeId === foodTypeId).length;
  if (batchCount > 0) {
    return fail('HAS_BATCHES', batchCount === 1 ? 'Remove the 1 batch first' : `Remove all ${batchCount} batches first`);
  }

  const stamps = snapshot.recipeIngredients
    .filter((row) => row.foodTypeId === foodTypeId)
    .map((row): EntityOp => ({ kind: 'putIngredient', row: { ...row, deletedFoodTypeName: foodType.name } }));
  return { ok: true, value: { ops: [...stamps, { kind: 'deleteFoodType', id: foodTypeId }] } };
}
