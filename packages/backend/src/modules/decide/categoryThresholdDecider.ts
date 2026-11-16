import type { ChangeSet } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Id, Result, ValidThreshold } from '@freshrescue/contract-primitives';

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

/**
 * BC-23 CategoryThresholdDecider. Builds the ChangeSet that sets or clears the custom near-expiry
 * threshold of one food category (spec 4.1.5). A `null` clears it, which reverts the category's Food
 * Types to inheritance (spec 4.3.1). The threshold has been through ScalarValidator, so it is a whole
 * number of days of at least 1. Only a Parent or a Child can carry one:
 *
 * - the system `Other` cannot (THRESHOLD_FORBIDDEN, spec 1.2)
 * - a cuisine cannot either (THRESHOLD_FORBIDDEN): a recipe has no freshness, and the blueprint
 *   refuses a threshold "for `Other` and for cuisines" (3.2). The command carries no `scope`, so an id
 *   that is a cuisine is found here and refused, and an id that is nothing is CATEGORY_NOT_FOUND
 *
 * The category keeps everything else: its name, its Parent and its place. The Food Types of the
 * category are not touched, because `T_eff` is derived from the categories on every request.
 */
export function categoryThresholdDecider(
  categoryId: Id,
  threshold: ValidThreshold | null,
  snapshot: Snapshot,
): Result<ChangeSet, DomainError> {
  const category = snapshot.foodCategories.find((candidate) => candidate.id === categoryId);
  if (category === undefined) {
    if (snapshot.recipeCategories.some((cuisine) => cuisine.id === categoryId)) {
      return fail('THRESHOLD_FORBIDDEN', 'a cuisine has no near-expiry threshold: only a food category can have one');
    }
    return fail('CATEGORY_NOT_FOUND', `there is no category with id ${categoryId}`);
  }
  if (category.isSystem) return fail('THRESHOLD_FORBIDDEN', `the system category ${category.name} cannot have a custom threshold`);
  return { ok: true, value: { ops: [{ kind: 'putFoodCategory', row: { ...category, customThresholdDays: threshold } }] } };
}
