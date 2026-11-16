import { describe, expect, it } from 'vitest';
import type { Batch } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { DateISO, Result } from '@freshrescue/contract-primitives';
import type { Allocation, BatchView, ThresholdMap } from '@freshrescue/contract-views';
import { buildBatch } from '../../testing/fixtures';
import { batchStatusClassifier } from '../foundation/batchStatusClassifier';
import { fefoAllocator } from './fefoAllocator';

const TODAY = '2026-10-10';
const DEFAULT: ThresholdMap = { 10: { days: 3, source: 'global' }, 11: { days: 3, source: 'global' } };

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const viewsOf = (batches: readonly Batch[], today: DateISO = TODAY): BatchView[] => batchStatusClassifier(batches, DEFAULT, today);
const beef = (id: number, quantity: number, expirationDate: DateISO, createdSeq: number): Batch =>
  buildBatch({ id, foodTypeId: 10, quantity, inboundDate: '2026-10-01', expirationDate, createdSeq });

// spec 4.5: batch A (100 g) expired yesterday, B (150 g) is Near-Expiry and expires tomorrow, C (200 g) is Fresh for 7 days
const A = beef(20, 100_000, '2026-10-09', 1);
const B = beef(21, 150_000, '2026-10-11', 2);
const C = beef(22, 200_000, '2026-10-17', 3);

describe('BC-36 FefoAllocator', () => {
  it('covers the 300 g of the spec example from B and then C, and leaves the Expired A alone (spec 4.5)', () => {
    const allocation: Allocation = valueOf(fefoAllocator(10, 300_000, viewsOf([A, B, C])));

    expect(allocation).toEqual({
      foodTypeId: 10,
      takes: [
        { batchId: 21, takeMilli: 150_000, emptied: true },
        { batchId: 22, takeMilli: 150_000, emptied: false },
      ],
    });
    expect(allocation.takes.map((take) => take.batchId)).not.toContain(20);
  });

  it('ignores Expired batches even when they expire first (step 1)', () => {
    const allocation = valueOf(fefoAllocator(10, 50_000, viewsOf([A, C])));

    expect(allocation.takes).toEqual([{ batchId: 22, takeMilli: 50_000, emptied: false }]);
  });

  it('takes the earliest D_exp first, so Near-Expiry stock goes before Fresh stock (step 2)', () => {
    const later = beef(30, 100_000, '2026-10-30', 1);
    const sooner = beef(31, 100_000, '2026-10-12', 9);

    expect(valueOf(fefoAllocator(10, 150_000, viewsOf([later, sooner]))).takes.map((take) => take.batchId)).toEqual([31, 30]);
  });

  it('takes the batch with the lower createdSeq first when two expire on the same day (step 2)', () => {
    const second = beef(30, 100_000, '2026-10-12', 9);
    const first = beef(31, 100_000, '2026-10-12', 4);

    expect(valueOf(fefoAllocator(10, 150_000, viewsOf([second, first]))).takes).toEqual([
      { batchId: 31, takeMilli: 100_000, emptied: true },
      { batchId: 30, takeMilli: 50_000, emptied: false },
    ]);
  });

  it('gives the same allocation whatever order the batches come in', () => {
    const forward = valueOf(fefoAllocator(10, 300_000, viewsOf([A, B, C])));

    expect(valueOf(fefoAllocator(10, 300_000, viewsOf([C, A, B])))).toEqual(forward);
    expect(valueOf(fefoAllocator(10, 300_000, viewsOf([C, B, A])))).toEqual(forward);
  });

  it('carries what is still needed to the next batch and stops once Q_req is covered (step 3)', () => {
    const allocation = valueOf(fefoAllocator(10, 100_000, viewsOf([A, B, C])));

    expect(allocation.takes).toEqual([{ batchId: 21, takeMilli: 100_000, emptied: false }]);
  });

  it('marks a take that uses its batch up as emptied, and takes exactly Q_req in all', () => {
    expect(valueOf(fefoAllocator(10, 150_000, viewsOf([A, B, C]))).takes).toEqual([{ batchId: 21, takeMilli: 150_000, emptied: true }]);

    const everything = valueOf(fefoAllocator(10, 350_000, viewsOf([A, B, C])));
    expect(everything.takes.every((take) => take.emptied)).toBe(true);
    expect(everything.takes.reduce((sum, take) => sum + take.takeMilli, 0)).toBe(350_000);
  });

  it('takes from the batches of its Food Type only', () => {
    const broccoli = buildBatch({ id: 40, foodTypeId: 11, quantity: 900_000, expirationDate: '2026-10-10', createdSeq: 0 });

    expect(valueOf(fefoAllocator(10, 300_000, viewsOf([broccoli, A, B, C]))).takes.map((take) => take.batchId)).toEqual([21, 22]);
  });

  describe('INSUFFICIENT_STOCK: the usable stock cannot cover Q_req, which only an inconsistent snapshot can cause', () => {
    it('is refused when Q_avail is below Q_req', () => {
      const result = fefoAllocator(10, 350_001, viewsOf([A, B, C]));

      expect(result).toMatchObject({ ok: false, err: { code: 'INSUFFICIENT_STOCK' } });
      expect(result.ok ? '' : result.err.detail).toMatch(/Food Type 10 .*350.*350\.001/);
    });

    it('is refused when only Expired stock would cover it', () => {
      expect(fefoAllocator(10, 50_000, viewsOf([A]))).toMatchObject({ ok: false, err: { code: 'INSUFFICIENT_STOCK' } });
    });

    it('is refused for a Food Type without a batch', () => {
      expect(fefoAllocator(11, 1, viewsOf([A, B, C]))).toMatchObject({ ok: false, err: { code: 'INSUFFICIENT_STOCK' } });
    });
  });

  it('uses the statuses it is given, so a batch that expires as the date moves on is no longer taken', () => {
    // on Oct 12, B (Oct 11) has expired too, and C alone is left
    expect(valueOf(fefoAllocator(10, 150_000, viewsOf([A, B, C], '2026-10-12'))).takes).toEqual([{ batchId: 22, takeMilli: 150_000, emptied: false }]);
  });
});
