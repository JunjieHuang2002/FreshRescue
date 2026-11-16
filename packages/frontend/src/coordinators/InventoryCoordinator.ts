import type { DomainError } from '@freshrescue/contract-errors';
import type { Command, MessageType } from '@freshrescue/contract-messages';
import type { Id, Result } from '@freshrescue/contract-primitives';
import { FORM_SCHEMAS, UI_ROUTES } from '@freshrescue/contract-ui';
import type { Ctx, FieldError, FormAction, FormEntry, FormKind, FormState, Intent, ResourceAction, ResourceState, UiEvent, UiNamespace, UiPayloads } from '@freshrescue/contract-ui';
import type { FoodTypeDetailDto, InventoryListDto, WarningPanelDto } from '@freshrescue/contract-views';
import { errorNoticeMapper } from '../modules/computation/errorNoticeMapper';
import { formPrefillBuilder } from '../modules/computation/formPrefillBuilder';
import type { PrefillData } from '../modules/computation/formPrefillBuilder';
import { formSchemaParser } from '../modules/parsing/formSchemaParser';
import { formSlice } from '../modules/slices/formSlice';
import { resourceSlice } from '../modules/slices/resourceSlice';
import { batchFormView } from '../modules/views/batchFormView';
import { confirmDialogView } from '../modules/views/confirmDialogView';
import { foodTypeDetailView } from '../modules/views/foodTypeDetailView';
import { inventoryListView } from '../modules/views/inventoryListView';
import { warningPanelView } from '../modules/views/warningPanelView';

/** The events of the namespaces that the route table gives to this coordinator: `inventory`, `batch` and `batchRemove`. */
type Owned = Extract<UiEvent, { readonly ns: { [N in UiNamespace]: (typeof UI_ROUTES)[N] extends 'Inventory' ? N : never }[UiNamespace] }>;

const owns = (event: UiEvent): event is Owned => UI_ROUTES[event.ns] === 'Inventory';

/** The slices of this coordinator (blueprint 2.5). The key of a form is also its namespace; add and edit-quantity share `batch`. */
type State = {
  inventoryList: ResourceState<InventoryListDto>;
  foodTypeDetail: ResourceState<FoodTypeDetailDto>;
  warningPanel: ResourceState<WarningPanelDto>;
  batch: FormState;
  batchRemove: FormState;
};

type FormKey = 'batch' | 'batchRemove';

const IDLE: ResourceState<never> = { value: 'idle', context: { data: null, error: null } };
const CLOSED: FormState = { value: 'closed', context: { kind: null, values: {}, options: {}, hints: {}, returnTo: 'editing' } };
const DATA_CHANGED: Intent = { kind: 'dataChanged' };

