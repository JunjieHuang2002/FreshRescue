import { describe, expect, it } from 'vitest';
import type { ChangeSet } from '@freshrescue/contract-changeset';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { buildBatch, buildFoodType, buildSnapshot } from '../../testing/fixtures';
import { idAllocator } from '../foundation/idAllocator';
import { changeSetApplier } from '../state/changeSetApplier';
import { changeSetMerger } from './changeSetMerger';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);

const snapshot = buildSnapshot();
const counters: ChangeSet = { ops: [{ kind: 'putCounters', row: { nextId: 5, nextSeq: 2 } }] };
const newFoodType: ChangeSet = { ops: [{ kind: 'putFoodType', row: buildFoodType({ id: 3, name: 'Kale' }) }] };
const firstBatch: ChangeSet = { ops: [{ kind: 'putBatch', row: buildBatch({ id: 4, foodTypeId: 3, createdSeq: 1 }) }] };

describe('BC-42 ChangeSetMerger', () => {
  it('joins the operations of the ChangeSets in order, each keeping its own order', () => {
    const two: ChangeSet = {
      ops: [
        { kind: 'deleteBatch', id: 8 },
        { kind: 'deleteBatch', id: 9 },
      ],
    };

    expect(changeSetMerger([counters, two, newFoodType]).ops).toEqual([...counters.ops, ...two.ops, ...newFoodType.ops]);
  });

  it('writes an inbound of a new Food Type as one ChangeSet: the counters, the Food Type and its first batch, together or not at all', () => {
    const merged = changeSetMerger([counters, newFoodType, firstBatch]);
    const after = valueOf(changeSetApplier(snapshot, merged));

    expect(after.foodTypes.map((f) => f.name)).toEqual(['Kale']);
    expect(after.batches.map((b) => [b.id, b.foodTypeId])).toEqual([[4, 3]]);
    expect(after.counters).toEqual({ nextId: 5, nextSeq: 2 });
  });

  it('merges the empty ChangeSet of a request that reserved nothing away, and gives an empty one for nothing', () => {
    const nothingReserved = idAllocator(snapshot.counters, { ids: 0, seqs: 0 }).counterCs;

    expect(changeSetMerger([nothingReserved, newFoodType])).toEqual(newFoodType);
    expect(changeSetMerger([])).toEqual({ ops: [] });
    expect(changeSetMerger([{ ops: [] }, { ops: [] }])).toEqual({ ops: [] });
  });

  it('keeps two operations on one record as two, so the applier still refuses them as CONFLICTING_OPS', () => {
    const merged = changeSetMerger([counters, counters]);

    expect(merged.ops).toHaveLength(2);
    expect(changeSetApplier(snapshot, merged)).toMatchObject({ ok: false, err: { code: 'CONFLICTING_OPS' } });
  });

  it('leaves the ChangeSets it joins as they were', () => {
    const parts = Object.freeze([Object.freeze(counters), Object.freeze(newFoodType)]);

    changeSetMerger(parts);
    expect(counters.ops).toHaveLength(1);
    expect(newFoodType.ops).toHaveLength(1);
  });
});
