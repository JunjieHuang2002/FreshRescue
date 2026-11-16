import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Id, QtyMilli, Result, ValidQty } from '@freshrescue/contract-primitives';
import { LIMITS } from '@freshrescue/contract-rules';

/**
 * A proposed change to the stock of one Food Type (spec section 3, "Cumulative Ingredient Quantity
 * Cap"). Each kind names its Food Type or its batch. The type lives here and not in a contract,
 * because only this module reads it and only its calling coordinator makes it (plan, phase 2).
 *
 * - `add`: an inbound. The Food Type may not exist yet, which is the inbound of a new Food Type.
 * - `edit`: a new quantity for one existing batch.
 * - `convert`: a unit change, with the new quantity of each batch.
 */
export type CapChange =
  | { readonly kind: 'add'; readonly foodTypeId: Id; readonly qty: ValidQty }
  | { readonly kind: 'edit'; readonly batchId: Id; readonly qty: ValidQty }
  | {
      readonly kind: 'convert';
      readonly foodTypeId: Id;
      readonly rows: readonly { readonly batchId: Id; readonly qty: ValidQty }[];
    };

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

const sum = (quantities: Iterable<QtyMilli>): QtyMilli => {
  let total = 0;
  for (const quantity of quantities) total += quantity;
  return total;
};

/**
 * BC-06 CapChecker. Tests whether a change keeps a Food Type's total within the cap of 500,000
 * (500,000,000 thousandths), and returns the post-change total when it does. The cap is judged on
 * the total after the change (spec section 3), and it counts every batch, Expired ones included:
 *
 * - add: the existing sum plus the new quantity
 * - edit: the existing sum, minus the edited batch's old quantity, plus its new quantity
 * - convert: the sum of the new quantities that the conversion modal asked for
 *
 * A total of exactly 500,000 is allowed. Above it the change is refused (CAP_EXCEEDED) and nothing
 * is stored. An edit that names a batch that does not exist is BATCH_NOT_FOUND. A convert names
 * its batches only to take their quantities: whether they are all of the Food Type's batches is
 * the decision of UnitChangeDecider (BATCH_SET_MISMATCH).
 */
export function capChecker(snapshot: Snapshot, change: CapChange): Result<QtyMilli, DomainError> {
  let total: QtyMilli;
  if (change.kind === 'add') {
    const existing = snapshot.batches.filter((batch) => batch.foodTypeId === change.foodTypeId);
    total = sum(existing.map((batch) => batch.quantity)) + change.qty;
  } else if (change.kind === 'edit') {
    const edited = snapshot.batches.find((batch) => batch.id === change.batchId);
    if (edited === undefined) return fail('BATCH_NOT_FOUND', `there is no batch with id ${change.batchId}`);
    const siblings = snapshot.batches.filter((batch) => batch.foodTypeId === edited.foodTypeId);
    total = sum(siblings.map((batch) => batch.quantity)) - edited.quantity + change.qty;
  } else {
    total = sum(change.rows.map((row) => row.qty));
  }

  if (total > LIMITS.CAP_MILLI) {
    return fail('CAP_EXCEEDED', `the total would be ${total / 1000}, and the cap is ${LIMITS.CAP_MILLI / 1000} for each Food Type`);
  }
  return { ok: true, value: total };
}
