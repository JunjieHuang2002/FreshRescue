import type { ChangeSet } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Id, Result } from '@freshrescue/contract-primitives';

/**
 * BC-31 BatchRemoveDecider. Builds the ChangeSet that deletes one whole batch, which is the manual
 * outbound of spec 4.2.4. Nothing else changes: removing the last batch of a Food Type leaves the Food
 * Type registered, with its unit, its category and its threshold, and a quantity of 0. A batch that is
 * not there is BATCH_NOT_FOUND.
 */
export function batchRemoveDecider(batchId: Id, snapshot: Snapshot): Result<ChangeSet, DomainError> {
  if (!snapshot.batches.some((batch) => batch.id === batchId)) {
    return { ok: false, err: { code: 'BATCH_NOT_FOUND', detail: `there is no batch with id ${batchId}` } };
  }
  return { ok: true, value: { ops: [{ kind: 'deleteBatch', id: batchId }] } };
}
