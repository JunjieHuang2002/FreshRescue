import type { DateISO, Id, QtyMilli } from '@freshrescue/contract-primitives';
import type { CategoryScope } from '@freshrescue/contract-rules';

// The 13 commands (blueprint 3.4). A field that may be absent is written as `T | null` and is always
// present on the wire, so `null` is the one way to say "none": a threshold cleared, a category
// left to default to `Other`. A quantity is thousandths, not yet validated. A name, a unit and a
// threshold are raw, and the validators of the coordinator turn them into `ValidName` and so on.

/**
 * Every command, one name per line. The type tables below must cover exactly these names, and the
 * assertions in messages.test.ts make the compiler check it.
 */
export const COMMAND_TYPES = [
  'SaveCategory',
  'DeleteCategory',
  'SetCategoryThreshold',
  'SaveFoodType',
  'ChangeFoodTypeUnit',
  'DeleteFoodType',
  'InboundBatch',
  'EditBatchQuantity',
  'RemoveBatch',
  'SaveRecipe',
  'DeleteRecipe',
  'CookRecipes',
  'SetSimulatedToday',
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

/** How long a batch lasts: a shelf life in whole days, or an expiration date (spec section 3). Exactly one of the two. */
export type Expiry = { readonly days: number } | { readonly date: DateISO };

/** One ingredient row of a recipe as entered. */
export type RecipeDraftRow = {
  readonly foodTypeId: Id;
  readonly quantity: QtyMilli;
  readonly unit: string;
};

/** A recipe as entered, before RecipeDraftValidator has checked it. A null cuisine means `Other`. */
export type RecipeDraft = {
  readonly cuisineId: Id | null;
  readonly rows: readonly RecipeDraftRow[];
};

/** The new quantity of one batch, in the new unit of a unit change. */
export type BatchQuantity = {
  readonly batchId: Id;
  readonly quantity: QtyMilli;
};

/**
 * What each command carries. Eight are written in forms. The other five carry ids only: the four
 * deletions (DeleteCategory, DeleteFoodType, RemoveBatch, DeleteRecipe) and CookRecipes.
 */
export type CommandPayloads = {
  /** Create a category when `categoryId` is null (under `parentId`, which is null for a Parent or a cuisine), or rename it. */
  SaveCategory: {
    readonly scope: CategoryScope;
    readonly categoryId: Id | null;
    readonly parentId: Id | null;
    readonly name: string;
  };
  DeleteCategory: {
    readonly scope: CategoryScope;
    readonly categoryId: Id;
  };
  /** A null threshold clears the custom threshold. */
  SetCategoryThreshold: {
    readonly categoryId: Id;
    readonly thresholdDays: number | null;
  };
  /** Create a Food Type when `foodTypeId` is null (it needs a unit), or edit it (it never changes the unit). A null category means `Other`. */
  SaveFoodType: {
    readonly foodTypeId: Id | null;
    readonly name: string;
    readonly categoryId: Id | null;
    readonly unit: string | null;
    readonly thresholdDays: number | null;
  };
  /** The new unit with a new quantity for every batch of the Food Type, so that all convert or none do. */
  ChangeFoodTypeUnit: {
    readonly foodTypeId: Id;
    readonly unit: string;
    readonly batches: readonly BatchQuantity[];
  };
  DeleteFoodType: {
    readonly foodTypeId: Id;
  };
  /**
   * Add one batch. Name the Food Type by `foodTypeId` or by `foodName`, never both. A name that
   * matches no Food Type creates one, which then needs `unit` and may carry a `categoryId`.
   */
  InboundBatch: {
    readonly foodTypeId: Id | null;
    readonly foodName: string | null;
    readonly categoryId: Id | null;
    readonly unit: string | null;
    readonly quantity: QtyMilli;
    readonly expiry: Expiry;
  };
  EditBatchQuantity: {
    readonly batchId: Id;
    readonly quantity: QtyMilli;
  };
  RemoveBatch: {
    readonly batchId: Id;
  };
  /** Create a recipe when `recipeId` is null, or replace it and its ingredient rows. */
  SaveRecipe: {
    readonly recipeId: Id | null;
    readonly name: string;
    readonly draft: RecipeDraft;
  };
  DeleteRecipe: {
    readonly recipeId: Id;
  };
  /** The queued recipes in queue order. A recipe queued twice appears twice. */
  CookRecipes: {
    readonly recipeIds: readonly Id[];
  };
  /** A null date clears Simulated Today. */
  SetSimulatedToday: {
    readonly date: DateISO | null;
  };
};

/** A command as it travels: its name and its payload. CommandParser turns request text into one. */
export type Command = {
  [T in CommandType]: { readonly type: T; readonly payload: CommandPayloads[T] };
}[CommandType];
