import type { ChangeSet } from '@freshrescue/contract-changeset';

/**
 * BC-42 ChangeSetMerger. Joins several ChangeSets into one ordered ChangeSet: the operations of the
 * first, then those of the second, and so on, each in its own order. That is how a workflow writes a
 * counter bump, a new Food Type and its first batch together or not at all (blueprint 2.4).
 *
 * It only joins. Two operations on one record stay two operations, so ChangeSetApplier still refuses
 * them as CONFLICTING_OPS: merging never hides a conflict and never drops or reorders an operation.
 */
export function changeSetMerger(changeSets: readonly ChangeSet[]): ChangeSet {
  return { ops: changeSets.flatMap((changeSet) => changeSet.ops) };
}
