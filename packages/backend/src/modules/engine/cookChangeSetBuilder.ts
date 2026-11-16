import type { ChangeSet, EntityOp } from '@freshrescue/contract-changeset';
import type { Batch, Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Id, Result } from '@freshrescue/contract-primitives';
import type { Allocation } from '@freshrescue/contract-views';

/**
 * BC-37 CookChangeSetBuilder. Builds the ChangeSet that deducts one recipe's allocations from the
 * batches (spec 4.5). Each take becomes one operation on its batch:
 *
 * - a take that leaves some of the batch replaces the batch with the quantity that is left, and keeps
 *   every other field (the dates and `createdSeq` never change)
 * - a take that brings the batch to 0 deletes it, because a batch whose quantity reaches 0 is removed
 *   from the inventory (spec 4.5.5)
 *
 * What is left is worked out from the batch in the snapshot, which is the stored truth. The ChangeSet
 * holds that one recipe's deductions only, so it commits as one unit: all of them or none (spec 4.5,
 * "Atomic"). A take that names a batch which is not in the snapshot, or a batch of another Food Type
 * than its ingredient, means an inconsistent snapshot: BATCH_NOT_FOUND, and no ChangeSet. Two takes
 * of one batch give two operations on one record, which ChangeSetApplier refuses as CONFLICTING_OPS.
 */
export function cookChangeSetBuilder(recipeId: Id, allocations: readonly Allocation[], snapshot: Snapshot): Result<ChangeSet, DomainError> {
  const batches = new Map(snapshot.batches.map((batch): [Id, Batch] => [batch.id, batch]));
  const ops: EntityOp[] = [];
  for (const allocation of allocations) {
    for (const take of allocation.takes) {
      const batch = batches.get(take.batchId);
      if (batch === undefined || batch.foodTypeId !== allocation.foodTypeId) {
        const detail = `recipe ${recipeId} takes from batch ${take.batchId}, and Food Type ${allocation.foodTypeId} has no such batch`;
        return { ok: false, err: { code: 'BATCH_NOT_FOUND', detail } };
      }
      const left = batch.quantity - take.takeMilli;
      ops.push(left > 0 ? { kind: 'putBatch', row: { ...batch, quantity: left } } : { kind: 'deleteBatch', id: batch.id });
    }
  }
  return { ok: true, value: { ops } };
}
