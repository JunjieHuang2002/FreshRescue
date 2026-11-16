import type { FoodType, Recipe, RecipeCategory, RecipeIngredient, Snapshot } from '@freshrescue/contract-entities';
import type { Id } from '@freshrescue/contract-primitives';
import type { MatchMap, RecipeLine, RecipeMatch, RecommendationDto, RecommendationRow, StockMap } from '@freshrescue/contract-views';

/** What a row of the recommendation is built from. */
type Lookups = {
  readonly foodTypes: ReadonlyMap<Id, FoodType>;
  readonly cuisines: ReadonlyMap<Id, RecipeCategory>;
  readonly rowsOf: ReadonlyMap<Id, readonly RecipeIngredient[]>;
};

/** One ingredient row as Feature 3 shows it. A Missing Ingredient is badged `missing`. */
function lineOf(row: RecipeIngredient, match: RecipeMatch, foodTypes: ReadonlyMap<Id, FoodType>): RecipeLine {
  // a gated recipe is never blocked, so each of its rows was evaluated; a row that somehow was not counts as not available
  const matched = match.rows.find((candidate) => candidate.foodTypeId === row.foodTypeId);
  return {
    foodTypeId: row.foodTypeId,
    name: foodTypes.get(row.foodTypeId)?.name ?? row.deletedFoodTypeName ?? '',
    requiredQuantity: row.requiredQuantity,
    requiredUnit: row.requiredUnit,
    available: matched?.avail ?? 0,
    state: matched?.fulfilled === true ? 'ok' : 'missing',
    rescued: matched?.rescued ?? false,
    foodTypeUnit: null,
  };
}

function rowOf(recipe: Recipe, match: RecipeMatch, lookups: Lookups): RecommendationRow {
  const ingredients = (lookups.rowsOf.get(recipe.id) ?? []).map((row) => lineOf(row, match, lookups.foodTypes));
  return {
    recipeId: recipe.id,
    name: recipe.name,
    cuisineName: lookups.cuisines.get(recipe.recipeCategoryId)?.name ?? '',
    availableCount: match.availableCount,
    totalCount: ingredients.length,
    ingredients,
  };
}

/**
 * BC-14 RecommendationBuilder. Builds the Feature 3 read model, Expiry-First Recipes (spec 4.4.B and
 * 4.6). Feature 3 recommends only; cooking happens in Feature 4.
 *
 * - The entry gate: a recipe appears only if it is not blocked and has at least one Rescued Ingredient
 *   (`Q_near_expiry > 0` and `Q_avail >= Q_req`), so every recipe shown here uses up near-expiry stock.
 *   A recipe of Fresh or Missing items only, or whose near-expiry ingredient is itself short, never appears.
 * - Tier 1 (`full`): the gated recipes in which every ingredient is available in full.
 * - Tier 2 (`partial`): shown only when Tier 1 is empty while near-expiry items exist. It lists the
 *   gated recipes with at least one Missing Ingredient (exception row 11), each Missing row badged.
 * - Both tiers keep the order they are given, which is A to Z (NameSorter).
 * - The empty states: no near-expiry stock at all is `noNearExpiry` (exception row 13), and near-expiry
 *   stock that no recipe can rescue is `noRescue` (exception row 17).
 *
 * Whether near-expiry items exist is read from the stock: some Food Type has `Q_near_expiry > 0`.
 */
export function recommendationBuilder(matches: MatchMap, stock: StockMap, snapshot: Snapshot, order: readonly Id[]): RecommendationDto {
  const rowsOf = new Map<Id, RecipeIngredient[]>();
  for (const row of snapshot.recipeIngredients) {
    const rows = rowsOf.get(row.recipeId);
    if (rows === undefined) rowsOf.set(row.recipeId, [row]);
    else rows.push(row);
  }
  const lookups: Lookups = {
    foodTypes: new Map(snapshot.foodTypes.map((foodType): [Id, FoodType] => [foodType.id, foodType])),
    cuisines: new Map(snapshot.recipeCategories.map((cuisine): [Id, RecipeCategory] => [cuisine.id, cuisine])),
    rowsOf,
  };
  const recipes = new Map(snapshot.recipes.map((recipe): [Id, Recipe] => [recipe.id, recipe]));

  // The entry gate has two parts. (b), at least one Rescued Ingredient, is checked here. (a), not
  // blocked, holds through the tiers themselves: Tier 1 takes Full Matches and Tier 2 Partial ones, and a
  // blocked recipe is neither, whatever else its match says.
  const rescuing = order.flatMap((id) => {
    const recipe = recipes.get(id);
    const match = matches[id];
    return recipe !== undefined && match !== undefined && match.hasRescued ? [{ recipe, match }] : [];
  });
  const tier1 = rescuing.filter(({ match }) => match.status === 'full');
  const tier2 = rescuing.filter(({ match }) => match.status === 'partial');
  const nearExpiryExists = Object.values(stock).some((entry) => entry.near > 0);

  if (tier1.length > 0) {
    return { tier: 'full', recipes: tier1.map(({ recipe, match }) => rowOf(recipe, match, lookups)), emptyState: null };
  }
  if (nearExpiryExists && tier2.length > 0) {
    return { tier: 'partial', recipes: tier2.map(({ recipe, match }) => rowOf(recipe, match, lookups)), emptyState: null };
  }
  return { tier: null, recipes: [], emptyState: nearExpiryExists ? 'noRescue' : 'noNearExpiry' };
}
