import { describe, expect, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { buildBatch, buildFoodType, buildSnapshot } from '../../testing/fixtures';
import { snapshotInvariantChecker } from '../engine/snapshotInvariantChecker';
import { changeSetApplier } from '../state/changeSetApplier';
import { batchRemoveDecider } from './batchRemoveDecider';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

/** Chicken (30) has batches 40 and 41, and carries a threshold of 2 days. Milk (31) has batch 42. */
const snapshot = buildSnapshot({
  foodTypes: [
    buildFoodType({ id: 30, name: 'Chicken', customThresholdDays: 2 }),
    buildFoodType({ id: 31, name: 'Milk', unit: 'ml' }),
  ],
  batches: [buildBatch({ id: 40, foodTypeId: 30 }), buildBatch({ id: 41, foodTypeId: 30 }), buildBatch({ id: 42, foodTypeId: 31 })],
});

describe('BC-31 BatchRemoveDecider', () => {
  it('deletes the one batch, whole (spec 4.2.4)', () => {
    expect(valueOf(batchRemoveDecider(41, snapshot))).toEqual({ ops: [{ kind: 'deleteBatch', id: 41 }] });
  });

  it('leaves every other batch where it is', () => {
    const next = valueOf(changeSetApplier(snapshot, valueOf(batchRemoveDecider(40, snapshot))));

    expect(next.batches.map((batch) => batch.id)).toEqual([41, 42]);
    expect(snapshotInvariantChecker(next)).toEqual({ ok: true, value: next });
  });

  it('leaves the Food Type registered when its last batch goes: its unit, category and threshold stay (spec 4.2.4.2)', () => {
    const afterFirst = valueOf(changeSetApplier(snapshot, valueOf(batchRemoveDecider(40, snapshot))));
    const afterLast = valueOf(changeSetApplier(afterFirst, valueOf(batchRemoveDecider(41, afterFirst))));

    expect(afterLast.batches.filter((batch) => batch.foodTypeId === 30)).toEqual([]);
    expect(afterLast.foodTypes).toEqual(snapshot.foodTypes);
    expect(snapshotInvariantChecker(afterLast)).toEqual({ ok: true, value: afterLast });
  });

  it('is BATCH_NOT_FOUND for an id that is no batch, a Food Type\'s id included', () => {
    expect(errorOf(batchRemoveDecider(999, snapshot)).code).toBe('BATCH_NOT_FOUND');
    expect(errorOf(batchRemoveDecider(30, snapshot)).code).toBe('BATCH_NOT_FOUND');
  });

  it('is BATCH_NOT_FOUND for a batch that was removed already, so a second delete does not pass', () => {
    const after = valueOf(changeSetApplier(snapshot, valueOf(batchRemoveDecider(40, snapshot))));

    expect(errorOf(batchRemoveDecider(40, after))).toMatchObject({ code: 'BATCH_NOT_FOUND' });
  });

  it('never edits the snapshot it is given', () => {
    const before = structuredClone(snapshot);

    batchRemoveDecider(40, snapshot);
    batchRemoveDecider(999, snapshot);

    expect(snapshot).toEqual(before);
  });
});
