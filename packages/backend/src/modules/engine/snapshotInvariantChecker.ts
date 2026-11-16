import type { FoodCategory, FoodType, Recipe, RecipeCategory, RecipeIngredient, Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Id, Named, Result } from '@freshrescue/contract-primitives';
import { FIRST_FREE_ID, LIMITS, SYSTEM_IDS, UNIT_LIST } from '@freshrescue/contract-rules';

/** The snapshot, with its records found by id: what every rule looks things up in. */
type Records = {
  readonly snapshot: Snapshot;
  readonly foodCategories: ReadonlyMap<Id, FoodCategory>;
  readonly foodTypes: ReadonlyMap<Id, FoodType>;
  readonly recipeCategories: ReadonlyMap<Id, RecipeCategory>;
  readonly recipes: ReadonlyMap<Id, Recipe>;
};

/** One stored-state invariant: the key that names it in the error, the rule in words, and what breaks it. */
type Rule = {
  readonly key: string;
  readonly text: string;
  /** One line for each fault found; none when the rule holds. */
  readonly offenders: (records: Records) => readonly string[];
};

const OTHER = 'Other';
/** How many faults of one rule the error spells out before it only counts the rest. */
const SHOWN = 3;

const isWhole = (value: number, minimum: number): boolean => Number.isSafeInteger(value) && value >= minimum;
const isQuantity = (value: number): boolean => isWhole(value, LIMITS.QTY_MIN_MILLI) && value <= LIMITS.QTY_MAX_MILLI;
const isThreshold = (value: number | null): boolean => value === null || isWhole(value, LIMITS.THRESHOLD_MIN_DAYS);
const isUnit = (value: string): boolean => (UNIT_LIST as readonly string[]).includes(value);
const rowLabel = (row: RecipeIngredient): string => `the row of recipe ${row.recipeId} for Food Type ${row.foodTypeId}`;

// A real calendar date written YYYY-MM-DD, by the rule of the command parser. Each module that needs a
// date keeps its own copy of these few lines: a module imports no other module.
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isCalendarDate(text: string): boolean {
  const match = DATE_TEXT.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const length = month === 2 && isLeap ? 29 : (MONTH_LENGTHS[month - 1] ?? 0);
  return day >= 1 && day <= length;
}

/** What a stored name breaks of the name rule, or null. Characters are code points, as NameValidator and MySQL count them. */
function nameFault(name: string): string | null {
  if (name !== name.trim()) return 'is not trimmed';
  const length = Array.from(name).length;
  return length < LIMITS.NAME_MIN_LENGTH || length > LIMITS.NAME_MAX_LENGTH ? `has ${length} characters` : null;
}

/** Every record that has an id, with its kind. An ingredient row has none: it is named by its recipe and its Food Type. */
function idsOf(snapshot: Snapshot): (readonly [string, Id])[] {
  const kindOf = (kind: string) => (record: { readonly id: Id }): readonly [string, Id] => [kind, record.id];
  return [
    ...snapshot.foodCategories.map(kindOf('food category')),
    ...snapshot.recipeCategories.map(kindOf('cuisine')),
    ...snapshot.foodTypes.map(kindOf('Food Type')),
    ...snapshot.batches.map(kindOf('batch')),
    ...snapshot.recipes.map(kindOf('recipe')),
  ];
}

/** The names that two or more records of one scope share, compared trimmed and without case, as NameValidator compares them. */
function sharedNames(kind: string, rows: readonly Named[]): string[] {
  const idsOfName = new Map<string, Id[]>();
  for (const row of rows) {
    const key = row.name.trim().toLowerCase();
    const ids = idsOfName.get(key);
    if (ids === undefined) idsOfName.set(key, [row.id]);
    else ids.push(row.id);
  }
  return [...idsOfName].filter(([, ids]) => ids.length > 1).map(([key, ids]) => `the ${kind} ${ids.join(', ')} share the name "${key}"`);
}

function systemFault(kind: string, category: { readonly isSystem: boolean; readonly name: string } | undefined, id: Id): string[] {
  if (category === undefined) return [`the ${kind} Other (id ${id}) is missing`];
  return category.isSystem && category.name === OTHER ? [] : [`${kind} ${id} is not the system category Other`];
}

