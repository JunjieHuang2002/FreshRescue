import type { FoodType, Snapshot } from '@freshrescue/contract-entities';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Id, Result } from '@freshrescue/contract-primitives';

/**
 * What FoodTypeResolver hands back: the Food Type that an inbound names, or the name of one that is
 * still to be created. The type lives here, and not in a contract, because only this module makes it
 * and only its calling coordinator reads it (plan, phase 2). `new` carries the name exactly as it was
 * typed, because NameValidator, which comes next, owns the rules for a name.
 */
export type Resolved =
  | { readonly kind: 'existing'; readonly foodType: FoodType }
  | { readonly kind: 'new'; readonly name: string };

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

/** The key by which two names are the same Food Type: trimmed, with the case ignored, as NameValidator compares them. */
const keyOf = (name: string): string => name.trim().toLowerCase();

/**
 * BC-28 FoodTypeResolver. Resolves the Food Type that an inbound refers to, by id or by the name that
 * was typed (spec 4.2.5):
 *
 * - An id names an existing Food Type, or it is FOOD_TYPE_NOT_FOUND. A picked id wins if a name came
 *   with it, though CommandParser never lets both through (BAD_COMBINATION).
 * - A name that matches an existing Food Type, trimmed and without regard to case, selects it: it is
 *   not a duplicate (spec exception row 18). Nothing is matched loosely, so `Tomatoes` does not find
 *   `Tomato`, `Mlik` does not find `Milk`, and a part of a name finds nothing. A fuzzy match would
 *   silently file one food under another.
 * - A name that matches nothing is a new Food Type, which is no error: the inbound creates it.
 * - No id and no name, which is what the form sends when its name is left blank, is a new Food Type
 *   with the empty name. NameValidator then answers NAME_EMPTY (spec exception row 3).
 */
export function foodTypeResolver(foodTypeId: Id | null, foodName: string | null, snapshot: Snapshot): Result<Resolved, DomainError> {
  if (foodTypeId !== null) {
    const picked = snapshot.foodTypes.find((candidate) => candidate.id === foodTypeId);
    if (picked === undefined) return fail('FOOD_TYPE_NOT_FOUND', `there is no Food Type with id ${foodTypeId}`);
    return { ok: true, value: { kind: 'existing', foodType: picked } };
  }
  if (foodName === null) return { ok: true, value: { kind: 'new', name: '' } };

  const key = keyOf(foodName);
  const match = snapshot.foodTypes.find((candidate) => keyOf(candidate.name) === key);
  return { ok: true, value: match === undefined ? { kind: 'new', name: foodName } : { kind: 'existing', foodType: match } };
}
