import type { DomainError } from '@freshrescue/contract-errors';
import type { Command, MessageType } from '@freshrescue/contract-messages';
import type { Id, Result } from '@freshrescue/contract-primitives';
import { FORM_SCHEMAS, UI_ROUTES } from '@freshrescue/contract-ui';
import type {
  Ctx,
  FieldError,
  FormAction,
  FormEntry,
  FormKind,
  FormState,
  Intent,
  NavState,
  NoticeModel,
  NoticeState,
  ResourceAction,
  ResourceState,
  Tab,
  UiEvent,
  UiNamespace,
} from '@freshrescue/contract-ui';
import type { ReferenceDataDto } from '@freshrescue/contract-views';
import { errorNoticeMapper } from '../modules/computation/errorNoticeMapper';
import { formPrefillBuilder } from '../modules/computation/formPrefillBuilder';
import type { PrefillData } from '../modules/computation/formPrefillBuilder';
import { formSchemaParser } from '../modules/parsing/formSchemaParser';
import { formSlice } from '../modules/slices/formSlice';
import { navigationSlice } from '../modules/slices/navigationSlice';
import { noticeSlice } from '../modules/slices/noticeSlice';
import { resourceSlice } from '../modules/slices/resourceSlice';
import { appShellView } from '../modules/views/appShellView';
import { demoControlView } from '../modules/views/demoControlView';
import { noticeBarView } from '../modules/views/noticeBarView';

/** The events of the namespaces that the route table gives to this coordinator: `shell` and `settings`. */
type Owned = Extract<UiEvent, { readonly ns: { [N in UiNamespace]: (typeof UI_ROUTES)[N] extends 'Shell' ? N : never }[UiNamespace] }>;

const owns = (event: UiEvent): event is Owned => UI_ROUTES[event.ns] === 'Shell';

/** The slices of this coordinator (blueprint 2.5). The key of a form is also its namespace. */
type State = {
  navigation: NavState;
  notices: NoticeState;
  referenceData: ResourceState<ReferenceDataDto>;
  settings: FormState;
};

type FormKey = 'settings';

const HOME: NavState = { tab: 'inventory', detail: null };
const NO_NOTICES: NoticeState = { items: [], nextId: 1 };
const IDLE: ResourceState<never> = { value: 'idle', context: { data: null, error: null } };
const CLOSED: FormState = { value: 'closed', context: { kind: null, values: {}, options: {}, hints: {}, returnTo: 'editing' } };
const DATA_CHANGED: Intent = { kind: 'dataChanged' };

/**
 * `draw(k)` of blueprint 4.1: mounts every view that shows slice k. The frame shows today's date and the
 * demo control shows the date and whether it is simulated, so both of them show the reference data. The
 * date is the one that the backend resolved, passed on as it is.
 */
const DRAW: { readonly [K in keyof State]: (st: State, ctx: Ctx) => void } = {
  navigation: (st, ctx) => ctx.mount('shell', appShellView(st.navigation, st.referenceData.context.data?.today ?? '')),
  notices: (st, ctx) => ctx.mount('notices', noticeBarView(st.notices.items)),
  referenceData: (st, ctx) => {
    DRAW.navigation(st, ctx);
    DRAW.settings(st, ctx);
  },
  settings: (st, ctx) => ctx.mount('demo', demoControlView(st.settings, st.referenceData.context.data)),
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

// ---- the five workflows -----------------------------------------------------------------------

/** navigate: the tab and the open detail. A tab that changed returns dataChanged, so that it loads; opening or closing a detail returns nothing. */
function navigate(st: State, tab: Tab, detail: Id | null, ctx: Ctx): readonly Intent[] {
  const was = st.navigation.tab;
  st.navigation = navigationSlice(st.navigation, { type: 'go', tab, detail });
  DRAW.navigation(st, ctx);
  return st.navigation.tab !== was ? [DATA_CHANGED] : [];
}

/** pushNotice. */
function pushNotice(st: State, notice: NoticeModel, ctx: Ctx): readonly Intent[] {
  st.notices = noticeSlice(st.notices, { type: 'push', notice });
  DRAW.notices(st, ctx);
  return [];
}

/** dismissNotice. */
function dismissNotice(st: State, id: number, ctx: Ctx): readonly Intent[] {
  st.notices = noticeSlice(st.notices, { type: 'dismiss', id });
  DRAW.notices(st, ctx);
  return [];
}

/** loadReferenceData: the Load shape with GetReferenceData. The other coordinators read the result through `ctx.reference()`. */
async function loadReferenceData(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  st.referenceData = resourceSlice(st.referenceData, { type: 'loading' });
  DRAW.referenceData(st, ctx);
  const reply = await ctx.callApi({ type: 'GetReferenceData', params: {} });
  st.referenceData = resourceSlice(st.referenceData, settled(reply));
  DRAW.referenceData(st, ctx);
  return noticesOf(reply, 'GetReferenceData');
}

/** submitSimulatedToday, the submit step: an empty date clears Simulated Today. Its open, edit and cancel steps are in `handle`. */
function submitSimulatedToday(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  const parsed = formSchemaParser(FORM_SCHEMAS.settings, st.settings.context.values);
  return submit(st, 'settings', parsed, (payload) => ({ type: 'SetSimulatedToday', payload }), ctx);
}

/** `handle(ev, ctx)` of blueprint 4.3: the events of `shell` and `settings`. Any other event is not this coordinator's and changes nothing. */
async function handle(st: State, event: UiEvent, ctx: Ctx): Promise<readonly Intent[]> {
  if (!owns(event)) return [];
  switch (event.name) {
    case 'navigate': // a tab, or the back button of a detail
      return navigate(st, event.payload.tab, event.payload.detail, ctx);
    case 'dismiss':
      return dismissNotice(st, event.payload.noticeId, ctx);
    case 'open':
      return open(st, 'settings', 'settingsForm', event.payload, 'editing', ctx);
    case 'edit':
      return input(st, 'settings', { type: 'edit', field: event.payload.field, value: event.payload.value }, ctx);
    case 'cancel':
      return input(st, 'settings', { type: 'close' }, ctx);
    case 'submit':
      return submitSimulatedToday(st, ctx);
  }
}

/**
 * FX-07 ShellCoordinator. Owns the active tab and the open Food Type detail, the notice queue, the
 * reference data and the Simulated Today control (blueprint 3.3), and draws the frame, the notice bar
 * and the demo control. Five workflows: navigate, pushNotice, dismissNotice, loadReferenceData and
 * submitSimulatedToday. The top calls `navigate`, `pushNotice` and `loadReferenceData` itself to apply
 * intents, and reads `navigation` and `referenceData`, which feeds `ctx.reference()`.
 *
 * The workflows are functions of their own over the slices, and the object that this returns only
 * points at them. It reaches the API and the page only through `ctx`.
 */
export function createShellCoordinator() {
  const st: State = { navigation: HOME, notices: NO_NOTICES, referenceData: IDLE, settings: CLOSED };
  return {
    handle: (event: UiEvent, ctx: Ctx): Promise<readonly Intent[]> => handle(st, event, ctx),
    navigate: (tab: Tab, detail: Id | null, ctx: Ctx): readonly Intent[] => navigate(st, tab, detail, ctx),
    pushNotice: (notice: NoticeModel, ctx: Ctx): readonly Intent[] => pushNotice(st, notice, ctx),
    loadReferenceData: (ctx: Ctx): Promise<readonly Intent[]> => loadReferenceData(st, ctx),
    navigation: (): NavState => st.navigation,
    referenceData: (): ReferenceDataDto | null => st.referenceData.context.data,
  };
}
