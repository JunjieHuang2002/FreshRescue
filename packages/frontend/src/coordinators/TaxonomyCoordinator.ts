import type { Command } from '@freshrescue/contract-messages';
import type { Id, Result } from '@freshrescue/contract-primitives';
import type { CategoryScope } from '@freshrescue/contract-rules';
import { FORM_SCHEMAS, UI_ROUTES } from '@freshrescue/contract-ui';
import type { Ctx, FieldError, FormAction, FormEntry, FormKind, FormState, Intent, UiEvent, UiNamespace } from '@freshrescue/contract-ui';
import { errorNoticeMapper } from '../modules/computation/errorNoticeMapper';
import { formPrefillBuilder } from '../modules/computation/formPrefillBuilder';
import type { PrefillData } from '../modules/computation/formPrefillBuilder';
import { formSchemaParser } from '../modules/parsing/formSchemaParser';
import type { Target } from '../modules/parsing/formSchemaParser';
import { formSlice } from '../modules/slices/formSlice';
import { categoryManagerView } from '../modules/views/categoryManagerView';
import { confirmDialogView } from '../modules/views/confirmDialogView';
import { foodTypeFormView } from '../modules/views/foodTypeFormView';
import { unitConversionModalView } from '../modules/views/unitConversionModalView';

/** The events of the namespaces that the route table gives to this coordinator: the six forms of the Food Types and the categories. */
type Owned = Extract<UiEvent, { readonly ns: { [N in UiNamespace]: (typeof UI_ROUTES)[N] extends 'Taxonomy' ? N : never }[UiNamespace] }>;

const owns = (event: UiEvent): event is Owned => UI_ROUTES[event.ns] === 'Taxonomy';

/** The slices of this coordinator (blueprint 2.5): six forms, each under its namespace. */
type State = {
  foodType: FormState;
  unitConversion: FormState;
  foodTypeDelete: FormState;
  category: FormState;
  threshold: FormState;
  categoryDelete: FormState;
};

type FormKey = keyof State;

const CLOSED: FormState = { value: 'closed', context: { kind: null, values: {}, options: {}, hints: {}, returnTo: 'editing' } };
const DATA_CHANGED: Intent = { kind: 'dataChanged' };

/** `draw(k)` of blueprint 4.1: mounts every view that shows slice k. The category manager shows two forms, and its trees come from `ctx.reference()`. */
const DRAW: { readonly [K in FormKey]: (st: State, ctx: Ctx) => void } = {
  foodType: (st, ctx) => ctx.mount('foodTypeForm', foodTypeFormView(st.foodType)),
  unitConversion: (st, ctx) => ctx.mount('unitConversion', unitConversionModalView(st.unitConversion)),
  foodTypeDelete: (st, ctx) => ctx.mount('confirm', confirmDialogView(st.foodTypeDelete)),
  category: (st, ctx) => ctx.mount('categories', categoryManagerView(st.category, st.threshold, ctx.reference())),
  threshold: (st, ctx) => DRAW.category(st, ctx),
  categoryDelete: (st, ctx) => ctx.mount('confirm', confirmDialogView(st.categoryDelete)),
};

// ---- the templates of blueprint 4.1, expanded for this coordinator --------------------------

/** OPEN: the prefill of the form from the data of the event that opens it. */
function open<K extends FormKind>(st: State, key: FormKey, kind: K, data: PrefillData[K], at: FormEntry, ctx: Ctx): readonly Intent[] {
  const prefill = formPrefillBuilder(kind, data, ctx.reference());
  st[key] = formSlice(st[key], { type: 'open', kind, prefill, at });
  DRAW[key](st, ctx);
  return [];
}

/** INPUT: an edit or a cancel. */
function input(st: State, key: FormKey, action: FormAction, ctx: Ctx): readonly Intent[] {
  st[key] = formSlice(st[key], action);
  DRAW[key](st, ctx);
  return [];
}

/**
 * SUBMIT: `parsed` is what FormSchemaParser read from the form, and `message` builds the command from it.
 * A form that cannot be read sends nothing and shows its hints. A form that the slice does not let go
 * to `submitting` (it is closed, or its request is already on its way) sends nothing either.
 */
async function submit<P>(st: State, key: FormKey, parsed: Result<P, readonly FieldError[]>, message: (payload: P) => Command, ctx: Ctx): Promise<readonly Intent[]> {
  if (!parsed.ok) {
    st[key] = formSlice(st[key], { type: 'rejected', hints: errorNoticeMapper(parsed.err, null).fieldHints });
    DRAW[key](st, ctx);
    return [];
  }
  const sending = formSlice(st[key], { type: 'submitting' });
  if (sending === st[key]) return [];
  st[key] = sending;
  DRAW[key](st, ctx);
  const command = message(parsed.value);
  const reply = await ctx.callApi(command);
  if (!reply.ok) {
    const notice = errorNoticeMapper(reply.err, { message: command.type });
    st[key] = formSlice(st[key], { type: 'rejected', hints: notice.fieldHints });
    DRAW[key](st, ctx);
    return [{ kind: 'notify', notice }];
  }
  st[key] = formSlice(st[key], { type: 'closed' });
  DRAW[key](st, ctx);
  return [DATA_CHANGED];
}

// ---- the six workflows, their submit steps (their open, edit and cancel steps are in `handle`) -------

/** saveFoodType: SaveFoodType, which creates a Food Type when the form has no id and edits it when it has one. */
function saveFoodType(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  const parsed = formSchemaParser(FORM_SCHEMAS.foodType, st.foodType.context.values);
  return submit(st, 'foodType', parsed, (payload) => ({ type: 'SaveFoodType', payload }), ctx);
}

