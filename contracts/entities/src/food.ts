import type { DateISO, Id, QtyMilli } from '@freshrescue/contract-primitives';

// The records of the stored state (spec 1.2). Names and units are plain `string` here: the brands
// `ValidName` and `ValidUnit` live in the signatures of the deciders, and SnapshotInvariantChecker
// checks the stored result once more.

/** A grouping for Food Types: two levels (Parent, then Child) plus the system category `Other`. */
export type FoodCategory = {
  readonly id: Id;
  readonly name: string;
  /** null for a top-level category (a Parent, or `Other`). A Child names its Parent. */
  readonly parentId: Id | null;
  /** True only for `Other`: no children, no custom threshold, and it cannot be renamed or deleted. */
  readonly isSystem: boolean;
  /** The category's own near-expiry threshold in whole days, or null when it inherits. */
  readonly customThresholdDays: number | null;
};

/** A registered food. Its category and its unit belong to it, never to a batch. */
export type FoodType = {
  readonly id: Id;
  readonly name: string;
  readonly categoryId: Id;
  /** One of the six units. It persists while the Food Type has no batches. */
  readonly unit: string;
  readonly customThresholdDays: number | null;
};

/** One inbound record of a Food Type. Only its quantity is ever edited. */
export type Batch = {
  readonly id: Id;
  readonly foodTypeId: Id;
  readonly quantity: QtyMilli;
  /** `D_in`: the date the batch was added. */
  readonly inboundDate: DateISO;
  /** `D_exp`: the last day the batch is usable. */
  readonly expirationDate: DateISO;
  /** Increases monotonically and is never reused: the tie-break of FEFO. */
  readonly createdSeq: number;
};
