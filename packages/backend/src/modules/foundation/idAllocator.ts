import type { ChangeSet, EntityOp } from '@freshrescue/contract-changeset';
import type { Counters } from '@freshrescue/contract-entities';
import type { Id } from '@freshrescue/contract-primitives';

/**
 * What IdAllocator hands back: the reserved ids, the reserved `createdSeq` values, and the
 * ChangeSet that moves the counters past them. The type lives here, and not in a contract, because
 * only this module makes it and only its calling coordinator reads it (plan, phase 2).
 */
export type IdAllocation = {
  readonly ids: readonly Id[];
  readonly seqs: readonly number[];
  /** Bumps `Counters`. It is empty when nothing was reserved, so a request that needs no id leaves the counters alone. */
  readonly counterCs: ChangeSet;
};

/** A count of ids is a whole number of at least 0: anything else reserves nothing. */
const wholeCount = (count: number): number => (Number.isSafeInteger(count) && count > 0 ? count : 0);

const run = (first: number, length: number): number[] => Array.from({ length }, (_, offset) => first + offset);

/**
 * BC-02 IdAllocator. Reserves the next ids and `createdSeq` values from `Counters`. One counter
 * serves every kind of record, so an id names one record in the whole system, and ids and sequence
 * numbers are never reused (plan, phase 2). No pure module generates an id (blueprint 1.1): this
 * one only counts upward from what the store holds, so equal inputs give equal outputs.
 */
export function idAllocator(counters: Counters, demand: { readonly ids: number; readonly seqs: number }): IdAllocation {
  const idCount = wholeCount(demand.ids);
  const seqCount = wholeCount(demand.seqs);
  const bump: EntityOp = {
    kind: 'putCounters',
    row: { nextId: counters.nextId + idCount, nextSeq: counters.nextSeq + seqCount },
  };
  return {
    ids: run(counters.nextId, idCount),
    seqs: run(counters.nextSeq, seqCount),
    counterCs: { ops: idCount + seqCount === 0 ? [] : [bump] },
  };
}