/** `draw(k)` of blueprint 4.1: mounts every view that shows slice k. */
const DRAW: { readonly [K in keyof State]: (st: State, ctx: Ctx) => void } = {
  inventoryList: (st, ctx) => ctx.mount('inventoryList', inventoryListView(st.inventoryList)),
  foodTypeDetail: (st, ctx) => ctx.mount('foodTypeDetail', foodTypeDetailView(st.foodTypeDetail)),
  warningPanel: (st, ctx) => ctx.mount('warnings', warningPanelView(st.warningPanel)),
  batch: (st, ctx) => ctx.mount('batchForm', batchFormView(st.batch)),
  batchRemove: (st, ctx) => ctx.mount('confirm', confirmDialogView(st.batchRemove)),
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

// ---- the seven workflows ----------------------------------------------------------------------

/** loadList: the Load shape with GetInventoryList. */
async function loadList(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  st.inventoryList = resourceSlice(st.inventoryList, { type: 'loading' });
  DRAW.inventoryList(st, ctx);
  const reply = await ctx.callApi({ type: 'GetInventoryList', params: {} });
  st.inventoryList = resourceSlice(st.inventoryList, settled(reply));
  DRAW.inventoryList(st, ctx);
  return noticesOf(reply, 'GetInventoryList');
}

/** The Load shape with GetFoodTypeDetail, which openDetail and refresh share. */
async function loadDetail(st: State, foodTypeId: Id, ctx: Ctx): Promise<readonly Intent[]> {
  st.foodTypeDetail = resourceSlice(st.foodTypeDetail, { type: 'loading' });
  DRAW.foodTypeDetail(st, ctx);
  const reply = await ctx.callApi({ type: 'GetFoodTypeDetail', params: { foodTypeId } });
  st.foodTypeDetail = resourceSlice(st.foodTypeDetail, settled(reply));
  DRAW.foodTypeDetail(st, ctx);
  return noticesOf(reply, 'GetFoodTypeDetail');
}

/** openDetail: loads the detail of the Food Type that was clicked, and asks the Shell to record it as open. */
async function openDetail(st: State, foodTypeId: Id, ctx: Ctx): Promise<readonly Intent[]> {
  const intents = await loadDetail(st, foodTypeId, ctx);
  return [{ kind: 'navigate', tab: 'inventory', detail: foodTypeId }, ...intents];
}

/** refresh: the list again and, when the top names an open detail, that detail too. */
async function refresh(st: State, detailId: Id | null, ctx: Ctx): Promise<readonly Intent[]> {
  const intents = await loadList(st, ctx);
  if (detailId === null) return intents;
  return [...intents, ...(await loadDetail(st, detailId, ctx))];
}

/** loadWarnings: the Load shape with GetWarningPanel. */
async function loadWarnings(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  st.warningPanel = resourceSlice(st.warningPanel, { type: 'loading' });
  DRAW.warningPanel(st, ctx);
  const reply = await ctx.callApi({ type: 'GetWarningPanel', params: {} });
  st.warningPanel = resourceSlice(st.warningPanel, settled(reply));
  DRAW.warningPanel(st, ctx);
  return noticesOf(reply, 'GetWarningPanel');
}

/** addBatch, the pick of a Food Type: the fields that depend on it are filled again, and what was typed stays. */
function pickFoodType(st: State, pick: UiPayloads['batch']['pickFoodType'], ctx: Ctx): readonly Intent[] {
  st.batch = formSlice(st.batch, { type: 'refill', prefill: formPrefillBuilder('batchAdd', pick, ctx.reference()) });
  DRAW.batch(st, ctx);
  return [];
}

/** addBatch, the submit step: InboundBatch. Its open, pick, edit and cancel steps are in `handle`. */
function addBatch(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  const parsed = formSchemaParser(FORM_SCHEMAS.batchAdd, st.batch.context.values);
  return submit(st, 'batch', parsed, (payload) => ({ type: 'InboundBatch', payload }), ctx);
}

/** editBatchQuantity, the submit step: EditBatchQuantity. */
function editBatchQuantity(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  const parsed = formSchemaParser(FORM_SCHEMAS.batchQty, st.batch.context.values);
  return submit(st, 'batch', parsed, (payload) => ({ type: 'EditBatchQuantity', payload }), ctx);
}

/** removeBatch, the confirm step: RemoveBatch for the batch that the confirmation names. */
function removeBatch(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  const target = formSchemaParser(FORM_SCHEMAS.target, st.batchRemove.context.values);
  return submit(st, 'batchRemove', target, (found) => ({ type: 'RemoveBatch', payload: { batchId: found.id } }), ctx);
}

/** The submit of the `batch` slice, by the form that it shows. */
async function submitBatch(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  switch (st.batch.context.kind) {
    case 'batchAdd':
      return addBatch(st, ctx);
    case 'batchQty':
      return editBatchQuantity(st, ctx);
    default:
      return [];
  }
}

/** `handle(ev, ctx)` of blueprint 4.3: the events of `inventory`, `batch` and `batchRemove`. Any other event is not this coordinator's and changes nothing. */
async function handle(st: State, event: UiEvent, ctx: Ctx): Promise<readonly Intent[]> {
  if (!owns(event)) return [];
  switch (event.name) {
    case 'openDetail':
      return openDetail(st, event.payload.foodTypeId, ctx);
    case 'edit':
      return input(st, event.ns, { type: 'edit', field: event.payload.field, value: event.payload.value }, ctx);
    case 'cancel':
      return input(st, event.ns, { type: 'close' }, ctx);
    case 'addBatch':
      return open(st, 'batch', 'batchAdd', event.payload, 'editing', ctx);
    case 'pickFoodType':
      return pickFoodType(st, event.payload, ctx);
    case 'editBatchQuantity':
      return open(st, 'batch', 'batchQty', event.payload, 'editing', ctx);
    case 'removeBatch':
      return open(st, 'batchRemove', 'batchRemove', event.payload, 'confirming', ctx);
    case 'submit':
      return event.ns === 'batchRemove' ? removeBatch(st, ctx) : submitBatch(st, ctx);
  }
}

/**
 * FX-08 InventoryCoordinator. Owns the inventory list, the open Food Type detail, the warning panel,
 * the batch form (adding a batch and editing a quantity share one slice) and the confirmation that
 * removes a batch (blueprint 3.3). Seven workflows: loadList, openDetail, refresh, loadWarnings,
 * addBatch, editBatchQuantity and removeBatch. The top calls `refresh` for the Inventory tab, with the
 * id of the open detail, and `loadWarnings` for the Warnings tab.
 *
 * The workflows are functions of their own over the slices, and the object that this returns only
 * points at them. It reaches the API and the page only through `ctx`.
 */
export function createInventoryCoordinator() {
  const st: State = { inventoryList: IDLE, foodTypeDetail: IDLE, warningPanel: IDLE, batch: CLOSED, batchRemove: CLOSED };
  return {
    handle: (event: UiEvent, ctx: Ctx): Promise<readonly Intent[]> => handle(st, event, ctx),
    refresh: (detailId: Id | null, ctx: Ctx): Promise<readonly Intent[]> => refresh(st, detailId, ctx),
    loadWarnings: (ctx: Ctx): Promise<readonly Intent[]> => loadWarnings(st, ctx),
  };
}
