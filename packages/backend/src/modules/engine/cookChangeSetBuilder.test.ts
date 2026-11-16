import { describe, expect, it } from 'vitest';
import type { ChangeSet } from '@freshrescue/contract-changeset';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import type { Allocation } from '@freshrescue/contract-views';
import { buildBatch, buildFoodType, buildSnapshot } from '../../testing/fixtures';
import { changeSetApplier } from '../state/changeSetApplier';
import { cookChangeSetBuilder } from './cookChangeSetBuilder';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);

// spec 4.5: Beef (10) with batch A (100 g, expired), B (150 g, near expiry) and C (200 g, fresh); Broccoli (11)
const kitchen = buildSnapshot({
  foodTypes: [buildFoodType({ id: 10, name: 'Beef' }), buildFoodType({ id: 11, name: 'Broccoli' })],
  batches: [
    buildBatch({ id: 20, foodTypeId: 10, quantity: 100_000, inboundDate: '2026-10-01', expirationDate: '2026-10-09', createdSeq: 1 }),
    buildBatch({ id: 21, foodTypeId: 10, quantity: 150_000, inboundDate: '2026-10-01', expirationDate: '2026-10-11', createdSeq: 2 }),
    buildBatch({ id: 22, foodTypeId: 10, quantity: 200_000, inboundDate: '2026-10-03', expirationDate: '2026-10-17', createdSeq: 3 }),
    buildBatch({ id: 23, foodTypeId: 11, quantity: 250_000, inboundDate: '2026-10-02', expirationDate: '2026-10-20', createdSeq: 4 }),
  ],
});

/** The allocation of the spec example: all of B, and 150 g of C. */
const FEFO_BEEF: Allocation = {
  foodTypeId: 10,
  takes: [
    { batchId: 21, takeMilli: 150_000, emptied: true },
    { batchId: 22, takeMilli: 150_000, emptied: false },
  ],
};

describe('BC-37 CookChangeSetBuilder', () => {
  it('deletes the batch that is used up and leaves 50 g in C, as spec 4.5 says', () => {
    expect(valueOf(cookChangeSetBuilder(30, [FEFO_BEEF], kitchen))).toEqual({
      ops: [
        { kind: 'deleteBatch', id: 21 },
        { kind: 'putBatch', row: { id: 22, foodTypeId: 10, quantity: 50_000, inboundDate: '2026-10-03', expirationDate: '2026-10-17', createdSeq: 3 } },
      ],
    });
  });

  it('gives a ChangeSet that the applier takes: A stays untouched, B is gone, C holds 50 g', () => {
    const after = valueOf(changeSetApplier(kitchen, valueOf(cookChangeSetBuilder(30, [FEFO_BEEF], kitchen))));

    expect(after.batches.map((b) => [b.id, b.quantity])).toEqual([[20, 100_000], [22, 50_000], [23, 250_000]]);
  });

  it('changes nothing on a batch but its quantity: the dates and createdSeq stay (spec 4.2.1)', () => {
    const [, put] = valueOf(cookChangeSetBuilder(30, [FEFO_BEEF], kitchen)).ops;

    expect(put).toEqual({ kind: 'putBatch', row: { ...kitchen.batches[2], quantity: 50_000 } });
  });

  it('removes a batch whose quantity reaches 0 (spec 4.5.5)', () => {
    const all: Allocation = { foodTypeId: 11, takes: [{ batchId: 23, takeMilli: 250_000, emptied: true }] };

    expect(valueOf(cookChangeSetBuilder(30, [all], kitchen)).ops).toEqual([{ kind: 'deleteBatch', id: 23 }]);
  });

  it('puts every ingredient\'s deductions in one ChangeSet, in the order of the allocations, so the recipe commits as one unit', () => {
    const broccoli: Allocation = { foodTypeId: 11, takes: [{ batchId: 23, takeMilli: 200_000, emptied: false }] };
    const changeSet: ChangeSet = valueOf(cookChangeSetBuilder(30, [broccoli, FEFO_BEEF], kitchen));

    expect(changeSet.ops.map((op) => (op.kind === 'deleteBatch' ? ['delete', op.id] : op.kind === 'putBatch' ? ['put', op.row.id, op.row.quantity] : [op.kind]))).toEqual([
      ['put', 23, 50_000],
      ['delete', 21],
      ['put', 22, 50_000],
    ]);
  });

  it('gives an empty ChangeSet when nothing is allocated', () => {
    expect(valueOf(cookChangeSetBuilder(30, [], kitchen))).toEqual({ ops: [] });
    expect(valueOf(cookChangeSetBuilder(30, [{ foodTypeId: 10, takes: [] }], kitchen))).toEqual({ ops: [] });
  });

  describe('BATCH_NOT_FOUND: an allocation that the snapshot does not back', () => {
    it('is refused for a take from a batch that is not there', () => {
      const result = cookChangeSetBuilder(30, [{ foodTypeId: 10, takes: [{ batchId: 404, takeMilli: 1, emptied: false }] }], kitchen);

      expect(result).toMatchObject({ ok: false, err: { code: 'BATCH_NOT_FOUND' } });
      expect(result.ok ? '' : result.err.detail).toMatch(/recipe 30 .*batch 404/);
    });

    it('is refused for a take from a batch of another Food Type than its ingredient', () => {
      // batch 23 holds Broccoli, not Beef
      const wrong: Allocation = { foodTypeId: 10, takes: [{ batchId: 23, takeMilli: 1_000, emptied: false }] };

      expect(cookChangeSetBuilder(30, [wrong], kitchen)).toMatchObject({ ok: false, err: { code: 'BATCH_NOT_FOUND' } });
    });

    it('builds no part of the ChangeSet when one take fails', () => {
      const result = cookChangeSetBuilder(30, [FEFO_BEEF, { foodTypeId: 11, takes: [{ batchId: 405, takeMilli: 1, emptied: false }] }], kitchen);

      expect(result.ok).toBe(false);
    });
  });

  it('leaves two takes of one batch as two operations, which the applier then refuses as CONFLICTING_OPS', () => {
    const twice: Allocation = {
      foodTypeId: 10,
      takes: [
        { batchId: 22, takeMilli: 10_000, emptied: false },
        { batchId: 22, takeMilli: 10_000, emptied: false },
      ],
    };
    const changeSet = valueOf(cookChangeSetBuilder(30, [twice], kitchen));

    expect(changeSet.ops).toHaveLength(2);
    expect(changeSetApplier(kitchen, changeSet)).toMatchObject({ ok: false, err: { code: 'CONFLICTING_OPS' } });
  });
});
