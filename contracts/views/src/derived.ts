import type { DateISO, Id, QtyMilli } from '@freshrescue/contract-primitives';
import type { BatchStatus, RecipeStatus, ThresholdSource } from '@freshrescue/contract-rules';

// The derived shapes that backend modules pass to each other through a coordinator (blueprint 1.4).
// Nothing here is stored: freshness, `T_eff`, stock and recipe status are recomputed from the
// snapshot on each request (spec 4.6). A map is keyed by the id of the record it describes, and a
// lookup that misses reads as `undefined`.

/** The effective near-expiry threshold `T_eff` of one Food Type, and the level that decided it (spec 4.3.1). */
export type ThresholdEntry = {
  readonly days: number;
  readonly source: ThresholdSource;
};

/** FoodTypeId to its effective threshold: the output of ThresholdResolver. */
export type ThresholdMap = Readonly<Record<Id, ThresholdEntry>>;

/**
 * A batch with its derived freshness: every field of `Batch`, plus `daysLeft` (`D_exp - D_now`,
 * negative once expired) and `status`. It repeats the fields of `Batch` because `views` may not
 * import `entities`, and tools/contracts.test.ts checks that it still extends `Batch`.
 */
export type BatchView = {
  readonly id: Id;
  readonly foodTypeId: Id;
  readonly quantity: QtyMilli;
  readonly inboundDate: DateISO;
  readonly expirationDate: DateISO;
  readonly createdSeq: number;
  readonly daysLeft: number;
  readonly status: BatchStatus;
};

/** A quantity for each status. */
export type StatusQuantities = Readonly<Record<BatchStatus, QtyMilli>>;

/** The stock of one Food Type (spec 4.2.3). */
export type StockEntry = {
  /** Every batch, Expired ones included: the physical stock, and what counts toward the cap. */
  readonly total: QtyMilli;
  /** `Q_avail`: Fresh and Near-Expiry batches. */
  readonly avail: QtyMilli;
  /** `Q_near_expiry`: Near-Expiry batches only. */
  readonly near: QtyMilli;
  readonly byStatus: StatusQuantities;
  /** The most urgent status among its batches, or null when it has none. */
  readonly overall: BatchStatus | null;
};

/** FoodTypeId to its stock: the output of StockAggregator. */
export type StockMap = Readonly<Record<Id, StockEntry>>;

/** The category of a Food Type as a name path, such as `Meat`, `Poultry`, or just `Other`. */
export type PathEntry = {
  readonly categoryId: Id;
  readonly names: readonly string[];
};

/** FoodTypeId to its category path: the output of CategoryPathResolver. */
export type PathMap = Readonly<Record<Id, PathEntry>>;

/** One ingredient row that blocks its recipe, with its reason (spec 4.4.A). */
export type RecipeErrorRow =
  | {
      readonly reason: 'missingFoodType';
      readonly foodTypeId: Id;
      /** The name the Food Type had when it was deleted. */
      readonly deletedFoodTypeName: string | null;
    }
  | {
      readonly reason: 'unitConflict';
      readonly foodTypeId: Id;
      readonly requiredUnit: string;
      readonly foodTypeUnit: string;
    };

/** RecipeId to its error rows: the output of RecipeErrorEvaluator. A recipe without an error has no entry. */
export type RecipeErrors = Readonly<Record<Id, readonly RecipeErrorRow[]>>;

/** One ingredient row of a recipe against the stock. */
export type MatchRow = {
  readonly foodTypeId: Id;
  /** `Q_req`. */
  readonly qReq: QtyMilli;
  /** `Q_avail` of the Food Type. */
  readonly avail: QtyMilli;
  /** `Q_avail >= Q_req`: the row is deducted when the recipe is cooked. */
  readonly fulfilled: boolean;
  /** A Rescued Ingredient: `Q_near_expiry > 0` and fulfilled (spec 1.2). */
  readonly rescued: boolean;
};

/** How one recipe stands against the stock (spec 4.4.B and 4.4.C). A blocked recipe has no rows. */
export type RecipeMatch = {
  readonly status: RecipeStatus;
  readonly rows: readonly MatchRow[];
  /** How many rows are fulfilled. */
  readonly availableCount: number;
  /** True when at least one row is a Rescued Ingredient. */
  readonly hasRescued: boolean;
};

/** RecipeId to its match: the output of RecipeMatchEvaluator. */
export type MatchMap = Readonly<Record<Id, RecipeMatch>>;

/** What FEFO takes from one batch for one ingredient. */
export type BatchTake = {
  readonly batchId: Id;
  readonly takeMilli: QtyMilli;
  /** True when the take uses the batch up, so it is removed. */
  readonly emptied: boolean;
};

/** The batches that cover one ingredient of a recipe, earliest expiry first: the output of FefoAllocator. */
export type Allocation = {
  readonly foodTypeId: Id;
  readonly takes: readonly BatchTake[];
};
