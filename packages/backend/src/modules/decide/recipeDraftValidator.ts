import type { Snapshot, ValidRecipeDraft } from '@freshrescue/contract-entities';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { RecipeDraft } from '@freshrescue/contract-messages';
import type { Id, Result, ValidQty, ValidUnit } from '@freshrescue/contract-primitives';
import { LIMITS, SYSTEM_IDS, UNIT_LIST } from '@freshrescue/contract-rules';

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

/**
 * The quantity rule of spec section 3, which a recipe's `Q_req` shares with a batch: a whole number of
 * thousandths from 1 to 500,000,000. It is the rule of ScalarValidator, written out again because a
 * module imports no other module. The checks run in the order of ScalarValidator, so a row is judged
 * by the same code as a batch: whole number, then positive, then not above the maximum.
 */
function quantityFault(raw: number): { readonly code: ErrorCode; readonly detail: string } | null {
  if (!Number.isInteger(raw)) return { code: 'QTY_NOT_INTEGER', detail: `a quantity is a whole number of thousandths, and this is ${raw}` };
  if (raw < LIMITS.QTY_MIN_MILLI) {
    return { code: 'QTY_NOT_POSITIVE', detail: `a quantity is at least ${LIMITS.QTY_MIN_MILLI} thousandth (0.001), and this is ${raw}` };
  }
  if (raw > LIMITS.QTY_MAX_MILLI) {
    return { code: 'QTY_TOO_LARGE', detail: `a quantity is at most ${LIMITS.QTY_MAX_MILLI} thousandths (500,000), and this is ${raw}` };
  }
  return null;
}

/**
 * BC-32 RecipeDraftValidator. Validates a recipe draft against the rules of spec section 3 ("Recipe
 * Definition") and returns it as a `ValidRecipeDraft`: the cuisine resolved, and each row with a
 * validated quantity and unit. The recipe's name is NameValidator's business, not this module's.
 *
 * The checks run in the order the blueprint states them (3.2), and the first one that fails is the
 * error. The rows are named by their position, counting from 1:
 *
 * 1. at least one ingredient row (NO_INGREDIENTS)
 * 2. no Food Type twice, whatever the quantities and units (DUP_INGREDIENT)
 * 3. every row names an existing Food Type (UNKNOWN_FOOD_TYPE)
 * 4. each row, in order, has a valid quantity (QTY_NOT_INTEGER, QTY_NOT_POSITIVE, QTY_TOO_LARGE) and
 *    then a valid unit, spelled exactly as in the list (UNIT_UNKNOWN)
 * 5. the cuisine exists (CATEGORY_NOT_FOUND). A `null` cuisine means `Other`, and is looked up like any id
 *
 * A Required Unit that differs from the Food Type's unit is allowed. It only makes the recipe a Unit
 * Conflict, which is derived later and blocks the recipe (spec section 3 and 4.4.A).
 */
export function recipeDraftValidator(draft: RecipeDraft, snapshot: Snapshot): Result<ValidRecipeDraft, DomainError> {
  if (draft.rows.length === 0) return fail('NO_INGREDIENTS', 'a recipe needs at least one ingredient row');

  const used = new Set<Id>();
  for (const [index, row] of draft.rows.entries()) {
    if (used.has(row.foodTypeId)) {
      return fail('DUP_INGREDIENT', `row ${index + 1} repeats Food Type ${row.foodTypeId}: a recipe has one row for each Food Type`);
    }
    used.add(row.foodTypeId);
  }

  const known = new Set(snapshot.foodTypes.map((foodType) => foodType.id));
  for (const [index, row] of draft.rows.entries()) {
    if (!known.has(row.foodTypeId)) return fail('UNKNOWN_FOOD_TYPE', `row ${index + 1} names Food Type ${row.foodTypeId}, and there is none`);
  }

  for (const [index, row] of draft.rows.entries()) {
    const fault = quantityFault(row.quantity);
    if (fault !== null) return fail(fault.code, `row ${index + 1}: ${fault.detail}`);
    if (!(UNIT_LIST as readonly string[]).includes(row.unit)) {
      return fail('UNIT_UNKNOWN', `row ${index + 1}: a unit is one of ${UNIT_LIST.join(', ')}, and this is "${row.unit}"`);
    }
  }

  const recipeCategoryId = draft.cuisineId ?? SYSTEM_IDS.CUISINE_OTHER;
  if (!snapshot.recipeCategories.some((cuisine) => cuisine.id === recipeCategoryId)) {
    return fail('CATEGORY_NOT_FOUND', `there is no cuisine with id ${recipeCategoryId}`);
  }
  return {
    ok: true,
    value: {
      recipeCategoryId,
      rows: draft.rows.map((row) => ({
        foodTypeId: row.foodTypeId,
        requiredQuantity: row.quantity as ValidQty,
        requiredUnit: row.unit as ValidUnit,
      })),
    },
  };
}
