import type { DateISO, Id } from '@freshrescue/contract-primitives';

/** A category with its children: a food category tree node, or a cuisine (which has no children). */
export type CategoryNode = {
  readonly id: Id;
  readonly name: string;
  readonly isSystem: boolean;
  /** The category's own threshold in days, or null. A cuisine has none. */
  readonly customThresholdDays: number | null;
  readonly children: readonly CategoryNode[];
};

/** A Food Type as a picker offers it. */
export type FoodTypeOption = {
  readonly id: Id;
  readonly name: string;
  readonly unit: string;
  readonly categoryId: Id;
};

/** What the forms, the filters and the demo control are built from. */
export type ReferenceDataDto = {
  /** The date every other figure was derived for: Simulated Today when set, otherwise the device date. */
  readonly today: DateISO;
  readonly simulatedToday: DateISO | null;
  /** The static default threshold in days, which is not editable. */
  readonly globalThresholdDays: number;
  readonly units: readonly string[];
  /** The food category tree: Parents with their Children, then `Other`. */
  readonly foodCategories: readonly CategoryNode[];
  /** The recipe cuisines, in the same shape with no children. */
  readonly cuisines: readonly CategoryNode[];
  readonly foodTypes: readonly FoodTypeOption[];
};
