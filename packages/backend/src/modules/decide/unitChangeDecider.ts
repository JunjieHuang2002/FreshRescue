import type { ChangeSet, EntityOp } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Id, Result, ValidQty, ValidUnit } from '@freshrescue/contract-primitives';

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

const listed = (ids: readonly Id[]): string => (ids.length === 0 ? 'none' : ids.join(', '));

/**
 * BC-27 UnitChangeDecider. Builds the ChangeSet that switches a Food Type's unit together with the
 * quantity of every one of its batches (spec 4.2.2). The unit and the quantities have been through
 * ScalarValidator, and CapChecker has judged their sum, so this module decides the change as a whole:
 * all batches convert or none do.
 *
 * - FOOD_TYPE_NOT_FOUND when the Food Type is not there
 * - UNIT_UNCHANGED when the new unit is the one it has, which is judged before the quantities
 * - BATCH_SET_MISMATCH when the quantities do not name exactly the Food Type's current batches:
 *   one is left out, one belongs to another Food Type or to none, or one is named twice. Expired
 *   batches count like any other, and a Food Type with no batch takes an empty list
 *
 * The result puts the Food Type with its new unit and then each of its batches, in the order of the
 * snapshot, whatever the order of the request, with the new quantity and nothing else changed: the
 * expiration dates and `createdSeq` stay (spec 4.2.2.3). No recipe is touched. A recipe whose Required
 * Unit now differs becomes a Unit Conflict by derivation, and recipes are never rewritten (spec 4.2.2.4).
 */
export function unitChangeDecider(
  foodTypeId: Id,
  unit: ValidUnit,
  rows: readonly { readonly batchId: Id; readonly qty: ValidQty }[],
  snapshot: Snapshot,
): Result<ChangeSet, DomainError> {
  const foodType = snapshot.foodTypes.find((candidate) => candidate.id === foodTypeId);
  if (foodType === undefined) return fail('FOOD_TYPE_NOT_FOUND', `there is no Food Type with id ${foodTypeId}`);
  if (foodType.unit === unit) return fail('UNIT_UNCHANGED', `the Food Type is already in ${unit}`);

  const batches = snapshot.batches.filter((batch) => batch.foodTypeId === foodTypeId);
  const newQuantity = new Map(rows.map((row): [Id, ValidQty] => [row.batchId, row.qty]));
  // a batch the request leaves out gives no operation, and a batch it names twice or that is not one
  // of these makes the request longer than the list of batches: either way the sets differ
  const converted = batches.flatMap((batch): EntityOp[] => {
    const quantity = newQuantity.get(batch.id);
    return quantity === undefined ? [] : [{ kind: 'putBatch', row: { ...batch, quantity } }];
  });
  if (converted.length !== batches.length || rows.length !== batches.length) {
    const expected = listed(batches.map((batch) => batch.id));
    const named = listed(rows.map((row) => row.batchId));
    return fail('BATCH_SET_MISMATCH', `the quantities must name exactly the batches of this Food Type (${expected}), and these name (${named})`);
  }
  return { ok: true, value: { ops: [{ kind: 'putFoodType', row: { ...foodType, unit } }, ...converted] } };
}
