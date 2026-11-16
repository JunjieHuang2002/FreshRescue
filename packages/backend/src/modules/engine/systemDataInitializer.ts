import type { ChangeSet, EntityOp } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';

/** The name of both system categories. Each tree has its own `Other` (spec 1.2). */
const OTHER = 'Other';

/**
 * BC-39 SystemDataInitializer. Builds the ChangeSet that adds the system categories that are missing:
 * the food category `Other`, a top-level leaf with no threshold, and the cuisine `Other`, each with its
 * reserved id from `SYSTEM_IDS` (spec 1.2). They cannot be renamed or deleted, so once they exist the
 * ChangeSet is empty, which makes it safe to run on every bootstrap.
 *
 * A category counts as present when a record of its list has the reserved id. The counters need no
 * change: ids 1 and 2 are below the first id the counter hands out.
 */
export function systemDataInitializer(snapshot: Snapshot): ChangeSet {
  const ops: EntityOp[] = [];
  if (!snapshot.foodCategories.some((category) => category.id === SYSTEM_IDS.FOOD_OTHER)) {
    ops.push({
      kind: 'putFoodCategory',
      row: { id: SYSTEM_IDS.FOOD_OTHER, name: OTHER, parentId: null, isSystem: true, customThresholdDays: null },
    });
  }
  if (!snapshot.recipeCategories.some((cuisine) => cuisine.id === SYSTEM_IDS.CUISINE_OTHER)) {
    ops.push({ kind: 'putRecipeCategory', row: { id: SYSTEM_IDS.CUISINE_OTHER, name: OTHER, isSystem: true } });
  }
  return { ops };
}
