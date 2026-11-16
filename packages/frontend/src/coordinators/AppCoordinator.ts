import type { DomainError } from '@freshrescue/contract-errors';
import type { Envelope, MessageData } from '@freshrescue/contract-messages';
import type { Result } from '@freshrescue/contract-primitives';
import { UI_ROUTES } from '@freshrescue/contract-ui';
import type { Ctx, Intent, Tab, UiEvent } from '@freshrescue/contract-ui';
import type { ApiPort } from '../gateways/apiGateway';
import type { DomHostPort } from '../gateways/domHostGateway';
import type { MidnightTimerPort } from '../gateways/midnightTimerGateway';
import { errorNoticeMapper } from '../modules/computation/errorNoticeMapper';
import { apiResponseParser } from '../modules/parsing/apiResponseParser';
import { createCookingCoordinator } from './CookingCoordinator';
import { createInventoryCoordinator } from './InventoryCoordinator';
import { createRecipeBookCoordinator } from './RecipeBookCoordinator';
import { createShellCoordinator } from './ShellCoordinator';
import { createTaxonomyCoordinator } from './TaxonomyCoordinator';

/** The three gateways that this coordinator, and no other, may touch (blueprint 2.2), each as its port. */
type Gateways = {
  readonly api: ApiPort;
  readonly dom: DomHostPort;
  readonly timer: MidnightTimerPort;
};

/** The five sub-coordinators, by the names that the route table uses. `dispatch` indexes this by every `CoordinatorName`, so a name without a coordinator fails the build. */
type Subs = {
  readonly Shell: ReturnType<typeof createShellCoordinator>;
  readonly Inventory: ReturnType<typeof createInventoryCoordinator>;
  readonly Taxonomy: ReturnType<typeof createTaxonomyCoordinator>;
  readonly RecipeBook: ReturnType<typeof createRecipeBookCoordinator>;
  readonly Cooking: ReturnType<typeof createCookingCoordinator>;
};

/** What `start` attached, so that `stop` can detach it. `stopped` is set when `stop` comes before `start` has finished. */
type Session = {
  readonly detach: () => void;
  unsubscribe: (() => void) | null;
  stopped: boolean;
};

type App = {
  readonly gateways: Gateways;
  readonly subs: Subs;
  readonly ctx: Ctx;
  session: Session | null;
};

/** The tab that the app opens on. */
const HOME: Tab = 'inventory';

/**
 * `ctx` of blueprint 4.3. `callApi` is ApiGateway then ApiResponseParser, `mount` is DomHostGateway, and
 * `reference()` reads the reference slice of the Shell. A slot that is missing is reported as a notice,
 * except the notice bar's own: a notice could not be shown there, and reporting it would only fail again.
 */
function ctxOf(gateways: Gateways, subs: Subs, report: (error: DomainError) => void): Ctx {
  return {
    callApi: async <M extends Envelope>(message: M): Promise<Result<MessageData[M['type']], DomainError>> => {
      const raw = await gateways.api.send(message);
      if (!raw.ok) return raw;
      return apiResponseParser<M['type']>(raw.value, message.type);
    },
    mount: (slot, tree) => {
      const painted = gateways.dom.mount(slot, tree);
      if (!painted.ok && slot !== 'notices') report(painted.err);
    },
    reference: () => subs.Shell.referenceData(),
  };
}

/** `apply(intents)` of blueprint 4.3, a shared step: each intent in order, and the intents that a call returns are applied the same way. */
async function apply(app: App, intents: readonly Intent[] | Promise<readonly Intent[]>): Promise<void> {
  const { subs, ctx } = app;
  for (const intent of await intents) {
    switch (intent.kind) {
      case 'navigate':
        await apply(app, subs.Shell.navigate(intent.tab, intent.detail, ctx));
        break;
      case 'notify':
        await apply(app, subs.Shell.pushNotice(intent.notice, ctx));
        break;
      case 'dataChanged':
        await refreshVisible(app);
        break;
      case 'openInCook':
        await apply(app, subs.Shell.navigate('catalog', null, ctx));
        await apply(app, subs.RecipeBook.highlightRecipe(intent.recipeId, ctx));
        break;
      case 'recipeDeleted':
        await apply(app, subs.Cooking.editQueue({ type: 'prune', recipeId: intent.recipeId }, ctx));
        break;
    }
  }
}

