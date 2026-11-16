import type { ChangeSet, EntityOp } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { Id } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import { SEED_ID_ORDER } from '@freshrescue/contract-seed';
import type { ParsedSeed, SeedIdList } from '@freshrescue/contract-seed';

/**
 * The id written for a reserved id that is missing or a key that names nothing. No record has id 0,
 * so such a plan can never be stored: ChangeSetApplier or SnapshotInvariantChecker refuses it, and the
 * start stops. Neither case happens when the coordinator reserves `idDemand` ids for a parsed seed.
 */
const NO_ID = 0;

/**
 * BC-40 SeedPlanner. Turns a parsed seed and its reserved ids into the pre-load ChangeSet (spec
 * 4.4.E). Pre-loading is the same as a user creating the same records through the screens, so every
 * record is an ordinary one: no flag marks it as built in, no threshold is set and no batch is added.
 *
 * - Ids are consumed in the order of `SEED_ID_ORDER`: every food category, then every cuisine, then
 *   every Food Type, then every recipe, each list in file order. An ingredient row takes no id.
 * - A key is turned into the id it was given. A null key means the system `Other` of that tree, so a
 *   Food Type without a category is in `Other` and a recipe without a cuisine is in `Other`.
 * - Quantities are thousandths in the seed as everywhere, so they are copied as they are.
 * - The settings are put with `bootstrapped = true`, keeping Simulated Today as it is, so the next
 *   start does not seed again.
 *
 * Nothing is validated here. SeedBundleParser has checked the shape and the keys, and the names,
 * units and quantities are judged on the resulting snapshot by SnapshotInvariantChecker, as any change
 * is. The counters are bumped by the ChangeSet of IdAllocator, which reserved the ids.
 */
export function seedPlanner(seed: ParsedSeed, ids: readonly Id[], snapshot: Snapshot): ChangeSet {
  let next = 0;
  const take = (): Id => ids[next++] ?? NO_ID;
  const assigned = new Map<SeedIdList, Map<string, Id>>(SEED_ID_ORDER.map((list) => [list, new Map(seed[list].map((row) => [row.key, take()]))]));
  const idOf = (list: SeedIdList, key: string): Id => assigned.get(list)?.get(key) ?? NO_ID;

  const ops: EntityOp[] = [];
  for (const category of seed.foodCategories) {
    const parentId = category.parentKey === null ? null : idOf('foodCategories', category.parentKey);
    ops.push({
      kind: 'putFoodCategory',
      row: { id: idOf('foodCategories', category.key), name: category.name, parentId, isSystem: false, customThresholdDays: null },
    });
  }
  for (const cuisine of seed.cuisines) {
    ops.push({ kind: 'putRecipeCategory', row: { id: idOf('cuisines', cuisine.key), name: cuisine.name, isSystem: false } });
  }
  for (const foodType of seed.foodTypes) {
    const categoryId = foodType.categoryKey === null ? SYSTEM_IDS.FOOD_OTHER : idOf('foodCategories', foodType.categoryKey);
    ops.push({
      kind: 'putFoodType',
      row: { id: idOf('foodTypes', foodType.key), name: foodType.name, categoryId, unit: foodType.unit, customThresholdDays: null },
    });
  }
  for (const recipe of seed.recipes) {
    const recipeId = idOf('recipes', recipe.key);
    const recipeCategoryId = recipe.cuisineKey === null ? SYSTEM_IDS.CUISINE_OTHER : idOf('cuisines', recipe.cuisineKey);
    ops.push({ kind: 'putRecipe', row: { id: recipeId, name: recipe.name, recipeCategoryId } });
    for (const ingredient of recipe.ingredients) {
      ops.push({
        kind: 'putIngredient',
        row: {
          recipeId,
          foodTypeId: idOf('foodTypes', ingredient.foodTypeKey),
          requiredQuantity: ingredient.quantity,
          requiredUnit: ingredient.unit,
          deletedFoodTypeName: null,
        },
      });
    }
  }
  ops.push({ kind: 'putSettings', row: { simulatedToday: snapshot.settings.simulatedToday, bootstrapped: true } });
  return { ops };
}
