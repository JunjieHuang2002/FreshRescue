/** The freshness of one batch (spec 4.3.2), derived from `D_exp - D_now` and never stored. */
export const BATCH_STATUSES = ['fresh', 'nearExpiry', 'expired'] as const;

export type BatchStatus = (typeof BATCH_STATUSES)[number];

/** Higher is more urgent. The overall status of a Food Type is the most urgent one it has. */
export const STATUS_URGENCY = {
  fresh: 0,
  nearExpiry: 1,
  expired: 2,
} as const satisfies Record<BatchStatus, number>;

/** Which of the four levels of spec 4.3.1 decided a Food Type's effective threshold. */
export const THRESHOLD_SOURCES = ['foodType', 'child', 'parent', 'global'] as const;

export type ThresholdSource = (typeof THRESHOLD_SOURCES)[number];

/** How a recipe stands against the stock (spec 4.4.C): full match, partial match, nothing available, or blocked. */
export const RECIPE_STATUSES = ['full', 'partial', 'nothing', 'blocked'] as const;

export type RecipeStatus = (typeof RECIPE_STATUSES)[number];

/** The two errors that block a recipe (spec 4.4.A). */
export const RECIPE_ERROR_REASONS = ['missingFoodType', 'unitConflict'] as const;

export type RecipeErrorReason = (typeof RECIPE_ERROR_REASONS)[number];

/** The state of one ingredient row of a recipe: fine, short of stock, or one of the two errors. */
export const INGREDIENT_STATES = ['ok', 'missing', 'missingFoodType', 'unitConflict'] as const;

export type IngredientState = (typeof INGREDIENT_STATES)[number];

/** Feature 3 shows full matches (tier 1), or partial matches (tier 2) when there is no full match. */
export const RECOMMENDATION_TIERS = ['full', 'partial'] as const;

export type RecommendationTier = (typeof RECOMMENDATION_TIERS)[number];

/** The two empty states of Feature 3 (spec 4.6): no near-expiry stock at all, or none that a recipe can rescue. */
export const EMPTY_STATES = ['noNearExpiry', 'noRescue'] as const;

export type EmptyState = (typeof EMPTY_STATES)[number];

/** What happened to one queued recipe: it was cooked, or it was skipped (spec 4.5). */
export const COOK_OUTCOMES = ['cooked', 'skipped'] as const;

export type CookOutcome = (typeof COOK_OUTCOMES)[number];

/** Why a recipe was skipped: blocked, nothing available to deduct, or no longer there. */
export const SKIP_REASONS = ['blocked', 'nothingAvailable', 'recipeNotFound'] as const;

export type SkipReason = (typeof SKIP_REASONS)[number];