/** changeUnit: ChangeFoodTypeUnit with the new unit and a quantity for every batch. */
function changeUnit(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  const parsed = formSchemaParser(FORM_SCHEMAS.unitChange, st.unitConversion.context.values);
  return submit(st, 'unitConversion', parsed, (payload) => ({ type: 'ChangeFoodTypeUnit', payload }), ctx);
}

/** deleteFoodType: DeleteFoodType. The deleted Food Type's detail is closed when it worked. */
async function deleteFoodType(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  const target = formSchemaParser(FORM_SCHEMAS.target, st.foodTypeDelete.context.values);
  const intents = await submit(st, 'foodTypeDelete', target, (found) => ({ type: 'DeleteFoodType', payload: { foodTypeId: found.id } }), ctx);
  return intents.some((intent) => intent.kind === 'dataChanged') ? [{ kind: 'navigate', tab: 'inventory', detail: null }, ...intents] : intents;
}

/** saveCategory: SaveCategory, which creates a Parent, a Child or a cuisine, or renames a category in place. */
function saveCategory(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  const parsed = formSchemaParser(FORM_SCHEMAS.category, st.category.context.values);
  return submit(st, 'category', parsed, (payload) => ({ type: 'SaveCategory', payload }), ctx);
}

/**
 * A category is deleted from its tree, so DeleteCategory needs the scope that the confirmation holds. The
 * confirmation schema reads the scope as optional, because three of the four deletions have none, so a
 * confirmation without it is a form whose `scope` is not filled in: nothing is sent.
 */
function scoped(target: Result<Target, readonly FieldError[]>): Result<{ readonly id: Id; readonly scope: CategoryScope }, readonly FieldError[]> {
  if (!target.ok) return target;
  const { id, scope } = target.value;
  return scope === null ? { ok: false, err: [{ field: 'scope', code: 'FIELD_REQUIRED' }] } : { ok: true, value: { id, scope } };
}

/** deleteCategory: DeleteCategory for the category and the tree that the confirmation names. */
function deleteCategory(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  const target = scoped(formSchemaParser(FORM_SCHEMAS.target, st.categoryDelete.context.values));
  return submit(st, 'categoryDelete', target, (found) => ({ type: 'DeleteCategory', payload: { scope: found.scope, categoryId: found.id } }), ctx);
}

/** setThreshold: SetCategoryThreshold, where an empty field clears the threshold. */
function setThreshold(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  const parsed = formSchemaParser(FORM_SCHEMAS.threshold, st.threshold.context.values);
  return submit(st, 'threshold', parsed, (payload) => ({ type: 'SetCategoryThreshold', payload }), ctx);
}

/** The submit of each of the six forms. */
const SUBMIT: { readonly [K in FormKey]: (st: State, ctx: Ctx) => Promise<readonly Intent[]> } = {
  foodType: saveFoodType,
  unitConversion: changeUnit,
  foodTypeDelete: deleteFoodType,
  category: saveCategory,
  threshold: setThreshold,
  categoryDelete: deleteCategory,
};

/** `redraw(ctx)` of blueprint 4.3: a hook for the Categories tab, not a workflow. It remounts the category view from the new reference data; no request, no state change. */
function redraw(st: State, ctx: Ctx): readonly Intent[] {
  DRAW.category(st, ctx);
  return [];
}

/** `handle(ev, ctx)` of blueprint 4.3: the events of the six forms. Any other event is not this coordinator's and changes nothing. */
async function handle(st: State, event: UiEvent, ctx: Ctx): Promise<readonly Intent[]> {
  if (!owns(event)) return [];
  switch (event.name) {
    case 'edit':
      return input(st, event.ns, { type: 'edit', field: event.payload.field, value: event.payload.value }, ctx);
    case 'cancel':
      return input(st, event.ns, { type: 'close' }, ctx);
    case 'newFoodType':
      return open(st, 'foodType', 'foodTypeCreate', event.payload, 'editing', ctx);
    case 'editFoodType':
      return open(st, 'foodType', 'foodTypeEdit', event.payload, 'editing', ctx);
    case 'changeUnit':
      return open(st, 'unitConversion', 'unitChange', event.payload, 'editing', ctx);
    case 'deleteFoodType':
      return open(st, 'foodTypeDelete', 'foodTypeDelete', event.payload, 'confirming', ctx);
    case 'newCategory':
      return open(st, 'category', 'categoryCreate', event.payload, 'editing', ctx);
    case 'renameCategory':
      return open(st, 'category', 'categoryRename', event.payload, 'editing', ctx);
    case 'setThreshold':
      return open(st, 'threshold', 'thresholdSet', event.payload, 'editing', ctx);
    case 'deleteCategory':
      return open(st, 'categoryDelete', 'categoryDelete', event.payload, 'confirming', ctx);
    case 'submit':
      return SUBMIT[event.ns](st, ctx);
  }
}

/**
 * FX-09 TaxonomyCoordinator. Owns the Food Type form, the unit-conversion modal, the inline category
 * and threshold forms and the two confirmations that delete a Food Type or a category (blueprint 3.3).
 * Six workflows: saveFoodType, changeUnit, deleteFoodType, saveCategory, deleteCategory and
 * setThreshold. The top calls `redraw` when the Categories tab refreshes.
 *
 * The workflows are functions of their own over the slices, and the object that this returns only
 * points at them. It reaches the API and the page only through `ctx`.
 */
export function createTaxonomyCoordinator() {
  const st: State = { foodType: CLOSED, unitConversion: CLOSED, foodTypeDelete: CLOSED, category: CLOSED, threshold: CLOSED, categoryDelete: CLOSED };
  return {
    handle: (event: UiEvent, ctx: Ctx): Promise<readonly Intent[]> => handle(st, event, ctx),
    redraw: (ctx: Ctx): readonly Intent[] => redraw(st, ctx),
  };
}
