import type { ChangeSet } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Id, Result, ValidQty } from '@freshrescue/contract-primitives';

/**
 * BC-30 BatchQuantityEditDecider. Builds the ChangeSet that replaces one batch's quantity (spec
 * 4.2.4): this is how a partial outbound is recorded. The quantity is the only field that can change,
 * so the batch keeps its Food Type, both dates and its `createdSeq`, which is how a wrong expiration
 * date is corrected by removing the batch and adding a new one (spec 4.2.1). The quantity has been
 * through ScalarValidator, so it is above zero, and CapChecker has judged the post-change total. A
 * batch that is not there is BATCH_NOT_FOUND.
 */
export function batchQuantityEditDecider(batchId: Id, qty: ValidQty, snapshot: Snapshot): Result<ChangeSet, DomainError> {
  const batch = snapshot.batches.find((candidate) => candidate.id === batchId);
  if (batch === undefined) return { ok: false, err: { code: 'BATCH_NOT_FOUND', detail: `there is no batch with id ${batchId}` } };
  return { ok: true, value: { ops: [{ kind: 'putBatch', row: { ...batch, quantity: qty } }] } };
}
