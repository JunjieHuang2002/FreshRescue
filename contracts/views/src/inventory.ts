import type { Id, QtyMilli } from '@freshrescue/contract-primitives';
import type { BatchStatus } from '@freshrescue/contract-rules';
import type { StatusQuantities } from './derived';

/** One Food Type in the inventory list (spec 4.7.1). */
export type InventoryRow = {
  readonly foodTypeId: Id;
  readonly name: string;
  /** The category as a name path, such as `Meat`, `Poultry`, or `Other`. */
  readonly categoryPath: readonly string[];
  readonly unit: string;
  /** Every batch, Expired ones included. 0 when the Food Type has no batch. */
  readonly total: QtyMilli;
  /** The quantity in each status. A status with 0 is left out of the display. */
  readonly byStatus: StatusQuantities;
  /** The most urgent status present, or null when there is no batch. */
  readonly overall: BatchStatus | null;
};

/** The Feature 5 list: every Food Type, A to Z, including those without stock. */
export type InventoryListDto = {
  readonly rows: readonly InventoryRow[];
};