/** The rules, in the order the error lists them. Each can be broken without breaking another. */
const RULES: readonly Rule[] = [
  // ---- ids and counters (plan, phase 2: one counter serves every record, and ids are never reused)
  {
    key: 'positiveIds',
    text: 'an id is a whole number of at least 1',
    offenders: ({ snapshot }) => idsOf(snapshot).filter(([, id]) => !isWhole(id, 1)).map(([kind, id]) => `${kind} ${id}`),
  },
  {
    key: 'uniqueIds',
    text: 'an id names one record in the whole system',
    offenders: ({ snapshot }) => {
      const kindsOf = new Map<Id, string[]>();
      for (const [kind, id] of idsOf(snapshot)) {
        const kinds = kindsOf.get(id);
        if (kinds === undefined) kindsOf.set(id, [kind]);
        else kinds.push(kind);
      }
      return [...kindsOf].filter(([, kinds]) => kinds.length > 1).map(([id, kinds]) => `id ${id} names a ${kinds.join(' and a ')}`);
    },
  },
  {
    key: 'counters',
    text: 'the counters are past every id and every createdSeq in use',
    offenders: ({ snapshot }) => {
      const { nextId, nextSeq } = snapshot.counters;
      // ids 1 and 2 are reserved, so the counter is past them even before they exist
      const topId = idsOf(snapshot).reduce((top, [, id]) => (Number.isSafeInteger(id) ? Math.max(top, id) : top), FIRST_FREE_ID - 1);
      const topSeq = snapshot.batches.reduce((top, batch) => (Number.isSafeInteger(batch.createdSeq) ? Math.max(top, batch.createdSeq) : top), 0);
      return [
        ...(isWhole(nextId, topId + 1) ? [] : [`nextId is ${nextId}, and it must be above ${topId}`]),
        ...(isWhole(nextSeq, topSeq + 1) ? [] : [`nextSeq is ${nextSeq}, and it must be above ${topSeq}`]),
      ];
    },
  },

  // ---- the categories (spec 1.2, section 3 and 4.1)
  {
    key: 'systemCategories',
    text: 'the two system categories Other exist with their reserved ids, and no other category is a system one',
    offenders: ({ snapshot, foodCategories, recipeCategories }) => [
      ...systemFault('food category', foodCategories.get(SYSTEM_IDS.FOOD_OTHER), SYSTEM_IDS.FOOD_OTHER),
      ...systemFault('cuisine', recipeCategories.get(SYSTEM_IDS.CUISINE_OTHER), SYSTEM_IDS.CUISINE_OTHER),
      ...snapshot.foodCategories
        .filter((category) => category.isSystem && category.id !== SYSTEM_IDS.FOOD_OTHER)
        .map((category) => `food category ${category.id} is marked as a system category`),
      ...snapshot.recipeCategories
        .filter((cuisine) => cuisine.isSystem && cuisine.id !== SYSTEM_IDS.CUISINE_OTHER)
        .map((cuisine) => `cuisine ${cuisine.id} is marked as a system category`),
    ],
  },
  {
    key: 'otherIsLeaf',
    text: 'the food category Other is a top-level leaf without a custom threshold',
    offenders: ({ snapshot, foodCategories }) => {
      const other = foodCategories.get(SYSTEM_IDS.FOOD_OTHER);
      if (other === undefined) return [];
      return [
        ...(other.parentId === null ? [] : [`Other is under food category ${other.parentId}`]),
        ...(other.customThresholdDays === null ? [] : [`Other has a threshold of ${other.customThresholdDays} days`]),
        ...snapshot.foodCategories.filter((category) => category.parentId === other.id).map((category) => `food category ${category.id} is a Child of Other`),
      ];
    },
  },
  {
    key: 'parentExists',
    text: 'a Child names an existing food category as its Parent',
    offenders: ({ snapshot, foodCategories }) =>
      snapshot.foodCategories
        .filter((category) => category.parentId !== null && !foodCategories.has(category.parentId))
        .map((category) => `food category ${category.id} names the parent ${category.parentId}`),
  },
  {
    key: 'twoLevels',
    text: 'a food category has two levels at most, so a Parent is top-level',
    offenders: ({ snapshot, foodCategories }) =>
      snapshot.foodCategories
        .filter((category) => category.parentId !== null && (foodCategories.get(category.parentId)?.parentId ?? null) !== null)
        .map((category) => `food category ${category.id} is under ${category.parentId}, which is a Child itself`),
  },

  // ---- names and thresholds (spec section 3)
  {
    key: 'names',
    text: `a name is trimmed and has ${LIMITS.NAME_MIN_LENGTH} to ${LIMITS.NAME_MAX_LENGTH} characters`,
    offenders: ({ snapshot }) => {
      const labelled = (label: string, name: string): readonly [string, string] => [label, name];
      const names = [
        ...snapshot.foodCategories.map((category) => labelled(`food category ${category.id}`, category.name)),
        ...snapshot.recipeCategories.map((cuisine) => labelled(`cuisine ${cuisine.id}`, cuisine.name)),
        ...snapshot.foodTypes.map((foodType) => labelled(`Food Type ${foodType.id}`, foodType.name)),
        ...snapshot.recipes.map((recipe) => labelled(`recipe ${recipe.id}`, recipe.name)),
        ...snapshot.recipeIngredients.flatMap((row) =>
          row.deletedFoodTypeName === null ? [] : [labelled(`the deleted name on ${rowLabel(row)}`, row.deletedFoodTypeName)],
        ),
      ];
      return names.flatMap(([label, name]) => {
        const fault = nameFault(name);
        return fault === null ? [] : [`${label} ${fault}`];
      });
    },
  },
  {
    key: 'uniqueNames',
    text: 'a name is unique in its scope, whatever the case',
    offenders: ({ snapshot }) => [
      ...sharedNames('Food Types', snapshot.foodTypes),
      ...sharedNames('recipes', snapshot.recipes),
      // one scope for both levels, so a Parent and a Child cannot share a name, and `Other` is taken
      ...sharedNames('food categories', snapshot.foodCategories),
      ...sharedNames('cuisines', snapshot.recipeCategories),
    ],
  },
  {
    key: 'thresholds',
    text: `a custom threshold is a whole number of days, at least ${LIMITS.THRESHOLD_MIN_DAYS}`,
    offenders: ({ snapshot }) => [
      ...snapshot.foodCategories
        .filter((category) => !isThreshold(category.customThresholdDays))
        .map((category) => `food category ${category.id} has ${category.customThresholdDays}`),
      ...snapshot.foodTypes
        .filter((foodType) => !isThreshold(foodType.customThresholdDays))
        .map((foodType) => `Food Type ${foodType.id} has ${foodType.customThresholdDays}`),
    ],
  },

  // ---- Food Types and batches (spec section 3 and 4.2)
  {
    key: 'foodTypeCategory',
    text: 'a Food Type belongs to an existing food category',
    offenders: ({ snapshot, foodCategories }) =>
      snapshot.foodTypes
        .filter((foodType) => !foodCategories.has(foodType.categoryId))
        .map((foodType) => `Food Type ${foodType.id} names the category ${foodType.categoryId}`),
  },
  {
    key: 'units',
    text: `a unit is one of ${UNIT_LIST.join(', ')}`,
    offenders: ({ snapshot }) => [
      ...snapshot.foodTypes.filter((foodType) => !isUnit(foodType.unit)).map((foodType) => `Food Type ${foodType.id} is in "${foodType.unit}"`),
      ...snapshot.recipeIngredients.filter((row) => !isUnit(row.requiredUnit)).map((row) => `${rowLabel(row)} requires "${row.requiredUnit}"`),
    ],
  },
  {
    key: 'batchFoodType',
    text: 'a batch belongs to an existing Food Type',
    offenders: ({ snapshot, foodTypes }) =>
      snapshot.batches.filter((batch) => !foodTypes.has(batch.foodTypeId)).map((batch) => `batch ${batch.id} names the Food Type ${batch.foodTypeId}`),
  },
  {
    key: 'quantities',
    text: `a quantity is a whole number of thousandths from ${LIMITS.QTY_MIN_MILLI} to ${LIMITS.QTY_MAX_MILLI}, which is 0.001 to ${LIMITS.QTY_MAX_MILLI / 1000}`,
    offenders: ({ snapshot }) => [
      ...snapshot.batches.filter((batch) => !isQuantity(batch.quantity)).map((batch) => `batch ${batch.id} holds ${batch.quantity}`),
      ...snapshot.recipeIngredients.filter((row) => !isQuantity(row.requiredQuantity)).map((row) => `${rowLabel(row)} requires ${row.requiredQuantity}`),
    ],
  },
  {
    key: 'dates',
    text: 'a date is a real calendar date written YYYY-MM-DD',
    offenders: ({ snapshot }) => {
      const found: string[] = [];
      for (const batch of snapshot.batches) {
        if (!isCalendarDate(batch.inboundDate)) found.push(`batch ${batch.id} came in on "${batch.inboundDate}"`);
        if (!isCalendarDate(batch.expirationDate)) found.push(`batch ${batch.id} expires on "${batch.expirationDate}"`);
      }
      const { simulatedToday } = snapshot.settings;
      if (simulatedToday !== null && !isCalendarDate(simulatedToday)) found.push(`Simulated Today is "${simulatedToday}"`);
      return found;
    },
  },
  {
    key: 'expiryAfterInbound',
    text: 'a batch expires on or after the day it came in',
    // D_exp = D_in + S with S >= 0. A date that is not a real one is the business of the rule above.
    offenders: ({ snapshot }) =>
      snapshot.batches
        .filter((batch) => isCalendarDate(batch.inboundDate) && isCalendarDate(batch.expirationDate) && batch.expirationDate < batch.inboundDate)
        .map((batch) => `batch ${batch.id} came in on ${batch.inboundDate} and expires on ${batch.expirationDate}`),
  },
  {
    key: 'createdSeq',
    text: 'a batch has a createdSeq of at least 1 that no other batch has',
    offenders: ({ snapshot }) => {
      const seen = new Set<number>();
      const found: string[] = [];
      for (const batch of snapshot.batches) {
        if (!isWhole(batch.createdSeq, 1)) found.push(`batch ${batch.id} has createdSeq ${batch.createdSeq}`);
        else if (seen.has(batch.createdSeq)) found.push(`batch ${batch.id} repeats createdSeq ${batch.createdSeq}`);
        seen.add(batch.createdSeq);
      }
      return found;
    },
  },
  {
    key: 'cap',
    text: `the batches of a Food Type total at most ${LIMITS.CAP_MILLI / 1000}, Expired ones included`,
    offenders: ({ snapshot }) => {
      const totals = new Map<Id, number>();
      for (const batch of snapshot.batches) totals.set(batch.foodTypeId, (totals.get(batch.foodTypeId) ?? 0) + batch.quantity);
      return [...totals].filter(([, total]) => total > LIMITS.CAP_MILLI).map(([foodTypeId, total]) => `Food Type ${foodTypeId} totals ${total / 1000}`);
    },
  },

  // ---- recipes and their rows (spec section 3, 4.2.4 and 4.4)
  {
    key: 'recipeCuisine',
    text: 'a recipe belongs to an existing cuisine',
    offenders: ({ snapshot, recipeCategories }) =>
      snapshot.recipes
        .filter((recipe) => !recipeCategories.has(recipe.recipeCategoryId))
        .map((recipe) => `recipe ${recipe.id} names the cuisine ${recipe.recipeCategoryId}`),
  },
  {
    key: 'recipeHasRows',
    text: 'a recipe has at least one ingredient row',
    offenders: ({ snapshot }) => {
      const withRows = new Set(snapshot.recipeIngredients.map((row) => row.recipeId));
      return snapshot.recipes.filter((recipe) => !withRows.has(recipe.id)).map((recipe) => `recipe ${recipe.id} has none`);
    },
  },
  {
    key: 'rowRecipe',
    text: 'an ingredient row belongs to an existing recipe',
    offenders: ({ snapshot, recipes }) => snapshot.recipeIngredients.filter((row) => !recipes.has(row.recipeId)).map((row) => rowLabel(row)),
  },
  {
    key: 'rowOnce',
    text: 'a recipe has at most one row for each Food Type',
    offenders: ({ snapshot }) => {
      const seen = new Set<string>();
      const found: string[] = [];
      for (const row of snapshot.recipeIngredients) {
        const pair = `${row.recipeId}/${row.foodTypeId}`;
        if (seen.has(pair)) found.push(`${rowLabel(row)} is repeated`);
        seen.add(pair);
      }
      return found;
    },
  },
  {
    key: 'rowFoodType',
    text: 'an ingredient row names a live Food Type or keeps the name of the deleted one, and never both',
    offenders: ({ snapshot, foodTypes }) =>
      snapshot.recipeIngredients.flatMap((row) => {
        const live = foodTypes.has(row.foodTypeId);
        if (live && row.deletedFoodTypeName !== null) return [`${rowLabel(row)} keeps a deleted name, and the Food Type exists`];
        if (!live && row.deletedFoodTypeName === null) return [`${rowLabel(row)} names no Food Type and keeps no deleted name`];
        return [];
      }),
  },
];

