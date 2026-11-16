import type { Snapshot } from '@freshrescue/contract-entities';
import type { Id, QtyMilli } from '@freshrescue/contract-primitives';
import { STATUS_URGENCY } from '@freshrescue/contract-rules';
import type { BatchStatus } from '@freshrescue/contract-rules';
import type { BatchView, StockEntry, StockMap } from '@freshrescue/contract-views';

/** The running figures of one Food Type while its batches are added up. */
type Tally = {
  total: QtyMilli;
  byStatus: Record<BatchStatus, QtyMilli>;
  overall: BatchStatus | null;
};

/** The more urgent of two statuses: Expired over Near-Expiry over Fresh. null is no batch yet. */
const moreUrgent = (current: BatchStatus | null, next: BatchStatus): BatchStatus =>
  current === null || STATUS_URGENCY[next] > STATUS_URGENCY[current] ? next : current;

/**
 * BC-09 StockAggregator. Sums the batch quantities of every Food Type into the figures that the
 * screens and the recipe rules use (spec 4.2.3 and 4.7.1):
 *
 * - `total`: every batch, Expired ones included. It is the physical stock and what counts toward the
 *   500,000 cap.
 * - `avail`: `Q_avail`, the Fresh and Near-Expiry batches. An Expired batch contributes 0.
 * - `near`: `Q_near_expiry`, the Near-Expiry batches only.
 * - `byStatus`: the quantity in each status, 0 for a status that has no batch.
 * - `overall`: the most urgent status among the batches (Expired > Near-Expiry > Fresh), or null
 *   when there is no batch.
 *
 * Every Food Type of the snapshot has an entry, so one without a batch reads as 0 everywhere and has
 * no status (spec 4.7.1, exception row 22). The statuses come in with the batches, from
 * BatchStatusClassifier, so nothing here looks at a date. A batch whose Food Type is not in the
 * snapshot belongs to no Food Type and is not counted; SnapshotInvariantChecker never lets one be stored.
 */
export function stockAggregator(snapshot: Snapshot, batches: readonly BatchView[]): StockMap {
  const tallies = new Map<Id, Tally>();
  for (const foodType of snapshot.foodTypes) {
    tallies.set(foodType.id, { total: 0, byStatus: { fresh: 0, nearExpiry: 0, expired: 0 }, overall: null });
  }

  for (const batch of batches) {
    const tally = tallies.get(batch.foodTypeId);
    if (tally === undefined) continue;
    tally.total += batch.quantity;
    tally.byStatus[batch.status] += batch.quantity;
    tally.overall = moreUrgent(tally.overall, batch.status);
  }

  const stock: Record<Id, StockEntry> = {};
  for (const [foodTypeId, { total, byStatus, overall }] of tallies) {
    stock[foodTypeId] = { total, avail: byStatus.fresh + byStatus.nearExpiry, near: byStatus.nearExpiry, byStatus, overall };
  }
  return stock;
}
