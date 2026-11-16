import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DateISO } from '@freshrescue/contract-primitives';
import type { BatchStatus } from '@freshrescue/contract-rules';
import type { BatchView, StockMap } from '@freshrescue/contract-views';
import { buildBatch, buildFoodType, buildSnapshot } from '../../testing/fixtures';
import { batchStatusClassifier } from '../foundation/batchStatusClassifier';
import { thresholdResolver } from '../foundation/thresholdResolver';
import { stockAggregator } from './stockAggregator';

/** The derive chain of the blueprint: thresholds, then batch statuses, then stock. */
const stockOn = (snapshot: Snapshot, today: DateISO): StockMap =>
  stockAggregator(snapshot, batchStatusClassifier(snapshot.batches, thresholdResolver(snapshot), today));

/** A batch with its status set by hand, so that a test can pick the status it needs. */
const view = (id: number, foodTypeId: number, quantity: number, status: BatchStatus): BatchView => ({
  ...buildBatch({ id, foodTypeId, quantity }),
  daysLeft: { fresh: 10, nearExpiry: 1, expired: -1 }[status],
  status,
});

/** Freezes a value all the way down, so that any attempt to change it throws instead of passing unnoticed. */
function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) freeze(inner);
  }
  return value;
}

const snapshot = buildSnapshot({
  foodTypes: [buildFoodType({ id: 10, name: 'Chicken' }), buildFoodType({ id: 11, name: 'Tomato', unit: 'pieces' })],
});