const shown = (found: readonly string[]): string =>
  found.length <= SHOWN ? found.join(', ') : `${found.slice(0, SHOWN).join(', ')} and ${found.length - SHOWN} more`;

/**
 * BC-41 SnapshotInvariantChecker. Verifies a snapshot against every stored-state invariant of the
 * specification. It is the gate of the one write path: every ChangeSet is applied to a copy, the copy
 * is checked here, and only a copy that passes is written (blueprint 2.3). The answer is the same
 * snapshot, unchanged, or INVARIANT_BROKEN.
 *
 * The rules are those that any stored state must keep, whatever the request that led to it:
 *
 * - ids and counters: an id is a positive whole number that names one record in the whole system, and
 *   the counters are past every id and `createdSeq` in use, so nothing is ever reused
 * - categories: both system categories `Other` exist with their reserved ids, the food `Other` is a
 *   top-level leaf with no threshold, a Child's Parent exists, and the tree has two levels at most
 * - names: trimmed, 1 to 200 characters, and unique in their scope whatever the case
 * - thresholds: whole days of at least 1
 * - Food Types and batches: a Food Type's category exists and its unit is one of the six; a batch's
 *   Food Type exists, its quantity is 0.001 to 500,000 in whole thousandths, its dates are real
 *   calendar dates and it expires on or after the day it came in, its `createdSeq` is its own, and the
 *   batches of a Food Type total at most 500,000, Expired ones included
 * - recipes: a recipe's cuisine exists and it has at least one row; a row belongs to an existing
 *   recipe, has a valid quantity and unit, appears once per Food Type, and names a live Food Type or
 *   keeps the name of the deleted one
 *
 * A Required Unit that differs from its Food Type's unit is not a broken invariant: it is a Unit
 * Conflict, which the spec allows and which blocks the recipe (spec 4.4.A). Every rule is checked, and
 * the error lists every one that is broken, each by its key in brackets with the faults it found.
 */
export function snapshotInvariantChecker(snapshot: Snapshot): Result<Snapshot, DomainError> {
  const records: Records = {
    snapshot,
    foodCategories: new Map(snapshot.foodCategories.map((category): [Id, FoodCategory] => [category.id, category])),
    foodTypes: new Map(snapshot.foodTypes.map((foodType): [Id, FoodType] => [foodType.id, foodType])),
    recipeCategories: new Map(snapshot.recipeCategories.map((cuisine): [Id, RecipeCategory] => [cuisine.id, cuisine])),
    recipes: new Map(snapshot.recipes.map((recipe): [Id, Recipe] => [recipe.id, recipe])),
  };
  const broken = RULES.flatMap((rule) => {
    const found = rule.offenders(records);
    return found.length === 0 ? [] : [{ rule, found }];
  });
  if (broken.length === 0) return { ok: true, value: snapshot };

  const listed = broken.map(({ rule, found }) => `[${rule.key}] ${rule.text}: ${shown(found)}`).join('; ');
  return { ok: false, err: { code: 'INVARIANT_BROKEN', detail: `${broken.length} of ${RULES.length} rules broken. ${listed}` } };
}
