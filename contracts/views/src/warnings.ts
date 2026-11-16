import type { DateISO, Id, QtyMilli } from '@freshrescue/contract-primitives';
import type { BatchStatus } from '@freshrescue/contract-rules';

/** One batch in the Warning Panel. */
export type WarningRow = {
  readonly batchId: Id;
  readonly foodTypeId: Id;
  readonly foodTypeName: string;
  readonly unit: string;
  readonly quantity: QtyMilli;
  readonly expirationDate: DateISO;
  readonly daysLeft: number;
  /** `nearExpiry` in the first section, `expired` in the second. */
  readonly status: BatchStatus;
};

/**
 * The Warning Panel (spec 4.3.3): the Near-Expiry batches, and a separate section of the Expired
 * ones. Each section is sorted by days left, then Food Type name A to Z, then `createdSeq`. An
 * empty `nearExpiry` means "No near-expiry items", and an empty `expired` hides its section.
 */
export type WarningPanelDto = {
  readonly nearExpiry: readonly WarningRow[];
  readonly expired: readonly WarningRow[];
};
