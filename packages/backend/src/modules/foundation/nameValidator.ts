import type { Snapshot, SnapshotList } from '@freshrescue/contract-entities';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Id, Named, Result, ValidName } from '@freshrescue/contract-primitives';
import { LIMITS } from '@freshrescue/contract-rules';
import type { NameScope } from '@freshrescue/contract-rules';

/** The list of the snapshot in which each scope keeps its names (spec section 3, "Name uniqueness scopes"). */
const LIST_OF_SCOPE = {
  foodType: 'foodTypes',
  recipe: 'recipes',
  // one list holds both levels, so a Parent and a Child cannot share a name
  foodCategory: 'foodCategories',
  cuisine: 'recipeCategories',
} as const satisfies Record<NameScope, SnapshotList>;

/** `Other` is reserved in both category trees, so no category can be given the name of a system category. */
const RESERVED_SCOPES: readonly NameScope[] = ['foodCategory', 'cuisine'];
const RESERVED_NAME = 'other';

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

/**
 * BC-03 NameValidator. Checks one name against spec section 3: trimmed, 1 to 200 characters,
 * unique in its scope without regard to case, and not the reserved `Other` where that applies.
 * It returns the trimmed text with its case kept, as a `ValidName`, which is the only way a name
 * reaches a decider.
 *
 * The checks run in this order, and the first one that fails is the error: empty, too long,
 * reserved, duplicate. `selfId` is the record that is being renamed: it is left out of the
 * duplicate check, so `milk` to `Milk` is allowed. Case is ignored with `toLowerCase`, which does
 * not depend on the machine's locale. Characters are counted as code points, which is also how
 * MySQL counts the characters of a utf8mb4 column, so an emoji counts once.
 */
export function nameValidator(raw: string, scope: NameScope, snapshot: Snapshot, selfId?: Id | null): Result<ValidName, DomainError> {
  const text = raw.trim();
  const length = Array.from(text).length;
  if (length < LIMITS.NAME_MIN_LENGTH) return fail('NAME_EMPTY', 'a name needs at least 1 character after trimming');
  if (length > LIMITS.NAME_MAX_LENGTH) {
    return fail('NAME_TOO_LONG', `a name has at most ${LIMITS.NAME_MAX_LENGTH} characters, and this one has ${length}`);
  }

  const key = text.toLowerCase();
  if (key === RESERVED_NAME && RESERVED_SCOPES.includes(scope)) {
    return fail('NAME_RESERVED', 'Other is the name of the system category and cannot be used for another one');
  }

  const rows: readonly Named[] = snapshot[LIST_OF_SCOPE[scope]];
  if (rows.some((row) => row.id !== selfId && row.name.trim().toLowerCase() === key)) {
    return fail('NAME_DUPLICATE', `the name "${text}" is already used in this scope, whatever the case`);
  }
  return { ok: true, value: text as ValidName };
}
