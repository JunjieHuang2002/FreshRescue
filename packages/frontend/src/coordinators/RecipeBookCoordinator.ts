import type { DomainError } from '@freshrescue/contract-errors';
import type { Command, MessageType } from '@freshrescue/contract-messages';
import type { Id, Result } from '@freshrescue/contract-primitives';
import { FORM_SCHEMAS, UI_ROUTES } from '@freshrescue/contract-ui';
import type {
  CatalogViewState,
  Ctx,
  FieldError,
  FormAction,
  FormEntry,
  FormKind,
  FormState,
  Intent,
  ResourceAction,
  ResourceState,
  UiEvent,
  UiNamespace,
} from '@freshrescue/contract-ui';
import type { CatalogDto, RecommendationDto } from '@freshrescue/contract-views';
import { errorNoticeMapper } from '../modules/computation/errorNoticeMapper';
import { formPrefillBuilder } from '../modules/computation/formPrefillBuilder';
import type { PrefillData } from '../modules/computation/formPrefillBuilder';
import { formSchemaParser } from '../modules/parsing/formSchemaParser';
import { catalogViewSlice } from '../modules/slices/catalogViewSlice';
import { formSlice } from '../modules/slices/formSlice';
import { resourceSlice } from '../modules/slices/resourceSlice';
import { confirmDialogView } from '../modules/views/confirmDialogView';
import { recipeCatalogView } from '../modules/views/recipeCatalogView';
import { recipeFormView } from '../modules/views/recipeFormView';
import { recommendationView } from '../modules/views/recommendationView';

/** The events of the namespaces that the route table gives to this coordinator: `recommendations`, `catalog`, `recipe` and `recipeDelete`. */
type Owned = Extract<UiEvent, { readonly ns: { [N in UiNamespace]: (typeof UI_ROUTES)[N] extends 'RecipeBook' ? N : never }[UiNamespace] }>;

const owns = (event: UiEvent): event is Owned => UI_ROUTES[event.ns] === 'RecipeBook';

/** The slices of this coordinator (blueprint 2.5). The key of a form is also its namespace. */
type State = {
  recommendations: ResourceState<RecommendationDto>;
  catalog: ResourceState<CatalogDto>;
  catalogView: CatalogViewState;
  recipe: FormState;
  recipeDelete: FormState;
};

type FormKey = 'recipe' | 'recipeDelete';

const IDLE: ResourceState<never> = { value: 'idle', context: { data: null, error: null } };
const CLOSED: FormState = { value: 'closed', context: { kind: null, values: {}, options: {}, hints: {}, returnTo: 'editing' } };
const ALL_CUISINES: CatalogViewState = { cuisineId: null, highlightId: null };
const DATA_CHANGED: Intent = { kind: 'dataChanged' };

/** `draw(k)` of blueprint 4.1: mounts every view that shows slice k. The catalog view shows the catalog and its view state, and the cuisines of its filter come from `ctx.reference()`. */
const DRAW: { readonly [K in keyof State]: (st: State, ctx: Ctx) => void } = {
  recommendations: (st, ctx) => ctx.mount('recommendations', recommendationView(st.recommendations)),
  catalog: (st, ctx) => ctx.mount('catalog', recipeCatalogView(st.catalog, st.catalogView, ctx.reference())),
  catalogView: (st, ctx) => DRAW.catalog(st, ctx),
  recipe: (st, ctx) => ctx.mount('recipeForm', recipeFormView(st.recipe)),
  recipeDelete: (st, ctx) => ctx.mount('confirm', confirmDialogView(st.recipeDelete)),
};

// ---- the templates of blueprint 4.1, expanded for this coordinator --------------------------

/** The end of LOAD: the reply makes the slice `ready` or `failed`. */
const settled = <T>(reply: Result<T, DomainError>): ResourceAction<T> =>
  reply.ok ? { type: 'ready', data: reply.value } : { type: 'failed', error: reply.err };

/** The intents of LOAD: a notice when the read failed. */
const noticesOf = (reply: Result<unknown, DomainError>, message: MessageType): readonly Intent[] =>
  reply.ok ? [] : [{ kind: 'notify', notice: errorNoticeMapper(reply.err, { message }) }];

/** OPEN: the prefill of the form from the data of the event that opens it. */
function open<K extends FormKind>(st: State, key: FormKey, kind: K, data: PrefillData[K], at: FormEntry, ctx: Ctx): readonly Intent[] {
  const prefill = formPrefillBuilder(kind, data, ctx.reference());
  st[key] = formSlice(st[key], { type: 'open', kind, prefill, at });
  DRAW[key](st, ctx);
  return [];
}

/** INPUT: an edit, a row added or removed, or a cancel. */
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

// ---- the seven workflows ----------------------------------------------------------------------

/** loadRecommendations: the Load shape with GetRecommendations. */
async function loadRecommendations(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  st.recommendations = resourceSlice(st.recommendations, { type: 'loading' });
  DRAW.recommendations(st, ctx);
  const reply = await ctx.callApi({ type: 'GetRecommendations', params: {} });
  st.recommendations = resourceSlice(st.recommendations, settled(reply));
  DRAW.recommendations(st, ctx);
  return noticesOf(reply, 'GetRecommendations');
}

