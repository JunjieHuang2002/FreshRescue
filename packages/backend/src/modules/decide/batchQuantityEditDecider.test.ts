import { describe, expect, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result, ValidQty } from '@freshrescue/contract-primitives';
import { buildBatch, buildFoodType, buildSnapshot } from '../../testing/fixtures';
import { snapshotInvariantChecker } from '../engine/snapshotInvariantChecker';
import { changeSetApplier } from '../state/changeSetApplier';
import { batchQuantityEditDecider } from './batchQuantityEditDecider';

const qty = (milli: number): ValidQty => milli as ValidQty;
const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

/** Chicken (30) has two batches, 40 and 41, with dates and sequence numbers of their own. */
const snapshot = buildSnapshot({
  foodTypes: [buildFoodType({ id: 30, name: 'Chicken' })],
  batches: [
    buildBatch({ id: 40, foodTypeId: 30, quantity: 300_000, inboundDate: '2026-10-01', expirationDate: '2026-10-04', createdSeq: 1 }),
    buildBatch({ id: 41, foodTypeId: 30, quantity: 150_000, inboundDate: '2026-10-02', expirationDate: '2026-10-09', createdSeq: 2 }),
  ],
});

describe('BC-30 BatchQuantityEditDecider', () => {
  it('replaces the quantity of the batch and changes nothing else on it (spec 4.2.1)', () => {
    expect(valueOf(batchQuantityEditDecider(41, qty(120_500), snapshot))).toEqual({
      ops: [
        {
          kind: 'putBatch',
          row: { id: 41, foodTypeId: 30, quantity: 120_500, inboundDate: '2026-10-02', expirationDate: '2026-10-09', createdSeq: 2 },
        },
      ],
    });
  });

  it('takes the new quantity as the quantity and not as an amount to add: a partial outbound is a smaller number', () => {
    const [op] = valueOf(batchQuantityEditDecider(40, qty(100_000), snapshot)).ops;

    expect(op).toMatchObject({ row: { id: 40, quantity: 100_000 } });
  });

  it('leaves the other batch, the order of the batches and the Food Type alone', () => {
    const next = valueOf(changeSetApplier(snapshot, valueOf(batchQuantityEditDecider(40, qty(1), snapshot))));

    expect(next.batches.map((batch) => [batch.id, batch.quantity])).toEqual([[40, 1], [41, 150_000]]);
    expect(next.foodTypes).toEqual(snapshot.foodTypes);
    expect(snapshotInvariantChecker(next)).toEqual({ ok: true, value: next });
  });

  it('writes the batch even when the quantity is the one it has', () => {
    expect(valueOf(batchQuantityEditDecider(40, qty(300_000), snapshot)).ops).toEqual([{ kind: 'putBatch', row: snapshot.batches[0] }]);
  });

  it('is BATCH_NOT_FOUND for an id that is no batch, a Food Type\'s id included', () => {
    expect(errorOf(batchQuantityEditDecider(999, qty(1), snapshot)).code).toBe('BATCH_NOT_FOUND');
    expect(errorOf(batchQuantityEditDecider(30, qty(1), snapshot)).code).toBe('BATCH_NOT_FOUND');
  });

  it('never edits the snapshot it is given', () => {
    const before = structuredClone(snapshot);

    batchQuantityEditDecider(40, qty(1), snapshot);
    batchQuantityEditDecider(999, qty(1), snapshot);

    expect(snapshot).toEqual(before);
  });
});
