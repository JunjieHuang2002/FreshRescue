import type { RecipeIngredient, Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Id, Result } from '@freshrescue/contract-primitives';
import type { RecipeStatus } from '@freshrescue/contract-rules';
import type { MatchMap, MatchRow, RecipeErrors, RecipeMatch, StockMap } from '@freshrescue/contract-views';

/** A blocked recipe cannot be evaluated, so it has no rows, nothing available and nothing rescued. */
const BLOCKED: RecipeMatch = { status: 'blocked', rows: [], availableCount: 0, hasRescued: false };

/** One ingredient row against the stock of its Food Type. */
function matchRow(row: RecipeIngredient, stock: StockMap): MatchRow {
  const entry = stock[row.foodTypeId];
  const avail = entry?.avail ?? 0;
  const fulfilled = avail >= row.requiredQuantity;
  return { foodTypeId: row.foodTypeId, qReq: row.requiredQuantity, avail, fulfilled, rescued: fulfilled && (entry?.near ?? 0) > 0 };
}

/** No available row is nothing to deduct, which also covers a recipe without a row. */
function statusOf(rows: readonly MatchRow[], availableCount: number): RecipeStatus {
  if (availableCount === 0) return 'nothing';
  return availableCount === rows.length ? 'full' : 'partial';
}

/**
 * BC-13 RecipeMatchEvaluator. Classifies recipes against the derived stock (spec 4.4.B and 4.4.C),
 * with each ingredient row's `Q_avail` and Rescued flag:
 *
 * - blocked: the recipe has an error row (RecipeErrorEvaluator). Its rows cannot be evaluated, so it
 *   has none here, nothing available and no Rescued Ingredient, and it is never a Full or Partial Match.
 * - full: every row has `Q_avail >= Q_req`.
 * - partial: one or more rows are Missing (`Q_avail < Q_req`, which includes `Q_avail = 0`) and at
 *   least one row is available.
 * - nothing: no row is available, so there is nothing to deduct (exception row 16).
 *
 * A row is fulfilled when `Q_avail >= Q_req`: a cook deducts exactly `Q_req` of it, and 0 of a Missing
 * row (spec 4.5). It is a Rescued Ingredient when it is fulfilled and its Food Type has Near-Expiry
 * stock (`Q_near_expiry > 0`), so a near-expiry ingredient that is itself short of stock rescues
 * nothing. `Q_avail` holds Fresh and Near-Expiry stock only, as StockAggregator summed it, so Expired
 * stock never makes a row available.
 *
 * `onlyIds` limits the work to some recipes, which is how the cook loop evaluates one recipe at a time
 * on its running copy; null or absent means every recipe. An id in it that names no recipe is
 * RECIPE_NOT_FOUND, which the cook loop reports as a skipped entry. Rows keep the recipe's order.
 */
export function recipeMatchEvaluator(
  snapshot: Snapshot,
  stock: StockMap,
  errors: RecipeErrors,
  onlyIds?: readonly Id[] | null,
): Result<MatchMap, DomainError> {
  const known = new Set(snapshot.recipes.map((recipe) => recipe.id));
  const unknown = (onlyIds ?? []).find((id) => !known.has(id));
  if (unknown !== undefined) return { ok: false, err: { code: 'RECIPE_NOT_FOUND', detail: `there is no recipe with id ${unknown}` } };

  const wanted = onlyIds === undefined || onlyIds === null ? known : new Set(onlyIds);
  const rowsOf = new Map<Id, RecipeIngredient[]>();
  for (const row of snapshot.recipeIngredients) {
    if (!wanted.has(row.recipeId)) continue;
    const rows = rowsOf.get(row.recipeId);
    if (rows === undefined) rowsOf.set(row.recipeId, [row]);
    else rows.push(row);
  }

  const matches: Record<Id, RecipeMatch> = {};
  for (const recipe of snapshot.recipes) {
    if (!wanted.has(recipe.id)) continue;
    if ((errors[recipe.id]?.length ?? 0) > 0) {
      matches[recipe.id] = BLOCKED;
      continue;
    }
    const rows = (rowsOf.get(recipe.id) ?? []).map((row) => matchRow(row, stock));
    const availableCount = rows.filter((row) => row.fulfilled).length;
    matches[recipe.id] = { status: statusOf(rows, availableCount), rows, availableCount, hasRescued: rows.some((row) => row.rescued) };
  }
  return { ok: true, value: matches };
}
