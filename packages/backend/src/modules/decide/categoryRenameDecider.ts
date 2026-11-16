import type { ChangeSet } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Id, Result, ValidName } from '@freshrescue/contract-primitives';
import type { CategoryScope } from '@freshrescue/contract-rules';

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

/**
 * BC-21 CategoryRenameDecider. Builds the ChangeSet that renames one category in place (spec 4.1.2).
 * The name has been through NameValidator, which left the category itself out of the duplicate check,
 * so `milk` to `Milk` is allowed. `scope` says which tree to look in: the food tree or the cuisines.
 *
 * Renaming changes the display label and nothing else: the record keeps its id, its Parent, its
 * threshold and its place, so every Food Type and recipe that points at it stays bound to it (spec
 * exception row 8). The system `Other` of either tree cannot be renamed (SYSTEM_PROTECTED), and an id
 * that is not in the tree is CATEGORY_NOT_FOUND.
 */
export function categoryRenameDecider(
  scope: CategoryScope,
  categoryId: Id,
  name: ValidName,
  snapshot: Snapshot,
): Result<ChangeSet, DomainError> {
  if (scope === 'cuisine') {
    const cuisine = snapshot.recipeCategories.find((candidate) => candidate.id === categoryId);
    if (cuisine === undefined) return fail('CATEGORY_NOT_FOUND', `there is no cuisine with id ${categoryId}`);
    if (cuisine.isSystem) return fail('SYSTEM_PROTECTED', `the system cuisine ${cuisine.name} cannot be renamed`);
    return { ok: true, value: { ops: [{ kind: 'putRecipeCategory', row: { ...cuisine, name } }] } };
  }

  const category = snapshot.foodCategories.find((candidate) => candidate.id === categoryId);
  if (category === undefined) return fail('CATEGORY_NOT_FOUND', `there is no food category with id ${categoryId}`);
  if (category.isSystem) return fail('SYSTEM_PROTECTED', `the system category ${category.name} cannot be renamed`);
  return { ok: true, value: { ops: [{ kind: 'putFoodCategory', row: { ...category, name } }] } };
}
