import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DateISO } from '@freshrescue/contract-primitives';
import type { BatchView, WarningPanelDto } from '@freshrescue/contract-views';
import { buildBatch, buildFoodType, buildSnapshot } from '../../testing/fixtures';
import { batchStatusClassifier } from '../foundation/batchStatusClassifier';
import { thresholdResolver } from '../foundation/thresholdResolver';
import { nameSorter } from './nameSorter';
import { warningPanelProjector } from './warningPanelProjector';

/** getWarningPanel in the blueprint's order: thresholds, statuses, order, projection. */
const panel = (snapshot: Snapshot, today: DateISO): WarningPanelDto =>
  warningPanelProjector(batchStatusClassifier(snapshot.batches, thresholdResolver(snapshot), today), snapshot, nameSorter(snapshot.foodTypes));

const batch = (id: number, foodTypeId: number, expirationDate: DateISO, createdSeq: number, quantity = 1_000) =>
  buildBatch({ id, foodTypeId, quantity, inboundDate: '2026-10-01', expirationDate, createdSeq });

// Milk (10) is created before Beef (11) and Chicken (12), so creation order is not A to Z. Today is Oct 10, T_eff 3.
const kitchen = buildSnapshot({
  foodTypes: [buildFoodType({ id: 10, name: 'Milk', unit: 'ml' }), buildFoodType({ id: 11, name: 'Beef' }), buildFoodType({ id: 12, name: 'Chicken' })],
  batches: [
    batch(20, 10, '2026-10-11', 1),
    batch(21, 11, '2026-10-11', 3),
    batch(22, 11, '2026-10-11', 2),
    batch(23, 12, '2026-10-10', 4),
    batch(24, 12, '2026-10-13', 5),
    batch(25, 12, '2026-10-20', 6),
    batch(26, 10, '2026-10-09', 7),
    batch(27, 11, '2026-10-05', 8),
  ],
});
const ids = (rows: WarningPanelDto['nearExpiry']): number[] => rows.map((row) => row.batchId);

describe('BC-18 WarningPanelProjector', () => {
  it('puts the Near-Expiry batches in one section and the Expired ones in another, and Fresh ones in neither (spec 4.3.3)', () => {
    const dto = panel(kitchen, '2026-10-10');

    expect(dto.nearExpiry.every((row) => row.status === 'nearExpiry')).toBe(true);
    expect(dto.expired.every((row) => row.status === 'expired')).toBe(true);
    expect([...ids(dto.nearExpiry), ...ids(dto.expired)]).not.toContain(25);
  });

  it('sorts each section by days left, then Food Type name A to Z, then createdSeq', () => {
    const dto = panel(kitchen, '2026-10-10');

    // 0 days: Chicken 23; 1 day: Beef (seq 2 before seq 3), then Milk, whatever the creation order; 3 days: Chicken 24
    expect(ids(dto.nearExpiry)).toEqual([23, 22, 21, 20, 24]);
    // expired 5 days ago comes before expired yesterday
    expect(ids(dto.expired)).toEqual([27, 26]);
  });

  it('gives each row what the panel shows: the Food Type, the quantity with its unit, the expiry and the days left', () => {
    expect(panel(kitchen, '2026-10-10').expired[1]).toEqual({
      batchId: 26,
      foodTypeId: 10,
      foodTypeName: 'Milk',
      unit: 'ml',
      quantity: 1_000,
      expirationDate: '2026-10-09',
      daysLeft: -1,
      status: 'expired',
    });
  });

  it('is empty when nothing is near expiry, "No near-expiry items", and shows Expired batches only if there are some (spec 4.6)', () => {
    const fresh = buildSnapshot({ foodTypes: [buildFoodType({ id: 10, name: 'Milk' })], batches: [batch(20, 10, '2026-10-30', 1)] });

    expect(panel(fresh, '2026-10-10')).toEqual({ nearExpiry: [], expired: [] });
    expect(panel(fresh, '2026-11-01')).toMatchObject({ nearExpiry: [], expired: [{ batchId: 20, daysLeft: -2 }] });
    expect(panel(buildSnapshot(), '2026-10-10')).toEqual({ nearExpiry: [], expired: [] });
  });

  it('uses the T_eff of each Food Type: with a threshold of 7 days, 5 days left is Near-Expiry', () => {
    const custom = {
      ...kitchen,
      foodTypes: kitchen.foodTypes.map((f) => (f.id === 12 ? { ...f, customThresholdDays: 7 } : f)),
    };

    // on Oct 15 batch 25 has 5 days left: Near-Expiry under Chicken's own 7 days, Fresh under the default 3
    expect(ids(panel(custom, '2026-10-15').nearExpiry)).toEqual([25]);
    expect(ids(panel(kitchen, '2026-10-15').nearExpiry)).toEqual([]);
  });

  it('follows the Food Type order it is given for the name tie-break, and leaves out a batch whose Food Type is not there', () => {
    const view = (id: number, foodTypeId: number, createdSeq: number): BatchView => ({
      ...batch(id, foodTypeId, '2026-10-11', createdSeq),
      daysLeft: 1,
      status: 'nearExpiry',
    });
    const views = [view(30, 10, 1), view(31, 11, 2), view(32, 99, 3)];

    expect(ids(warningPanelProjector(views, kitchen, [10, 11]).nearExpiry)).toEqual([30, 31]);
    expect(ids(warningPanelProjector(views, kitchen, [11, 10]).nearExpiry)).toEqual([31, 30]);
  });
});
