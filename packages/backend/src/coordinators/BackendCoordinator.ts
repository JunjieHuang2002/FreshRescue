import type { ChangeSet, Outcome } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { ApiReply, Command, CoordinatorPort, RawRequest } from '@freshrescue/contract-messages';
import type { DateISO, Empty, Result } from '@freshrescue/contract-primitives';
import type { ClockPort, SeedSourcePort, StoreReadPort, StoreWritePort } from '../gateways/ports';
import { apiResponseBuilder } from '../modules/engine/apiResponseBuilder';
import { changeSetEncoder } from '../modules/engine/changeSetEncoder';
import { snapshotInvariantChecker } from '../modules/engine/snapshotInvariantChecker';
import { todayResolver } from '../modules/foundation/todayResolver';
import { commandParser } from '../modules/parsing/commandParser';
import { queryParser } from '../modules/parsing/queryParser';
import { snapshotParser } from '../modules/parsing/snapshotParser';
import { changeSetApplier } from '../modules/state/changeSetApplier';
import { createInventoryCommandCoordinator } from './InventoryCommandCoordinator';
import { createQueryCoordinator } from './QueryCoordinator';
import { createRecipeCommandCoordinator } from './RecipeCommandCoordinator';
import { createReferenceCommandCoordinator } from './ReferenceCommandCoordinator';

/** The four gateways that this coordinator, and no other, may touch (blueprint 2.2), each as its port. */
type Gateways = {
  readonly storeRead: StoreReadPort;
  readonly storeWrite: StoreWritePort;
  readonly clock: ClockPort;
  readonly seedSource: SeedSourcePort;
};

/** What a request needs: the gateways, and the four sub-coordinators that this coordinator owns. */
type Context = Gateways & {
  readonly reference: ReturnType<typeof createReferenceCommandCoordinator>;
  readonly inventory: ReturnType<typeof createInventoryCommandCoordinator>;
  readonly recipe: ReturnType<typeof createRecipeCommandCoordinator>;
  readonly query: ReturnType<typeof createQueryCoordinator>;
};

/** What a request comes to before the response is built: a payload with the `today` it was worked out for, or the first error. */
type Answer = Result<{ readonly payload: unknown; readonly today: DateISO }, DomainError>;

const DONE: Result<Empty, DomainError> = { ok: true, value: {} };

/** `load()` of blueprint 4.2: the store as a typed snapshot, which an empty store is as well. */
async function load(ctx: Context): Promise<Result<Snapshot, DomainError>> {
  const raw = await ctx.storeRead.read();
  if (!raw.ok) return raw;
  return snapshotParser(raw.value);
}

/**
 * `persist(snap, changeSets)` of blueprint 4.2, once for each ChangeSet and in order: apply it to get the
 * next snapshot, check the invariants of that snapshot, encode the ChangeSet into storage operations, write
 * them, and carry on from the next snapshot. A ChangeSet that fails any step writes nothing, and the ones
 * that were written before it stay written, which is how each cooked recipe commits as a unit of its own.
 */
async function persist(ctx: Context, snapshot: Snapshot, changeSets: readonly ChangeSet[]): Promise<Result<Empty, DomainError>> {
  let current = snapshot;
  for (const changeSet of changeSets) {
    const next = changeSetApplier(current, changeSet);
    if (!next.ok) return next;
    const checked = snapshotInvariantChecker(next.value);
    if (!checked.ok) return checked;
    const written = await ctx.storeWrite.apply(changeSetEncoder(changeSet));
    if (!written.ok) return written;
    current = next.value;
  }
  return DONE;
}

/** `route(cmd.type).handle(cmd, snap, today)` of blueprint 4.1: the sub-coordinator that owns a command (the table in blueprint 3.4). */
function routeCommand(ctx: Context, command: Command, snapshot: Snapshot, today: DateISO): Result<Outcome, DomainError> {
  switch (command.type) {
    case 'SaveCategory':
    case 'DeleteCategory':
    case 'SetCategoryThreshold':
    case 'SaveFoodType':
    case 'DeleteFoodType':
    case 'SetSimulatedToday':
      return ctx.reference.handle(command, snapshot);
    case 'ChangeFoodTypeUnit':
    case 'InboundBatch':
    case 'EditBatchQuantity':
    case 'RemoveBatch':
      return ctx.inventory.handle(command, snapshot, today);
    case 'SaveRecipe':
    case 'DeleteRecipe':
    case 'CookRecipes':
      return ctx.recipe.handle(command, snapshot, today);
  }
}

