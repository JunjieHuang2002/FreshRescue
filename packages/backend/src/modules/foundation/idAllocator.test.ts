import { describe, expect, it } from 'vitest';
import type { Counters } from '@freshrescue/contract-entities';
import { FIRST_FREE_ID } from '@freshrescue/contract-rules';
import { idAllocator } from './idAllocator';

const START: Counters = { nextId: FIRST_FREE_ID, nextSeq: 1 };

describe('BC-02 IdAllocator', () => {
  it('reserves consecutive ids from the first free id, which is 3 because 1 and 2 are the two Other categories', () => {
    const allocation = idAllocator(START, { ids: 2, seqs: 0 });

    expect(allocation.ids).toEqual([3, 4]);
    expect(allocation.seqs).toEqual([]);
  });

  it('reserves ids and createdSeq values together, as an inbound of a new Food Type does (2 ids, 1 seq)', () => {
    const allocation = idAllocator({ nextId: 40, nextSeq: 17 }, { ids: 2, seqs: 1 });

    expect(allocation.ids).toEqual([40, 41]);
    expect(allocation.seqs).toEqual([17]);
  });

  it('returns the ChangeSet that moves the counters past what was reserved', () => {
    const allocation = idAllocator({ nextId: 40, nextSeq: 17 }, { ids: 2, seqs: 1 });

    expect(allocation.counterCs).toEqual({ ops: [{ kind: 'putCounters', row: { nextId: 42, nextSeq: 18 } }] });
  });

  it('bumps only the counter that was asked for', () => {
    expect(idAllocator(START, { ids: 1, seqs: 0 }).counterCs.ops).toEqual([
      { kind: 'putCounters', row: { nextId: 4, nextSeq: 1 } },
    ]);
    expect(idAllocator(START, { ids: 0, seqs: 3 }).counterCs.ops).toEqual([
      { kind: 'putCounters', row: { nextId: 3, nextSeq: 4 } },
    ]);
  });

  it('writes nothing when nothing is reserved, such as the edit of a recipe, which needs no id', () => {
    const allocation = idAllocator(START, { ids: 0, seqs: 0 });

    expect(allocation).toEqual({ ids: [], seqs: [], counterCs: { ops: [] } });
  });

  it('never reuses an id: allocating again from the bumped counters continues where the first call stopped', () => {
    const first = idAllocator(START, { ids: 3, seqs: 2 });
    const [bump] = first.counterCs.ops;
    expect(bump?.kind).toBe('putCounters');
    const after = bump?.kind === 'putCounters' ? bump.row : START;

    const second = idAllocator(after, { ids: 2, seqs: 1 });

    expect([...first.ids, ...second.ids]).toEqual([3, 4, 5, 6, 7]);
    expect([...first.seqs, ...second.seqs]).toEqual([1, 2, 3]);
  });

  it('reserves nothing for a demand that is not a whole number of at least 0, and does not fail', () => {
    for (const demand of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(idAllocator(START, { ids: demand, seqs: demand })).toEqual({ ids: [], seqs: [], counterCs: { ops: [] } });
    }
  });

  it('gives the same answer for the same input and leaves its input alone', () => {
    const counters: Counters = { nextId: 9, nextSeq: 4 };
    const first = idAllocator(counters, { ids: 2, seqs: 1 });
    const second = idAllocator(counters, { ids: 2, seqs: 1 });

    expect(first).toEqual(second);
    expect(counters).toEqual({ nextId: 9, nextSeq: 4 });
  });
});
