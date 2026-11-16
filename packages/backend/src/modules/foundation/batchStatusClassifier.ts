import type { Batch } from '@freshrescue/contract-entities';
import type { DateISO } from '@freshrescue/contract-primitives';
import { LIMITS } from '@freshrescue/contract-rules';
import type { BatchStatus } from '@freshrescue/contract-rules';
import type { BatchView, ThresholdMap } from '@freshrescue/contract-views';

// Days since 1970-01-01 of a `YYYY-MM-DD` text, in integers, so that no clock and no time zone is
// involved. SnapshotParser has already checked the shape of every stored date, and today comes from
// TodayResolver. A text that is not a date gives NaN and never an exception; see `statusOf`.
// Each module that needs a date keeps its own copy of these few lines: a module imports no other module.
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;

function readDay(text: string): number {
  const match = DATE_TEXT.exec(text);
  if (match === null) return Number.NaN;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/**
 * The state of one batch (spec 4.3.2). A comparison with NaN is false, so a date that cannot be read
 * falls through both tests and the batch counts as Expired: the safe side for food.
 */
function statusOf(daysLeft: number, threshold: number): BatchStatus {
  if (daysLeft > threshold) return 'fresh';
  return daysLeft >= 0 ? 'nearExpiry' : 'expired';
}

/**
 * BC-08 BatchStatusClassifier. Labels every batch Fresh, Near-Expiry or Expired from
 * `daysLeft = D_exp - D_now` against its Food Type's `T_eff` (spec 4.3.2):
 *
 * - Fresh: `daysLeft > T_eff`
 * - Near-Expiry: `0 <= daysLeft <= T_eff`. `D_exp` is the last day the item is usable, so a batch that
 *   expires today is still Near-Expiry
 * - Expired: `daysLeft < 0`, which is from 00:00 on the day after `D_exp`
 *
 * It returns a `BatchView` for each batch, in the order given: every field of the batch plus
 * `daysLeft` and `status`. A batch whose Food Type has no entry in the map uses the global
 * threshold. Status is never stored: it is derived again on every request (spec 4.6), so it
 * changes at midnight and when Simulated Today changes.
 */
export function batchStatusClassifier(batches: readonly Batch[], thresholds: ThresholdMap, today: DateISO): BatchView[] {
  const now = readDay(today);
  return batches.map((batch) => {
    const daysLeft = readDay(batch.expirationDate) - now;
    const threshold = thresholds[batch.foodTypeId]?.days ?? LIMITS.GLOBAL_THRESHOLD_DAYS;
    return { ...batch, daysLeft, status: statusOf(daysLeft, threshold) };
  });
}