/** `refreshVisible()` of blueprint 4.3, a shared step: the reference data, then the loader of the visible tab only. */
async function refreshVisible(app: App): Promise<void> {
  const { subs, ctx } = app;
  await apply(app, subs.Shell.loadReferenceData(ctx));
  const nav = subs.Shell.navigation();
  switch (nav.tab) {
    case 'inventory':
      return apply(app, subs.Inventory.refresh(nav.detail, ctx));
    case 'warnings':
      return apply(app, subs.Inventory.loadWarnings(ctx));
    case 'recommendations':
      return apply(app, subs.RecipeBook.loadRecommendations(ctx));
    case 'catalog':
      return apply(app, subs.RecipeBook.loadCatalog(ctx));
    case 'categories':
      return apply(app, subs.Taxonomy.redraw(ctx));
  }
}

/** `showError(e)` of blueprint 4.3: an error that no sub-coordinator owns becomes a notice. */
const showError = (app: App, error: DomainError): Promise<void> => apply(app, [{ kind: 'notify', notice: errorNoticeMapper(error, null) }]);

/** dispatch: the sub-coordinator that owns the namespace of the event handles it. An unrouted event is a bad envelope: it is dropped, and an error notice says so. */
async function dispatch(app: App, event: UiEvent): Promise<void> {
  if (!Object.hasOwn(UI_ROUTES, event.ns)) {
    return showError(app, { code: 'BAD_ENVELOPE', detail: `no coordinator owns the events of "${String(event.ns)}"` });
  }
  await apply(app, app.subs[UI_ROUTES[event.ns]].handle(event, app.ctx));
}

/** onTick: at local 00:00 the screen reloads, and the new queries carry the new date. */
const onTick = (app: App): Promise<void> => refreshVisible(app);

/**
 * startup: hands `dispatch` to the DOM host, has the Shell draw the frame, loads the reference data and
 * the first tab, and subscribes to the midnight timer. Starting an app that is running does nothing, and
 * a `stop` that comes while the first loads are on their way keeps the timer from being subscribed.
 */
async function start(app: App): Promise<void> {
  if (app.session !== null) return;
  const session: Session = { detach: app.gateways.dom.onEvent((event) => void dispatch(app, event)), unsubscribe: null, stopped: false };
  app.session = session;
  await apply(app, app.subs.Shell.navigate(HOME, null, app.ctx));
  await refreshVisible(app);
  if (!session.stopped) session.unsubscribe = app.gateways.timer.subscribe(() => void onTick(app));
}

/** Undoes `start`: the page listeners are detached and the timer is cancelled. The slices are kept, so a later `start` paints them again. */
function stop(app: App): void {
  const { session } = app;
  if (session === null) return;
  session.stopped = true;
  session.detach();
  session.unsubscribe?.();
  app.session = null;
}

/**
 * FX-06 AppCoordinator, the top of the frontend. It is the only frontend coordinator that touches the
 * gateways, which arrive as ports, so the same coordinator runs against a stand-in API in a test and
 * against the real gateways in the browser. It routes every `UiEvent` to the one sub-coordinator that
 * `UI_ROUTES` names, and applies the intents that come back (blueprint 3.3). Three workflows: startup
 * (`start`), dispatch and onTick. `stop` undoes `start`, so that `start`, `stop`, `start`, which is what
 * React does in development, leaves one set of page listeners and one timer.
 *
 * The workflows are functions of their own, and the object that this returns only points at them.
 */
export function createAppCoordinator(gateways: Gateways) {
  const subs: Subs = {
    Shell: createShellCoordinator(),
    Inventory: createInventoryCoordinator(),
    Taxonomy: createTaxonomyCoordinator(),
    RecipeBook: createRecipeBookCoordinator(),
    Cooking: createCookingCoordinator(),
  };
  const app: App = { gateways, subs, ctx: ctxOf(gateways, subs, (error) => void showError(app, error)), session: null };
  return {
    start: (): Promise<void> => start(app),
    stop: (): void => stop(app),
    dispatch: (event: UiEvent): Promise<void> => dispatch(app, event),
  };
}
