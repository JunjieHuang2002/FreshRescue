import type { DateISO, Id } from '@freshrescue/contract-primitives';

/** The two stored settings (spec section 3). */
export type Settings = {
  /** The demo date that replaces the device date everywhere, or null to use the device date. */
  readonly simulatedToday: DateISO | null;
  /** True once the store has been seeded. A store that is not bootstrapped is seeded at startup. */
  readonly bootstrapped: boolean;
};

/** The two counters that IdAllocator reserves from. One id counter serves every kind of record. */
export type Counters = {
  /** The next id to hand out. Ids 1 and 2 belong to the two `Other` categories. */
  readonly nextId: Id;
  /** The next `createdSeq` of a batch. */
  readonly nextSeq: number;
};