/** The Load shape with GetCatalog for the cuisine of the filter. */
async function fetchCatalog(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  st.catalog = resourceSlice(st.catalog, { type: 'loading' });
  DRAW.catalog(st, ctx);
  const reply = await ctx.callApi({ type: 'GetCatalog', params: { cuisineId: st.catalogView.cuisineId } });
  st.catalog = resourceSlice(st.catalog, settled(reply));
  DRAW.catalog(st, ctx);
  return noticesOf(reply, 'GetCatalog');
}

/** loadCatalog: the catalog for the filter. A cuisine that was deleted meanwhile is CATEGORY_NOT_FOUND, and then the filter is cleared and the whole list loads. */
async function loadCatalog(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  const intents = await fetchCatalog(st, ctx);
  if (st.catalog.value !== 'failed' || st.catalog.context.error?.code !== 'CATEGORY_NOT_FOUND') return intents;
  st.catalogView = catalogViewSlice(st.catalogView, { type: 'cuisine', cuisineId: null });
  return fetchCatalog(st, ctx);
}

/** setCuisineFilter: the backend does the filtering, so the catalog loads again. */
function setCuisineFilter(st: State, cuisineId: Id | null, ctx: Ctx): Promise<readonly Intent[]> {
  st.catalogView = catalogViewSlice(st.catalogView, { type: 'cuisine', cuisineId });
  return loadCatalog(st, ctx);
}

/** highlightRecipe: marks the recipe that was opened from the recommendations. The top calls it after `openInCook`. */
function highlightRecipe(st: State, recipeId: Id, ctx: Ctx): readonly Intent[] {
  st.catalogView = catalogViewSlice(st.catalogView, { type: 'highlight', recipeId });
  DRAW.catalogView(st, ctx);
  return [];
}

/** saveRecipe, the submit step: SaveRecipe, which creates a recipe when the form has no id and replaces it when it has one. */
function saveRecipe(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  const parsed = formSchemaParser(FORM_SCHEMAS.recipe, st.recipe.context.values);
  return submit(st, 'recipe', parsed, (payload) => ({ type: 'SaveRecipe', payload }), ctx);
}

/** deleteRecipe, the confirm step: DeleteRecipe. When it worked, the recipe also leaves the cook queue (`recipeDeleted`), then the views reload. */
async function deleteRecipe(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  const target = formSchemaParser(FORM_SCHEMAS.target, st.recipeDelete.context.values);
  const intents = await submit(st, 'recipeDelete', target, (found) => ({ type: 'DeleteRecipe', payload: { recipeId: found.id } }), ctx);
  if (!target.ok || !intents.some((intent) => intent.kind === 'dataChanged')) return intents;
  return [{ kind: 'recipeDeleted', recipeId: target.value.id }, ...intents];
}

/** `handle(ev, ctx)` of blueprint 4.3. "Open in Cook" only recommends, so it becomes the `openInCook` intent. Any other event is not this coordinator's and changes nothing. */
async function handle(st: State, event: UiEvent, ctx: Ctx): Promise<readonly Intent[]> {
  if (!owns(event)) return [];
  switch (event.name) {
    case 'openInCook':
      return [{ kind: 'openInCook', recipeId: event.payload.recipeId }];
    case 'setCuisineFilter':
      return setCuisineFilter(st, event.payload.cuisineId, ctx);
    case 'edit':
      return input(st, 'recipe', { type: 'edit', field: event.payload.field, value: event.payload.value }, ctx);
    case 'addRow':
      return input(st, 'recipe', { type: 'addRow', group: event.payload.group, fields: event.payload.fields }, ctx);
    case 'removeRow':
      return input(st, 'recipe', { type: 'removeRow', group: event.payload.group, index: event.payload.index }, ctx);
    case 'cancel':
      return input(st, event.ns, { type: 'close' }, ctx);
    case 'newRecipe':
      return open(st, 'recipe', 'recipeCreate', event.payload, 'editing', ctx);
    case 'editRecipe':
      return open(st, 'recipe', 'recipeEdit', event.payload, 'editing', ctx);
    case 'deleteRecipe':
      return open(st, 'recipeDelete', 'recipeDelete', event.payload, 'confirming', ctx);
    case 'submit':
      return event.ns === 'recipe' ? saveRecipe(st, ctx) : deleteRecipe(st, ctx);
  }
}

/**
 * FX-10 RecipeBookCoordinator. Owns the recommendations, the recipe catalog with its view state (the
 * cuisine filter and the highlighted recipe), the recipe form and the confirmation that deletes a
 * recipe (blueprint 3.3). Seven workflows: loadRecommendations, openInCook, loadCatalog,
 * setCuisineFilter, highlightRecipe, saveRecipe and deleteRecipe. The top calls `loadRecommendations`
 * and `loadCatalog` for their tabs, and `highlightRecipe` after `openInCook`.
 *
 * The workflows are functions of their own over the slices, and the object that this returns only
 * points at them. It reaches the API and the page only through `ctx`.
 */
export function createRecipeBookCoordinator() {
  const st: State = { recommendations: IDLE, catalog: IDLE, catalogView: ALL_CUISINES, recipe: CLOSED, recipeDelete: CLOSED };
  return {
    handle: (event: UiEvent, ctx: Ctx): Promise<readonly Intent[]> => handle(st, event, ctx),
    loadRecommendations: (ctx: Ctx): Promise<readonly Intent[]> => loadRecommendations(st, ctx),
    loadCatalog: (ctx: Ctx): Promise<readonly Intent[]> => loadCatalog(st, ctx),
    highlightRecipe: (recipeId: Id, ctx: Ctx): readonly Intent[] => highlightRecipe(st, recipeId, ctx),
  };
}