describe('BC-09 StockAggregator', () => {
  it('splits a Food Type by status and totals every batch, Expired ones included (spec 4.7.1, exception row 23)', () => {
    const stock = stockAggregator(snapshot, [view(20, 10, 300_000, 'fresh'), view(21, 10, 150_000, 'nearExpiry'), view(22, 10, 100_000, 'expired')]);

    // the breakdown of the spec: Fresh 300 · Near-Expiry 150 · Expired 100
    expect(stock[10]).toEqual({
      total: 550_000,
      avail: 450_000,
      near: 150_000,
      byStatus: { fresh: 300_000, nearExpiry: 150_000, expired: 100_000 },
      overall: 'expired',
    });
  });

  it('counts Fresh and Near-Expiry stock as Q_avail and Near-Expiry stock alone as Q_near_expiry; Expired stock adds 0 to both (spec 4.2.3)', () => {
    const stock = stockAggregator(snapshot, [view(20, 10, 2_000, 'fresh'), view(21, 10, 3_000, 'nearExpiry'), view(22, 10, 5_000, 'expired')]);

    expect(stock[10]).toMatchObject({ avail: 5_000, near: 3_000 });
    // the Expired batch still counts toward the total, which is what the 500,000 cap counts
    expect(stock[10]?.total).toBe(10_000);
  });

  it('adds up several batches of one status, and keeps every Food Type apart', () => {
    const stock = stockAggregator(snapshot, [
      view(20, 10, 100_000, 'nearExpiry'),
      view(21, 11, 4_000, 'fresh'),
      view(22, 10, 50_000, 'nearExpiry'),
      view(23, 11, 1_000, 'fresh'),
    ]);

    expect(stock[10]).toMatchObject({ total: 150_000, near: 150_000, byStatus: { fresh: 0, nearExpiry: 150_000, expired: 0 } });
    expect(stock[11]).toMatchObject({ total: 5_000, avail: 5_000, near: 0, byStatus: { fresh: 5_000, nearExpiry: 0, expired: 0 } });
  });

  describe('the overall status: the most urgent one present, Expired over Near-Expiry over Fresh (spec 1.2)', () => {
    const cases: readonly (readonly [readonly BatchStatus[], BatchStatus])[] = [
      [['fresh'], 'fresh'],
      [['fresh', 'fresh'], 'fresh'],
      [['fresh', 'nearExpiry'], 'nearExpiry'],
      [['nearExpiry', 'fresh'], 'nearExpiry'],
      [['nearExpiry'], 'nearExpiry'],
      [['fresh', 'expired'], 'expired'],
      [['expired', 'nearExpiry', 'fresh'], 'expired'],
      [['nearExpiry', 'expired'], 'expired'],
      [['expired'], 'expired'],
    ];

    it.each(cases)('is %j -> %s', (statuses, overall) => {
      const views = statuses.map((status, index) => view(20 + index, 10, 1_000, status));

      expect(stockAggregator(snapshot, views)[10]?.overall).toBe(overall);
    });
  });

  it('gives a Food Type without a batch quantity 0 everywhere and no status (exception row 22)', () => {
    const stock = stockAggregator(snapshot, [view(20, 10, 1_000, 'fresh')]);

    expect(stock[11]).toEqual({ total: 0, avail: 0, near: 0, byStatus: { fresh: 0, nearExpiry: 0, expired: 0 }, overall: null });
  });

  it('has an entry for every Food Type of the snapshot and for nothing else', () => {
    // batch 22 names a Food Type that the snapshot does not have, which the invariant checker never lets be stored
    const stock = stockAggregator(snapshot, [view(20, 10, 1_000, 'fresh'), view(22, 99, 7_000, 'fresh')]);

    expect(Object.keys(stock).map(Number)).toEqual([10, 11]);
    expect(stock[10]?.total).toBe(1_000);
    expect(stock[99]).toBeUndefined();
  });

  it('gives the spec FEFO example its Q_avail of 350 g: the Expired 100 g is left out (spec 4.5)', () => {
    // on Oct 10: batch A expired yesterday, B is Near-Expiry and expires tomorrow, C is Fresh for 7 more days
    const beef = buildSnapshot({
      foodTypes: [buildFoodType({ id: 10, name: 'Beef' })],
      batches: [
        buildBatch({ id: 20, foodTypeId: 10, quantity: 100_000, inboundDate: '2026-10-01', expirationDate: '2026-10-09' }),
        buildBatch({ id: 21, foodTypeId: 10, quantity: 150_000, inboundDate: '2026-10-01', expirationDate: '2026-10-11' }),
        buildBatch({ id: 22, foodTypeId: 10, quantity: 200_000, inboundDate: '2026-10-01', expirationDate: '2026-10-17' }),
      ],
    });

    expect(stockOn(beef, '2026-10-10')[10]).toEqual({
      total: 450_000,
      avail: 350_000,
      near: 150_000,
      byStatus: { fresh: 200_000, nearExpiry: 150_000, expired: 100_000 },
      overall: 'expired',
    });
  });

  it('follows the date it is given, so the same stock moves from Fresh to Near-Expiry to Expired (spec 4.6)', () => {
    // 500 g of Chicken added on Oct 1 with a 5-day shelf life (D_exp Oct 6) and the default T_eff of 3
    const chicken = buildSnapshot({
      foodTypes: [buildFoodType({ id: 10, name: 'Chicken' })],
      batches: [buildBatch({ id: 20, foodTypeId: 10, quantity: 500_000, inboundDate: '2026-10-01', expirationDate: '2026-10-06' })],
    });
    const figures = (today: DateISO) => {
      const entry = stockOn(chicken, today)[10];
      return [entry?.avail, entry?.near, entry?.overall];
    };

    expect(figures('2026-10-01')).toEqual([500_000, 0, 'fresh']);
    expect(figures('2026-10-03')).toEqual([500_000, 500_000, 'nearExpiry']);
    expect(figures('2026-10-07')).toEqual([0, 0, 'expired']);
  });

  it('leaves its inputs as they were', () => {
    const views = freeze([view(20, 10, 300_000, 'fresh'), view(21, 10, 150_000, 'expired')]);

    expect(() => stockAggregator(freeze(snapshot), views)).not.toThrow();
    expect(views[0]?.quantity).toBe(300_000);
  });
});
