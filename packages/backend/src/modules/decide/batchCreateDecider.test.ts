import { describe, expect, it } from 'vitest';
import type { ChangeSet } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result, ValidQty } from '@freshrescue/contract-primitives';
import { buildFoodCategory, buildFoodType, buildSnapshot } from '../../testing/fixtures';
import { snapshotInvariantChecker } from '../engine/snapshotInvariantChecker';
import { idAllocator } from '../foundation/idAllocator';
import { changeSetApplier } from '../state/changeSetApplier';
import { batchCreateDecider } from './batchCreateDecider';

const qty = (milli: number): ValidQty => milli as ValidQty;
const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);

const [DAIRY, LIQUID_DAIRY, MILK] = [10, 11, 30];

/** Spec 4.2.1: Milk (30), in ml, under Dairy (10) then Liquid Dairy (11). */
const snapshot = buildSnapshot({
  foodCategories: [buildFoodCategory({ id: DAIRY, name: 'Dairy' }), buildFoodCategory({ id: LIQUID_DAIRY, name: 'Liquid Dairy', parentId: DAIRY })],
  foodTypes: [buildFoodType({ id: MILK, name: 'Milk', unit: 'ml', categoryId: LIQUID_DAIRY })],
});

describe('BC-29 BatchCreateDecider', () => {
  it('adds one batch with the id, the sequence number, the quantity and the dates it is given', () => {
    expect(batchCreateDecider(MILK, qty(500_000), { inboundDate: '2026-10-01', expirationDate: '2026-10-06' }, 40, 7)).toEqual({
      ops: [
        {
          kind: 'putBatch',
          row: { id: 40, foodTypeId: MILK, quantity: 500_000, inboundDate: '2026-10-01', expirationDate: '2026-10-06', createdSeq: 7 },
        },
      ],
    });
  });

  it('keeps the two dates as they are: it does no date arithmetic, which is ExpiryResolver\'s', () => {
    const [op] = batchCreateDecider(MILK, qty(1), { inboundDate: '2026-02-28', expirationDate: '2027-03-01' }, 40, 1).ops;

    expect(op).toMatchObject({ row: { inboundDate: '2026-02-28', expirationDate: '2027-03-01' } });
  });

  it('is the worked example of spec 4.2.1: two batches of Milk stay two, each with its own dates', () => {
    const oct1 = alloc(snapshot);
    const first = batchCreateDecider(MILK, qty(500_000), { inboundDate: '2026-10-01', expirationDate: '2026-10-06' }, oct1.id, oct1.seq);
    const afterFirst = settle(snapshot, oct1.counterCs, first);

    const oct2 = alloc(afterFirst);
    const second = batchCreateDecider(MILK, qty(1_000_000), { inboundDate: '2026-10-02', expirationDate: '2026-10-12' }, oct2.id, oct2.seq);
    const afterSecond = settle(afterFirst, oct2.counterCs, second);

    // the counters of this snapshot start at 31, one past the highest id (Milk, 30), and at sequence number 1
    expect(afterSecond.foodTypes).toHaveLength(1);
    expect(afterSecond.batches).toEqual([
      { id: 31, foodTypeId: MILK, quantity: 500_000, inboundDate: '2026-10-01', expirationDate: '2026-10-06', createdSeq: 1 },
      { id: 32, foodTypeId: MILK, quantity: 1_000_000, inboundDate: '2026-10-02', expirationDate: '2026-10-12', createdSeq: 2 },
    ]);
  });

  it('never merges batches: the same Food Type, dates and quantity make two records (spec 4.2.1)', () => {
    const dates = { inboundDate: '2026-10-01', expirationDate: '2026-10-06' };
    const one = alloc(snapshot);
    const afterOne = settle(snapshot, one.counterCs, batchCreateDecider(MILK, qty(500_000), dates, one.id, one.seq));
    const two = alloc(afterOne);
    const afterTwo = settle(afterOne, two.counterCs, batchCreateDecider(MILK, qty(500_000), dates, two.id, two.seq));

    expect(afterTwo.batches).toHaveLength(2);
    expect(new Set(afterTwo.batches.map((batch) => batch.id)).size).toBe(2);
    expect(afterTwo.batches.map((batch) => batch.createdSeq)).toEqual([1, 2]);
  });

  it('accepts a batch that expires on the day it comes in, a shelf life of 0 (spec section 3)', () => {
    const next = valueOf(changeSetApplier(snapshot, batchCreateDecider(MILK, qty(1), { inboundDate: '2026-10-01', expirationDate: '2026-10-01' }, 40, 1)));

    expect(next.batches).toHaveLength(1);
  });

  it('judges nothing, so it has no error: it answers a ChangeSet and not a Result', () => {
    const changeSet = batchCreateDecider(MILK, qty(1), { inboundDate: '2026-10-01', expirationDate: '2026-10-01' }, 40, 1);

    expect(Object.keys(changeSet)).toEqual(['ops']);
    expect('ok' in changeSet).toBe(false);
  });

  it('makes only the batch: the counters are bumped by the ChangeSet of IdAllocator, and the Food Type is not looked for', () => {
    const { ops } = batchCreateDecider(999, qty(1), { inboundDate: '2026-10-01', expirationDate: '2026-10-01' }, 40, 1);

    expect(ops.map((op) => op.kind)).toEqual(['putBatch']);
    // Food Type 999 does not exist: the decider does not know, and the invariant checker is what refuses the result
    const next = valueOf(changeSetApplier(snapshot, { ops }));
    expect(snapshotInvariantChecker(next)).toMatchObject({ ok: false, err: { code: 'INVARIANT_BROKEN' } });
  });
});

/** The ids that the coordinator reserves for one inbound of an existing Food Type: one id and one sequence number. */
function alloc(from: Snapshot): { id: number; seq: number; counterCs: ChangeSet } {
  const reserved = idAllocator(from.counters, { ids: 1, seqs: 1 });
  return {
    id: reserved.ids[0] ?? expect.unreachable('no id was reserved'),
    seq: reserved.seqs[0] ?? expect.unreachable('no sequence number was reserved'),
    counterCs: reserved.counterCs,
  };
}

/** What the write path does with a request: each ChangeSet applied in turn, and the result checked each time. */
function settle(from: Snapshot, ...changeSets: readonly ChangeSet[]): Snapshot {
  let current = from;
  for (const changeSet of changeSets) {
    current = valueOf(changeSetApplier(current, changeSet));
    valueOf(snapshotInvariantChecker(current));
  }
  return current;
}
