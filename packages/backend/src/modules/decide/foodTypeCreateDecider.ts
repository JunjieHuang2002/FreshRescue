import type { ChangeSet } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Id, Result, ValidName, ValidThreshold, ValidUnit } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

/**
 * BC-24 FoodTypeCreateDecider. Builds the ChangeSet that adds one Food Type, without a batch (spec
 * 4.2.5). The name, the unit and the threshold have been through their validators and the coordinator
 * reserved the id, so this module decides only the category: a Food Type belongs to exactly one, a
 * Parent, a Child or `Other`, and a `null` category means `Other` (spec section 3). The default is
 * looked up like any other id, so a snapshot that has lost its `Other` cannot be given a Food Type
 * (CATEGORY_NOT_FOUND), and so cannot an id that is a cuisine or nothing at all.
 *
 * The unit is the Food Type's own and persists at zero stock. A `null` threshold means that it inherits.
 * The inbound of a new name uses the same module, with its first batch added by BatchCreateDecider.
 */
export function foodTypeCreateDecider(
  name: ValidName,
  categoryId: Id | null,
  unit: ValidUnit,
  threshold: ValidThreshold | null,
  snapshot: Snapshot,
  id: Id,
): Result<ChangeSet, DomainError> {
  const target = categoryId ?? SYSTEM_IDS.FOOD_OTHER;
  if (!snapshot.foodCategories.some((category) => category.id === target)) {
    return fail('CATEGORY_NOT_FOUND', `there is no food category with id ${target}`);
  }
  return {
    ok: true,
    value: { ops: [{ kind: 'putFoodType', row: { id, name, categoryId: target, unit, customThresholdDays: threshold } }] },
  };
}
