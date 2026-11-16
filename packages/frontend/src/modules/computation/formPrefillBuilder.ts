import { UNIT_LIST } from '@freshrescue/contract-rules';
import type { CategoryNode, ReferenceDataDto } from '@freshrescue/contract-views';
import type { FormKind, FormOption, FormPrefill, OptionLists, UiPayloads } from '@freshrescue/contract-ui';

/**
 * The view data that opens each kind of form (blueprint 1.7: "form kind, view data"): the payload of the
 * event that opens it, which is the record that the form is about (`ev.batch`, `ev.foodType`,
 * `ev.category`, `ev.recipe` of blueprint 4.3). A coordinator hands `ev.payload` over as it is, and the
 * compiler checks that the event and the kind belong together.
 */
export type PrefillData = {
  readonly settingsForm: UiPayloads['settings']['open'];
  /** The button that opens the form names the Food Type, or none; a pick event of the drop-down carries the choice as `value`. */
  readonly batchAdd: UiPayloads['inventory']['addBatch'] | UiPayloads['batch']['pickFoodType'];
  readonly batchQty: UiPayloads['inventory']['editBatchQuantity'];
  readonly batchRemove: UiPayloads['inventory']['removeBatch'];
  readonly foodTypeCreate: UiPayloads['foodType']['newFoodType'];
  readonly foodTypeEdit: UiPayloads['foodType']['editFoodType'];
  readonly unitChange: UiPayloads['unitConversion']['changeUnit'];
  readonly foodTypeDelete: UiPayloads['foodTypeDelete']['deleteFoodType'];
  readonly categoryCreate: UiPayloads['category']['newCategory'];
  readonly categoryRename: UiPayloads['category']['renameCategory'];
  readonly thresholdSet: UiPayloads['threshold']['setThreshold'];
  readonly categoryDelete: UiPayloads['categoryDelete']['deleteCategory'];
  readonly recipeCreate: UiPayloads['recipe']['newRecipe'];
  readonly recipeEdit: UiPayloads['recipe']['editRecipe'];
  readonly recipeDelete: UiPayloads['recipeDelete']['deleteRecipe'];
};

const NEW_FOOD_TYPE = 'New Food Type';
const CHOOSE = (what: string): FormOption => ({ value: '', label: what });

/** A quantity in thousandths as the decimal text of the form: `milli / 1000`, with no formatter shared with any view. */
const decimal = (milli: number): string => String(milli / 1000);

/** The days of a threshold as text, or an empty text when there is none: an empty threshold inherits one. */
const daysText = (days: number | null): string => (days === null ? '' : String(days));

const units = (reference: ReferenceDataDto | null): readonly string[] => reference?.units ?? UNIT_LIST;
const unitOptions = (reference: ReferenceDataDto | null, leave = ''): readonly FormOption[] =>
  units(reference)
    .filter((unit) => unit !== leave)
    .map((unit) => ({ value: unit, label: unit }));

/** The tree as a flat list of choices: a Parent, then its Children as `Parent → Child`. */
function categoryOptions(nodes: readonly CategoryNode[]): readonly FormOption[] {
  return nodes.flatMap((node) => [
    { value: String(node.id), label: node.name },
    ...node.children.map((child) => ({ value: String(child.id), label: `${node.name} → ${child.name}` })),
  ]);
}

/** The id of the system category `Other` of a tree, which is where a Food Type or a recipe goes when none is chosen. */
const otherOf = (nodes: readonly CategoryNode[] | undefined): string => {
  const other = nodes?.find((node) => node.isSystem);
  return other === undefined ? '' : String(other.id);
};

const foodTypeOptions = (reference: ReferenceDataDto | null): readonly FormOption[] =>
  (reference?.foodTypes ?? []).map((foodType) => ({ value: String(foodType.id), label: foodType.name }));

// ---- the forms ------------------------------------------------------------------------------

function settingsForm(_data: PrefillData['settingsForm'], reference: ReferenceDataDto | null): FormPrefill {
  return { values: { date: reference?.simulatedToday ?? '' }, options: {} };
}

// A pick fills only what depends on the choice, so that a quantity already typed survives it. A Food Type
// that is picked leaves the typed name empty, as a typed name leaves no pick.
function batchAdd(data: PrefillData['batchAdd'], reference: ReferenceDataDto | null): FormPrefill {
  const isPick = 'value' in data;
  const chosen = 'value' in data ? data.value : data.foodTypeId === null ? '' : String(data.foodTypeId);
  const picked = reference?.foodTypes.find((foodType) => String(foodType.id) === chosen);
  const dependent = {
    foodTypeId: picked === undefined ? '' : String(picked.id),
    foodName: '',
    categoryId: picked === undefined ? otherOf(reference?.foodCategories) : String(picked.categoryId),
    unit: picked?.unit ?? '',
  };
  return {
    values: isPick ? dependent : { ...dependent, quantity: '', 'expiry.mode': 'days', 'expiry.days': '', 'expiry.date': '' },
    options: {
      foodTypeId: [CHOOSE(NEW_FOOD_TYPE), ...foodTypeOptions(reference)],
      categoryId: categoryOptions(reference?.foodCategories ?? []),
      unit: [CHOOSE('Choose a unit'), ...unitOptions(reference)],
      'expiry.mode': [
        { value: 'days', label: 'Shelf life in days' },
        { value: 'date', label: 'Expiration date' },
      ],
    },
  };
}

