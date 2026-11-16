import type { ChangeSet } from '@freshrescue/contract-changeset';
import type { DateISO, Id, ValidQty } from '@freshrescue/contract-primitives';

/**
 * BC-29 BatchCreateDecider. Builds the ChangeSet that adds one batch (spec 4.2.1). Every inbound
 * makes a new batch: batches are never merged, even when the Food Type, the dates and the quantity are
 * all the same, so two calls give two records with two ids and two `createdSeq` values.
 *
 * It judges nothing, so it has no error, and it takes no snapshot. The quantity has been through
 * ScalarValidator, the dates come from ExpiryResolver, the cap has been checked by CapChecker, and the
 * id and the sequence number were reserved by IdAllocator. It must not look for the Food Type either:
 * an inbound of a new name creates the Food Type in the same ChangeSet, so the Food Type may not be in
 * the snapshot yet, and the invariant checker (`batchFoodType`) judges the whole result. The counters
 * are bumped by the ChangeSet of IdAllocator.
 */
export function batchCreateDecider(
  foodTypeId: Id,
  qty: ValidQty,
  dates: { readonly inboundDate: DateISO; readonly expirationDate: DateISO },
  id: Id,
  seq: number,
): ChangeSet {
  return {
    ops: [
      {
        kind: 'putBatch',
        row: {
          id,
          foodTypeId,
          quantity: qty,
          inboundDate: dates.inboundDate,
          expirationDate: dates.expirationDate,
          createdSeq: seq,
        },
      },
    ],
  };
}
