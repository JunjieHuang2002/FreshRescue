import type { FoodType, Recipe, RecipeCategory, RecipeIngredient, Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Id, Result } from '@freshrescue/contract-primitives';
import type { CatalogDto, CatalogRow, MatchMap, RecipeErrorRow, RecipeErrors, RecipeLine, RecipeMatch } from '@freshrescue/contract-views';

/** One ingredient row as Feature 4 shows it (spec 4.4.A and 4.4.C). */
function lineOf(row: RecipeIngredient, match: RecipeMatch, errorRows: readonly RecipeErrorRow[], foodTypes: ReadonlyMap<Id, FoodType>): RecipeLine {
  const base = {
    foodTypeId: row.foodTypeId,
    name: foodTypes.get(row.foodTypeId)?.name ?? row.deletedFoodTypeName ?? '',
    requiredQuantity: row.requiredQuantity,
    requiredUnit: row.requiredUnit,
  };

  if (match.status === 'blocked') {
    // no row of a blocked recipe is evaluated; an affected row says why, and the others are plain
    const error = errorRows.find((candidate) => candidate.foodTypeId === row.foodTypeId);
    if (error?.reason === 'missingFoodType') {
      return { ...base, name: error.deletedFoodTypeName ?? base.name, available: null, state: 'missingFoodType', rescued: false, foodTypeUnit: null };
    }
    if (error?.reason === 'unitConflict') {
      return { ...base, available: null, state: 'unitConflict', rescued: false, foodTypeUnit: error.foodTypeUnit };
    }
    return { ...base, available: null, state: 'ok', rescued: false, foodTypeUnit: null };
  }

  // a recipe that is not blocked has every row evaluated; a row that somehow was not counts as not available
  const matched = match.rows.find((candidate) => candidate.foodTypeId === row.foodTypeId);
  return {
    ...base,
    available: matched?.avail ?? 0,
    state: matched?.fulfilled === true ? 'ok' : 'missing',
    rescued: matched?.rescued ?? false,
    foodTypeUnit: null,
  };
}

/**
 * BC-15 CatalogBuilder. Builds the Feature 4 read model (spec 4.4.C): every recipe, built-in and
 * user-created alike and whether or not it uses a near-expiry item, in the A to Z order it is given,
 * each with its real-time status:
 *
 * - full: every ingredient is available in full.
 * - partial: at least one ingredient is Missing, badged `missing`, with the counts for "2 of 3
 *   ingredients available".
 * - nothing: no ingredient is available, so Cook is disabled with "Nothing available to deduct".
 * - blocked: a Missing Food Type or a Unit Conflict (exception rows 6 and 7). The recipe is shown red,
 *   each affected row says why (the deleted name, or the Food Type's unit beside the Required Unit), and
 *   no row is evaluated, so every `available` is null.
 *
 * `cuisineId` is the single-select cuisine filter, and null or absent means all. A cuisine that does
 * not exist, such as one deleted since the filter was chosen, is CATEGORY_NOT_FOUND; the frontend then
 * clears the filter. The DTO repeats the filter that was applied.
 */
export function catalogBuilder(
  matches: MatchMap,
  errors: RecipeErrors,
  snapshot: Snapshot,
  order: readonly Id[],
  cuisineId?: Id | null,
): Result<CatalogDto, DomainError> {
  const filter = cuisineId ?? null;
  const cuisines = new Map(snapshot.recipeCategories.map((cuisine): [Id, RecipeCategory] => [cuisine.id, cuisine]));
  if (filter !== null && !cuisines.has(filter)) {
    return { ok: false, err: { code: 'CATEGORY_NOT_FOUND', detail: `there is no cuisine with id ${filter}` } };
  }

  const recipes = new Map(snapshot.recipes.map((recipe): [Id, Recipe] => [recipe.id, recipe]));
  const foodTypes = new Map(snapshot.foodTypes.map((foodType): [Id, FoodType] => [foodType.id, foodType]));
  const rowsOf = new Map<Id, RecipeIngredient[]>();
  for (const row of snapshot.recipeIngredients) {
    const rows = rowsOf.get(row.recipeId);
    if (rows === undefined) rowsOf.set(row.recipeId, [row]);
    else rows.push(row);
  }

  const rows: CatalogRow[] = [];
  for (const id of order) {
    const recipe = recipes.get(id);
    const match = matches[id];
    if (recipe === undefined || match === undefined) continue;
    if (filter !== null && recipe.recipeCategoryId !== filter) continue;
    const ingredients = (rowsOf.get(id) ?? []).map((row) => lineOf(row, match, errors[id] ?? [], foodTypes));
    rows.push({
      recipeId: id,
      name: recipe.name,
      cuisineId: recipe.recipeCategoryId,
      cuisineName: cuisines.get(recipe.recipeCategoryId)?.name ?? '',
      status: match.status,
      availableCount: match.availableCount,
      totalCount: ingredients.length,
      ingredients,
    });
  }
  return { ok: true, value: { cuisineId: filter, rows } };
}