/** The `run(...)` block of `handleCommand` (blueprint 4.2): parse, load, resolve today, route, persist. */
async function runCommand(ctx: Context, body: Result<string, DomainError>): Promise<Answer> {
  if (!body.ok) return body;
  const command = commandParser(body.value);
  if (!command.ok) return command;
  const loaded = await load(ctx);
  if (!loaded.ok) return loaded;
  const today = todayResolver(ctx.clock.today(), loaded.value.settings.simulatedToday);
  const outcome = routeCommand(ctx, command.value, loaded.value, today);
  if (!outcome.ok) return outcome;
  const saved = await persist(ctx, loaded.value, outcome.value.changeSets ?? []);
  if (!saved.ok) return saved;
  return { ok: true, value: { payload: outcome.value.payload, today } };
}

/** The `run(...)` block of `handleQuery` (blueprint 4.2): the same pipeline, and nothing is persisted. */
async function runQuery(ctx: Context, body: Result<string, DomainError>): Promise<Answer> {
  if (!body.ok) return body;
  const query = queryParser(body.value);
  if (!query.ok) return query;
  const loaded = await load(ctx);
  if (!loaded.ok) return loaded;
  const today = todayResolver(ctx.clock.today(), loaded.value.settings.simulatedToday);
  const outcome = ctx.query.handle(query.value, loaded.value, today);
  if (!outcome.ok) return outcome;
  return { ok: true, value: { payload: outcome.value.payload, today } };
}

/** `CoordinatorPort.handle`: the route picks `handleCommand` or `handleQuery`, and every answer goes through ApiResponseBuilder. */
async function handle(ctx: Context, request: RawRequest): Promise<ApiReply> {
  const answer = request.route === 'command' ? await runCommand(ctx, request.body) : await runQuery(ctx, request.body);
  return apiResponseBuilder(answer);
}

/**
 * `startup()` of blueprint 4.2. It loads the store, and a store that is not bootstrapped is seeded: the seed
 * is read, the bootstrap workflow plans the system categories and the pre-load, and the plan is persisted
 * as one ChangeSet, so one write. A store that is bootstrapped is left alone, so starting twice seeds once.
 * An Err stops the start: it is returned to whoever starts the server, who prints it, and no ApiResponse
 * is built.
 */
async function startup(ctx: Context): Promise<Result<Empty, DomainError>> {
  const loaded = await load(ctx);
  if (!loaded.ok) return loaded;
  if (loaded.value.settings.bootstrapped) return DONE;
  const seed = await ctx.seedSource.read();
  if (!seed.ok) return seed;
  const outcome = ctx.reference.bootstrap(seed.value, loaded.value);
  if (!outcome.ok) return outcome;
  return persist(ctx, loaded.value, outcome.value.changeSets ?? []);
}

/**
 * BX-01 BackendCoordinator, the top of the backend. It is the only coordinator that touches the gateways,
 * and it keeps nothing between requests: each request loads the whole snapshot, decides, writes once and
 * answers, so it assumes one request at a time, which the HTTP gateway enforces (blueprint 1.1).
 *
 * It implements `CoordinatorPort.handle`, which runs the pipeline of blueprint 2.3 for a command or a
 * query by the route, and `startup`, which seeds a store that has not been seeded. A failed step becomes an
 * `ApiResponse` with `ok: false`, through ApiResponseBuilder, which also gives the response its HTTP status.
 *
 * The workflows are functions of their own, and the object that this returns only points at them. The
 * gateways arrive as ports, so the same coordinator runs on the in-memory stand-ins and on the real ones.
 */
export function createBackendCoordinator(gateways: Gateways): CoordinatorPort & { startup(): Promise<Result<Empty, DomainError>> } {
  const ctx: Context = {
    ...gateways,
    reference: createReferenceCommandCoordinator(),
    inventory: createInventoryCommandCoordinator(),
    recipe: createRecipeCommandCoordinator(),
    query: createQueryCoordinator(),
  };
  return { handle: (request) => handle(ctx, request), startup: () => startup(ctx) };
}
