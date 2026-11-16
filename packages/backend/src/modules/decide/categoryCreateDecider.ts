import type { ChangeSet } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Id, Result, ValidName } from '@freshrescue/contract-primitives';
import type { CategoryScope } from '@freshrescue/contract-rules';

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

/**
 * BC-20 CategoryCreateDecider. Builds the ChangeSet that adds one category: a Parent or a Child of the
 * food tree, or a cuisine (spec 4.1.1). The name has been through NameValidator, which refuses an empty,
 * long, duplicate or reserved name (`Other` included), and the coordinator reserved the id, so this
 * module decides only where the new category may stand:
 *
 * - food tree, no `parentId`: a Parent, which is top-level
 * - food tree, a `parentId`: a Child. The Parent must exist (CATEGORY_NOT_FOUND). It must also be a
 *   top-level category that is not the system `Other`: `Other` is a leaf, and a Child cannot have a
 *   Child, because the tree has two levels (PARENT_INVALID, spec exception row 19)
 * - cuisine: a cuisine has one level, so a `parentId` is never valid for it (PARENT_INVALID)
 *
 * A new category is an ordinary one: not a system category, and with no custom threshold. The counters
 * are bumped by the ChangeSet of IdAllocator, which the coordinator merges in.
 */
export function categoryCreateDecider(
  scope: CategoryScope,
  name: ValidName,
  parentId: Id | null,
  snapshot: Snapshot,
  id: Id,
): Result<ChangeSet, DomainError> {
  if (scope === 'cuisine') {
    if (parentId !== null) return fail('PARENT_INVALID', 'a cuisine has one level, so it cannot have a Parent');
    return { ok: true, value: { ops: [{ kind: 'putRecipeCategory', row: { id, name, isSystem: false } }] } };
  }

  if (parentId !== null) {
    const parent = snapshot.foodCategories.find((category) => category.id === parentId);
    if (parent === undefined) return fail('CATEGORY_NOT_FOUND', `there is no food category with id ${parentId}`);
    if (parent.isSystem) return fail('PARENT_INVALID', `${parent.name} is a leaf, so it cannot have a Child`);
    if (parent.parentId !== null) {
      return fail('PARENT_INVALID', `${parent.name} is a Child, and a Child cannot have a Child: a food category has two levels`);
    }
  }
  return {
    ok: true,
    value: { ops: [{ kind: 'putFoodCategory', row: { id, name, parentId, isSystem: false, customThresholdDays: null } }] },
  };
}