function batchQty(data: PrefillData['batchQty']): FormPrefill {
  return {
    values: { batchId: String(data.batch.id), quantity: decimal(data.batch.quantity), name: data.foodType.name, unit: data.foodType.unit },
    options: {},
  };
}

const foodTypeLists = (reference: ReferenceDataDto | null): OptionLists => ({
  categoryId: categoryOptions(reference?.foodCategories ?? []),
  unit: [CHOOSE('Choose a unit'), ...unitOptions(reference)],
});

function foodTypeCreate(_data: PrefillData['foodTypeCreate'], reference: ReferenceDataDto | null): FormPrefill {
  const values = { foodTypeId: '', name: '', categoryId: otherOf(reference?.foodCategories), unit: '', thresholdDays: '' };
  return { values, options: foodTypeLists(reference) };
}

function foodTypeEdit(data: PrefillData['foodTypeEdit'], reference: ReferenceDataDto | null): FormPrefill {
  const { foodType } = data;
  const values = {
    foodTypeId: String(foodType.foodTypeId),
    name: foodType.name,
    categoryId: String(foodType.categoryId),
    unit: foodType.unit,
    thresholdDays: daysText(foodType.customThresholdDays),
  };
  return { values, options: foodTypeLists(reference) };
}

// The new unit is chosen from the other five, because the current unit cannot be changed to itself, and
// each batch gets an empty field for its quantity in that unit, with a label that says what it holds now.
function unitChange(data: PrefillData['unitChange'], reference: ReferenceDataDto | null): FormPrefill {
  const { foodType } = data;
  const values: Record<string, string> = { foodTypeId: String(foodType.foodTypeId), name: foodType.name, fromUnit: foodType.unit, unit: '' };
  for (const [index, batch] of foodType.batches.entries()) {
    values[`batches.${index}.batchId`] = String(batch.id);
    values[`batches.${index}.quantity`] = '';
    values[`batches.${index}.label`] = `${decimal(batch.quantity)} ${foodType.unit}, expires ${batch.expirationDate}`;
  }
  return { values, options: { unit: [CHOOSE('Choose the new unit'), ...unitOptions(reference, foodType.unit)] } };
}

function categoryCreate(data: PrefillData['categoryCreate']): FormPrefill {
  const parentId = data.parent === null ? '' : String(data.parent.id);
  return { values: { scope: data.scope, categoryId: '', parentId, name: '' }, options: {} };
}

function categoryRename(data: PrefillData['categoryRename']): FormPrefill {
  return { values: { scope: data.scope, categoryId: String(data.category.id), parentId: '', name: data.category.name }, options: {} };
}

function thresholdSet(data: PrefillData['thresholdSet']): FormPrefill {
  const { category } = data;
  return { values: { categoryId: String(category.id), thresholdDays: daysText(category.customThresholdDays), name: category.name }, options: {} };
}

// The rows of a recipe have their own drop-downs, and `draft.rows.unitOf` holds the unit of each Food
// Type (value = its id, label = its unit), which FormSlice uses to default the unit of a row.
function recipeOptions(reference: ReferenceDataDto | null): OptionLists {
  return {
    'draft.cuisineId': categoryOptions(reference?.cuisines ?? []),
    'draft.rows.foodTypeId': [CHOOSE('Choose a Food Type'), ...foodTypeOptions(reference)],
    'draft.rows.unit': [CHOOSE('Choose a unit'), ...unitOptions(reference)],
    'draft.rows.unitOf': (reference?.foodTypes ?? []).map((foodType) => ({ value: String(foodType.id), label: foodType.unit })),
  };
}

const BLANK_ROW = { 'draft.rows.0.foodTypeId': '', 'draft.rows.0.quantity': '', 'draft.rows.0.unit': '' } as const;

function recipeCreate(_data: PrefillData['recipeCreate'], reference: ReferenceDataDto | null): FormPrefill {
  const values = { recipeId: '', name: '', 'draft.cuisineId': otherOf(reference?.cuisines), ...BLANK_ROW };
  return { values, options: recipeOptions(reference) };
}

