import type { DomainError } from '@freshrescue/contract-errors';
import type { Id, QtyMilli, Result } from '@freshrescue/contract-primitives';
import type { Allocation, BatchTake, BatchView } from '@freshrescue/contract-views';

/** Step 2 of spec 4.5.3: by `D_exp` ascending, and the lower `createdSeq` first on the same day. `YYYY-MM-DD` text sorts as the calendar does. */
const firstExpiredFirstOut = (a: BatchView, b: BatchView): number => {
  if (a.expirationDate !== b.expirationDate) return a.expirationDate < b.expirationDate ? -1 : 1;
  return a.createdSeq - b.createdSeq;
};

/**
 * BC-36 FefoAllocator. Picks the batches that cover one ingredient's `Q_req`, First-Expired,
 * First-Out (spec 4.5.3):
 *
 * 1. Exclude every Expired batch: it is never deducted and is left untouched.
 * 2. Order the Near-Expiry and Fresh batches of the Food Type by `D_exp`, earliest first; on the same
 *    `D_exp` the batch created first (lower `createdSeq`) goes first.
 * 3. Take from the earliest batch first and carry what is still needed over to the next one, until
 *    exactly `Q_req` is taken. A take that uses a batch up is marked `emptied`.
 *
 * All batches of a Food Type share one `T_eff`, so Near-Expiry batches always come before Fresh ones
 * and a Rescued Ingredient always consumes near-expiry stock. The coordinator calls this only for an
 * ingredient with `Q_avail >= Q_req`, so usable stock below `Q_req` means an inconsistent snapshot:
 * INSUFFICIENT_STOCK, and nothing is taken.
 */
export function fefoAllocator(foodTypeId: Id, qReq: QtyMilli, batches: readonly BatchView[]): Result<Allocation, DomainError> {
  const usable = batches.filter((batch) => batch.foodTypeId === foodTypeId && batch.status !== 'expired').sort(firstExpiredFirstOut);
  const available = usable.reduce((sum, batch) => sum + batch.quantity, 0);
  if (available < qReq) {
    const detail = `Food Type ${foodTypeId} has ${available / 1000} that is not expired, and ${qReq / 1000} is required`;
    return { ok: false, err: { code: 'INSUFFICIENT_STOCK', detail } };
  }

  const takes: BatchTake[] = [];
  let needed = qReq;
  for (const batch of usable) {
    if (needed <= 0) break;
    const takeMilli = Math.min(needed, batch.quantity);
    takes.push({ batchId: batch.id, takeMilli, emptied: takeMilli === batch.quantity });
    needed -= takeMilli;
  }
  return { ok: true, value: { foodTypeId, takes } };
}
