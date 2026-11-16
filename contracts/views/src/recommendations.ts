import type { Id } from '@freshrescue/contract-primitives';
import type { EmptyState, RecommendationTier } from '@freshrescue/contract-rules';
import type { RecipeLine } from './catalog';

/** One recommended recipe. It always has at least one Rescued Ingredient (spec 4.4.B). */
export type RecommendationRow = {
  readonly recipeId: Id;
  readonly name: string;
  readonly cuisineName: string;
  readonly availableCount: number;
  readonly totalCount: number;
  /** The rows of the recipe, each badged when it is missing or rescued. */
  readonly ingredients: readonly RecipeLine[];
};

/** The Feature 3 read model: the entry gate, tier 1, the tier 2 fallback, and the empty state (spec 4.4.B and 4.6). */
export type RecommendationDto = {
  /** `full` lists tier 1. `partial` lists tier 2, which shows only when tier 1 is empty. null lists nothing. */
  readonly tier: RecommendationTier | null;
  readonly recipes: readonly RecommendationRow[];
  /** Why nothing is recommended: no near-expiry stock at all, or none that a recipe can rescue. null otherwise. */
  readonly emptyState: EmptyState | null;
};