// A row whose Food Type was deleted comes back with an empty Food Type, so the person picks another one
// (blueprint 3.3, saveRecipe); its quantity and unit stay as they were. A recipe has at least one
// ingredient, so a recipe that has none starts with one row to fill in.
function recipeEdit(data: PrefillData['recipeEdit'], reference: ReferenceDataDto | null): FormPrefill {
  const { recipe } = data;
  const values: Record<string, string> = { recipeId: String(recipe.recipeId), name: recipe.name, 'draft.cuisineId': String(recipe.cuisineId) };
  if (recipe.ingredients.length === 0) Object.assign(values, BLANK_ROW);
  for (const [index, line] of recipe.ingredients.entries()) {
    values[`draft.rows.${index}.foodTypeId`] = line.state === 'missingFoodType' ? '' : String(line.foodTypeId);
    values[`draft.rows.${index}.quantity`] = decimal(line.requiredQuantity);
    values[`draft.rows.${index}.unit`] = line.requiredUnit;
  }
  return { values, options: recipeOptions(reference) };
}

// A confirmation has nothing to type into. Its values are the `id` of the record (and the `scope` of a
// category), which the form parser reads, and the words of the dialog: `title`, `confirmLabel` and the
// numbered `lines.<n>`, which ConfirmDialogView reads to draw the dialog.
const confirmation = (values: Record<string, string>, title: string, confirmLabel: string, lines: readonly string[]): FormPrefill => ({
  values: {
    ...values,
    title,
    confirmLabel,
    ...Object.fromEntries(lines.filter((line) => line !== '').map((line, index) => [`lines.${index}`, line])),
  },
  options: {},
});

function batchRemove(data: PrefillData['batchRemove']): FormPrefill {
  return confirmation({ id: String(data.batch.id) }, 'Remove this batch?', 'Remove batch', [data.summary]);
}

function foodTypeDelete(data: PrefillData['foodTypeDelete']): FormPrefill {
  const { foodType } = data;
  const recipes = foodType.referencingRecipes.map((recipe) => recipe.name);
  const line = recipes.length === 0 ? 'No recipe uses this Food Type.' : `These recipes will become blocked: ${recipes.join(', ')}.`;
  return confirmation({ id: String(foodType.foodTypeId) }, `Delete ${foodType.name}?`, 'Delete Food Type', [line]);
}

function categoryDelete(data: PrefillData['categoryDelete']): FormPrefill {
  const line =
    data.scope === 'cuisine'
      ? 'Its recipes move to Other.'
      : 'Its Food Types, and those of its child categories, move to Other. Its thresholds are deleted.';
  return confirmation({ id: String(data.category.id), scope: data.scope }, `Delete ${data.category.name}?`, 'Delete category', [line]);
}

function recipeDelete(data: PrefillData['recipeDelete']): FormPrefill {
  const { recipe } = data;
  return confirmation({ id: String(recipe.recipeId) }, `Delete ${recipe.name}?`, 'Delete recipe', ['The recipe is also removed from the cook queue.']);
}

const BUILDERS: { readonly [K in FormKind]: (data: PrefillData[K], reference: ReferenceDataDto | null) => FormPrefill } = {
  settingsForm,
  batchAdd,
  batchQty,
  batchRemove,
  foodTypeCreate,
  foodTypeEdit,
  unitChange,
  foodTypeDelete,
  categoryCreate,
  categoryRename,
  thresholdSet,
  categoryDelete,
  recipeCreate,
  recipeEdit,
  recipeDelete,
};

/**
 * FC-02 FormPrefillBuilder. Builds the initial texts of a form and the entries of its drop-downs from
 * the view data that opened it and the reference data (blueprint 1.7). Every text is a string, as a
 * form holds text: a quantity is `milli / 1000`, an empty field is `''`, and a category or cuisine
 * that is not chosen is the system category `Other`.
 *
 * `data` is the payload of the event that opens the form, and its type follows `kind` (`PrefillData`):
 *
 * - `settingsForm` starts at the current Simulated Today, or empty.
 * - `batchAdd` takes the Food Type of the button that opened it, or the choice of a pick event. A Food
 *   Type fills its unit and category (shown read-only) and leaves the typed name empty. Neither fills a
 *   new Food Type: the person types a name and chooses a category and a unit. A pick returns only the
 *   fields that depend on the choice.
 * - `batchQty` takes the batch and its Food Type, `foodTypeEdit` and `unitChange` the Food Type with its
 *   batches (the new unit starts empty), `categoryCreate` the scope and the Parent (none for a new Parent
 *   or cuisine), `categoryRename` and `thresholdSet` the category, and `recipeEdit` the recipe as the
 *   catalog shows it. `foodTypeCreate` and `recipeCreate` take nothing, and a new recipe starts with one
 *   empty row.
 * - The four confirmations take what their dialog names: the batch with the line that describes it, the
 *   Food Type with the recipes that it would block, the category with its scope, the recipe.
 */
export function formPrefillBuilder<K extends FormKind>(kind: K, data: PrefillData[K], reference: ReferenceDataDto | null): FormPrefill {
  return BUILDERS[kind](data, reference);
}
