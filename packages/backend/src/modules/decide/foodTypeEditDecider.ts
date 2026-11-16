import type { ChangeSet } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Id, Result, ValidName, ValidThreshold } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

/**
 * BC-25 FoodTypeEditDecider. Builds the ChangeSet that edits a Food Type's name, category and
 * threshold (spec 4.2.5). The name has been through NameValidator, which left the Food Type itself
 * out of the duplicate check, and the threshold through ScalarValidator. A `null` category means
 * `Other` and a `null` threshold clears the custom threshold, so the Food Type inherits again.
 *
 * The unit is not an input and never changes here: it changes only through UnitChangeDecider, which
 * converts every batch with it (spec 4.2.2). The batches are not touched either, because they take
 * their category from the Food Type, and `T_eff` is derived on every request. A Food Type that is not
 * there is FOOD_TYPE_NOT_FOUND, and it is judged before the category. A category that is not in the
 * food tree, a cuisine included, is CATEGORY_NOT_FOUND.
 */
export function foodTypeEditDecider(
  foodTypeId: Id,
  name: ValidName,
  categoryId: Id | null,
  threshold: ValidThreshold | null,
  snapshot: Snapshot,
): Result<ChangeSet, DomainError> {
  const foodType = snapshot.foodTypes.find((candidate) => candidate.id === foodTypeId);
  if (foodType === undefined) return fail('FOOD_TYPE_NOT_FOUND', `there is no Food Type with id ${foodTypeId}`);

  const target = categoryId ?? SYSTEM_IDS.FOOD_OTHER;
  if (!snapshot.foodCategories.some((category) => category.id === target)) {
    return fail('CATEGORY_NOT_FOUND', `there is no food category with id ${target}`);
  }
  return {
    ok: true,
    value: { ops: [{ kind: 'putFoodType', row: { ...foodType, name, categoryId: target, customThresholdDays: threshold } }] },
  };
}
