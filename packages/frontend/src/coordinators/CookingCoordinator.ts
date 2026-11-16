import { UI_ROUTES } from '@freshrescue/contract-ui';
import type { Ctx, Intent, QueueAction, QueueState, ResourceState, UiEvent, UiNamespace } from '@freshrescue/contract-ui';
import type { CookReportDto } from '@freshrescue/contract-views';
import { errorNoticeMapper } from '../modules/computation/errorNoticeMapper';
import { cookQueueSlice } from '../modules/slices/cookQueueSlice';
import { resourceSlice } from '../modules/slices/resourceSlice';
import { cookQueueView } from '../modules/views/cookQueueView';
import { cookReportView } from '../modules/views/cookReportView';

/** The events of the namespace that the route table gives to this coordinator: `cook`. */
type Owned = Extract<UiEvent, { readonly ns: { [N in UiNamespace]: (typeof UI_ROUTES)[N] extends 'Cooking' ? N : never }[UiNamespace] }>;

const owns = (event: UiEvent): event is Owned => UI_ROUTES[event.ns] === 'Cooking';

/** The slices of this coordinator (blueprint 2.5). The queue lives only here, in the browser (spec 4.5). */
type State = {
  cookQueue: QueueState;
  cookReport: ResourceState<CookReportDto>;
};

const EMPTY_QUEUE: QueueState = { entries: [] };
const IDLE: ResourceState<never> = { value: 'idle', context: { data: null, error: null } };
const DATA_CHANGED: Intent = { kind: 'dataChanged' };

/** `draw(k)` of blueprint 4.1: mounts every view that shows slice k. */
const DRAW: { readonly [K in keyof State]: (st: State, ctx: Ctx) => void } = {
  cookQueue: (st, ctx) => ctx.mount('cookQueue', cookQueueView(st.cookQueue)),
  cookReport: (st, ctx) => ctx.mount('cookReport', cookReportView(st.cookReport)),
};

// ---- the three workflows ----------------------------------------------------------------------

/** editQueue: add, remove, move, prune or clear. It sends nothing: the queue is transient. */
function editQueue(st: State, action: QueueAction, ctx: Ctx): readonly Intent[] {
  st.cookQueue = cookQueueSlice(st.cookQueue, action);
  DRAW.cookQueue(st, ctx);
  return [];
}

/**
 * runCook: one CookRecipes with the recipe ids in queue order. On success the report shows and the queue
 * is cleared; on failure a notice shows and the queue stays, so that the person can try again. Either
 * way the views reload, because some recipes may have been cooked. While a run is on its way the report
 * slice is `loading`, and a second run that the slice refuses sends nothing, so a queue is never cooked twice.
 */
async function runCook(st: State, ctx: Ctx): Promise<readonly Intent[]> {
  const running = resourceSlice(st.cookReport, { type: 'loading' });
  if (running === st.cookReport) return [];
  st.cookReport = running;
  DRAW.cookReport(st, ctx);
  const reply = await ctx.callApi({ type: 'CookRecipes', payload: { recipeIds: st.cookQueue.entries.map((entry) => entry.recipeId) } });
  if (!reply.ok) {
    st.cookReport = resourceSlice(st.cookReport, { type: 'idle' });
    DRAW.cookReport(st, ctx);
    return [{ kind: 'notify', notice: errorNoticeMapper(reply.err, { message: 'CookRecipes' }) }, DATA_CHANGED];
  }
  st.cookReport = resourceSlice(st.cookReport, { type: 'ready', data: reply.value });
  st.cookQueue = cookQueueSlice(st.cookQueue, { type: 'clear' });
  DRAW.cookQueue(st, ctx);
  DRAW.cookReport(st, ctx);
  return [DATA_CHANGED];
}

/** dismissReport: the report closes, and its slice goes back to `idle`. */
function dismissReport(st: State, ctx: Ctx): readonly Intent[] {
  st.cookReport = resourceSlice(st.cookReport, { type: 'idle' });
  DRAW.cookReport(st, ctx);
  return [];
}

/** `handle(ev, ctx)` of blueprint 4.3: each `cook` event that edits the queue stands for the QueueAction of its name. Any other event is not this coordinator's and changes nothing. */
async function handle(st: State, event: UiEvent, ctx: Ctx): Promise<readonly Intent[]> {
  if (!owns(event)) return [];
  switch (event.name) {
    case 'add':
      return editQueue(st, { type: 'add', recipeId: event.payload.recipeId, recipeName: event.payload.recipeName }, ctx);
    case 'remove':
      return editQueue(st, { type: 'remove', index: event.payload.index }, ctx);
    case 'move':
      return editQueue(st, { type: 'move', index: event.payload.index, direction: event.payload.direction }, ctx);
    case 'clear':
      return editQueue(st, { type: 'clear' }, ctx);
    case 'run':
      return runCook(st, ctx);
    case 'dismiss':
      return dismissReport(st, ctx);
  }
}

/**
 * FX-11 CookingCoordinator. Owns the cook queue and the execution report (blueprint 3.3). Three
 * workflows: editQueue, runCook and dismissReport. The top calls `editQueue` with `prune` when a recipe
 * was deleted, so that it leaves the queue.
 *
 * The workflows are functions of their own over the slices, and the object that this returns only
 * points at them. It reaches the API and the page only through `ctx`.
 */
export function createCookingCoordinator() {
  const st: State = { cookQueue: EMPTY_QUEUE, cookReport: IDLE };
  return {
    handle: (event: UiEvent, ctx: Ctx): Promise<readonly Intent[]> => handle(st, event, ctx),
    editQueue: (action: QueueAction, ctx: Ctx): readonly Intent[] => editQueue(st, action, ctx),
  };
}
