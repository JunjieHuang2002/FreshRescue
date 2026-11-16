/**
 * The numeric limits of the input dictionary (spec section 3). Quantities are thousandths: a
 * quantity of 0.001 is 1, and the cap of 500,000 is 500,000,000.
 */
export const LIMITS = {
  /** A name has 1 to 200 characters after trimming. */
  NAME_MIN_LENGTH: 1,
  NAME_MAX_LENGTH: 200,
  /** A batch quantity and a recipe quantity: 0.001 to 500,000, with at most 3 decimals. */
  QTY_MIN_MILLI: 1,
  QTY_MAX_MILLI: 500_000_000,
  QTY_DECIMALS: 3,
  /** The sum of a Food Type's batches, Expired ones included, never exceeds this. */
  CAP_MILLI: 500_000_000,
  /** The near-expiry threshold in days: the global default, and the smallest custom value. */
  GLOBAL_THRESHOLD_DAYS: 3,
  THRESHOLD_MIN_DAYS: 1,
} as const;
