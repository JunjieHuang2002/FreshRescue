import { describe, expect, it, vi } from 'vitest';
import type { WriteOps } from '@freshrescue/contract-changeset';
import type { RawStore, Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import { COMMAND_TYPES, QUERY_TYPES } from '@freshrescue/contract-messages';
import type { ApiReply, CommandPayloads, CommandType, QueryParams, QueryType, RouteName } from '@freshrescue/contract-messages';
import type { DateISO, Id, Named, Result } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import type { CatalogDto, CookReportDto, FoodTypeDetailDto, InventoryListDto, RecommendationDto, ReferenceDataDto, WarningPanelDto } from '@freshrescue/contract-views';
import { createFixedClock } from '../gateways/memory/fixedClock';
import { createMemorySeedSource } from '../gateways/memory/memorySeedSource';
import { createMemoryStore } from '../gateways/memory/memoryStore';
import type { SeedSourcePort, StoreReadPort, StoreWritePort } from '../gateways/ports';
import { snapshotInvariantChecker } from '../modules/engine/snapshotInvariantChecker';
import { snapshotParser } from '../modules/parsing/snapshotParser';
import { APPENDIX_A_SEED } from '../testing/fixtures';
import { createBackendCoordinator } from './BackendCoordinator';

// A test double of one decider (plan, phase 6, row 4): while `control.mode` is not 'none', CategoryCreateDecider
// returns a ChangeSet that it should never return. Each mode is one way for it to go wrong, and each is stopped
// by a step of the write path: the applier refuses the first two, and the invariant checker refuses the third.
const control = vi.hoisted(() => ({
  mode: 'none' as 'none' | 'illegal' | 'unknownTarget' | 'conflicting',
  changeSets: {
    // a Food Type in a category that does not exist: the applier takes it, and no snapshot may hold it
    illegal: { ops: [{ kind: 'putFoodType', row: { id: 9_999, name: 'Ghost', categoryId: 999, unit: 'grams', customThresholdDays: null } }] },
    // the delete of a batch that is not there
    unknownTarget: { ops: [{ kind: 'deleteBatch', id: 999 }] },
    // two operations on one record
    conflicting: {
      ops: [
        { kind: 'putFoodCategory', row: { id: 900, name: 'Twin', parentId: null, isSystem: false, customThresholdDays: null } },
        { kind: 'putFoodCategory', row: { id: 900, name: 'Twin', parentId: null, isSystem: false, customThresholdDays: null } },
      ],
    },
  },
  // ChangeSets that CookChangeSetBuilder hands out instead of its own, one for each call, for as long as there are any
  cookSets: [] as { ops: unknown[] }[],
}));

vi.mock('../modules/engine/cookChangeSetBuilder', async (importOriginal) => {
  const original = await importOriginal<typeof import('../modules/engine/cookChangeSetBuilder')>();
  return {
    cookChangeSetBuilder: (...args: Parameters<typeof original.cookChangeSetBuilder>) => {
      const next = control.cookSets.shift();
      return next === undefined ? original.cookChangeSetBuilder(...args) : { ok: true, value: next };
    },
  };
});

vi.mock('../modules/decide/categoryCreateDecider', async (importOriginal) => {
  const original = await importOriginal<typeof import('../modules/decide/categoryCreateDecider')>();
  return {
    categoryCreateDecider: (...args: Parameters<typeof original.categoryCreateDecider>) =>
      control.mode === 'none' ? original.categoryCreateDecider(...args) : { ok: true, value: control.changeSets[control.mode] },
  };
});

const TODAY: DateISO = '2026-10-01';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const fails = (code: DomainError['code'], detail: string = code): Result<never, DomainError> => ({ ok: false, err: { code, detail } });
const idOf = (rows: readonly Named[], name: string): Id => rows.find((row) => row.name === name)?.id ?? expect.unreachable(`there is no "${name}"`);

// ---- the world: the coordinator over the in-memory gateways, with counters on what it does -----------------------

type Options = {
  readonly today?: DateISO;
  readonly seed?: unknown;
  /** The nth call of `apply` (counting from 1) answers STORE_WRITE_FAILED and changes nothing. */
  readonly failWriteOnCall?: number;
  /** Every read answers this, and the store is not read. */
  readonly readAnswer?: Result<RawStore | null, DomainError>;
  /** Every read of the seed answers this. */
  readonly seedAnswer?: Result<unknown, DomainError>;
};

type World = ReturnType<typeof setup>;

function setup(options: Options = {}) {
  const memory = createMemoryStore();
  const counts = { reads: 0, writeCalls: 0, seedReads: 0 };
  const faults: { failWriteOnCall: number | undefined } = { failWriteOnCall: options.failWriteOnCall };
  const writes: WriteOps[] = [];
  const storeRead: StoreReadPort = {
    read: async () => {
      counts.reads += 1;
      return options.readAnswer ?? memory.read();
    },
  };
  const storeWrite: StoreWritePort = {
    apply: async (ops) => {
      counts.writeCalls += 1;
      writes.push(ops);
      return counts.writeCalls === faults.failWriteOnCall ? fails('STORE_WRITE_FAILED', 'the disk is full') : memory.apply(ops);
    },
  };
  const seedSource: SeedSourcePort = {
    read: async () => {
      counts.seedReads += 1;
      // `seed: null` is a seed that is null, so the key is looked for and not the value
      return options.seedAnswer ?? createMemorySeedSource('seed' in options ? options.seed : APPENDIX_A_SEED).read();
    },
  };
  const coordinator = createBackendCoordinator({ storeRead, storeWrite, clock: createFixedClock(options.today ?? TODAY), seedSource });
  return { memory, counts, faults, writes, coordinator, seedSource, today: options.today ?? TODAY };
}

/**
 * The world after a successful start: Appendix A is seeded, and the counters of reads and writes are back at zero.
 * A write fault is armed only after the start, and counts the writes from there.
 */
async function started(options: Options = {}): Promise<World> {
  const world = setup({ ...options, failWriteOnCall: undefined });
  expect((await world.coordinator.startup()).ok).toBe(true);
  world.writes.length = 0;
  world.counts.reads = 0;
  world.counts.writeCalls = 0;
  world.counts.seedReads = 0;
  world.faults.failWriteOnCall = options.failWriteOnCall;
  return world;
}

async function command<T extends CommandType>(world: World, type: T, payload: CommandPayloads[T]): Promise<ApiReply> {
  return world.coordinator.handle({ route: 'command', body: { ok: true, value: JSON.stringify({ type, payload }) } });
}

async function query<T extends QueryType>(world: World, type: T, params: QueryParams[T]): Promise<ApiReply> {
  return world.coordinator.handle({ route: 'query', body: { ok: true, value: JSON.stringify({ type, params }) } });
}

/** A request whose body text is sent as it is when it is a string, and as JSON otherwise. */
async function post(world: World, route: RouteName, message: unknown): Promise<ApiReply> {
  return world.coordinator.handle({ route, body: { ok: true, value: typeof message === 'string' ? message : JSON.stringify(message) } });
}

/** What a success reply carries: the data, after its status and its date have been checked. */
function dataOf(reply: ApiReply, today: DateISO = TODAY): unknown {
  expect(reply.status).toBe(200);
  if (!reply.response.ok) return expect.unreachable(`expected a success, but got ${reply.response.error.code}: ${reply.response.error.detail}`);
  expect(reply.response.meta.today).toBe(today);
  return reply.response.data;
}

/** What a failure reply carries: its status, its code and family, and the date, which is null on every failure. */
function failureOf(reply: ApiReply): { status: number; code: string; family: string; today: DateISO | null } {
  if (reply.response.ok) return expect.unreachable('expected a failure, but got a success');
  return { status: reply.status, code: reply.response.error.code, family: reply.response.error.family, today: reply.response.meta.today };
}

const storedDocument = async (world: World): Promise<RawStore | null> => valueOf(await world.memory.read());
const snapshotOf = async (world: World): Promise<Snapshot> => valueOf(snapshotParser(await storedDocument(world)));

const inboundOf = (foodName: string, quantity: number, days: number): CommandPayloads['InboundBatch'] => ({
  foodTypeId: null,
  foodName,
  categoryId: null,
  unit: null,
  quantity,
  expiry: { days },
});

/** Stock added through the port, as a user would: an inbound by name, which has to succeed. */
async function stock(world: World, foodName: string, quantity: number, days: number): Promise<void> {
  dataOf(await command(world, 'InboundBatch', inboundOf(foodName, quantity, days)), world.today);
}

// ---- one success scenario for each message ------------------------------------------------------------------

type Scenario = (world: World) => Promise<void>;

const COMMAND_SCENARIOS: Record<CommandType, Scenario> = {
  SaveCategory: async (world) => {
    const before = await snapshotOf(world);

    const created = await command(world, 'SaveCategory', { scope: 'foodCategory', categoryId: null, parentId: null, name: 'Fruit' });
    expect(dataOf(created)).toEqual({ categoryId: before.counters.nextId });
    const renamed = await command(world, 'SaveCategory', { scope: 'foodCategory', categoryId: before.counters.nextId, parentId: null, name: 'Fresh Fruit' });
    expect(dataOf(renamed)).toEqual({ categoryId: before.counters.nextId });

    expect((await snapshotOf(world)).foodCategories.at(-1)).toMatchObject({ id: before.counters.nextId, name: 'Fresh Fruit', parentId: null, isSystem: false });
  },
  DeleteCategory: async (world) => {
    const before = await snapshotOf(world);

    expect(dataOf(await command(world, 'DeleteCategory', { scope: 'foodCategory', categoryId: idOf(before.foodCategories, 'Meat') }))).toEqual({});

    const after = await snapshotOf(world);
    expect(after.foodCategories.map((category) => category.name)).toEqual(['Other', 'Dairy', 'Liquid Dairy', 'Vegetables', 'Leafy Greens']);
    expect(after.foodTypes.filter((foodType) => ['Beef', 'Chicken'].includes(foodType.name)).map((foodType) => foodType.categoryId)).toEqual([
      SYSTEM_IDS.FOOD_OTHER,
      SYSTEM_IDS.FOOD_OTHER,
    ]);
  },
  SetCategoryThreshold: async (world) => {
    const before = await snapshotOf(world);
    const dairy = idOf(before.foodCategories, 'Dairy');

    expect(dataOf(await command(world, 'SetCategoryThreshold', { categoryId: dairy, thresholdDays: 5 }))).toEqual({});

    expect((await snapshotOf(world)).foodCategories.find((category) => category.id === dairy)?.customThresholdDays).toBe(5);
    // Milk is in Liquid Dairy, a Child of Dairy, so the threshold is its Parent's
    const detail = dataOf(await query(world, 'GetFoodTypeDetail', { foodTypeId: idOf(before.foodTypes, 'Milk') })) as FoodTypeDetailDto;
    expect(detail.threshold).toEqual({ days: 5, source: 'parent' });
  },
  SaveFoodType: async (world) => {
    const before = await snapshotOf(world);

    const created = await command(world, 'SaveFoodType', { foodTypeId: null, name: 'Salt', categoryId: null, unit: 'grams', thresholdDays: null });
    expect(dataOf(created)).toEqual({ foodTypeId: before.counters.nextId });
    const edited = await command(world, 'SaveFoodType', { foodTypeId: before.counters.nextId, name: 'Sea Salt', categoryId: idOf(before.foodCategories, 'Vegetables'), unit: null, thresholdDays: 30 });
    expect(dataOf(edited)).toEqual({ foodTypeId: before.counters.nextId });

    expect((await snapshotOf(world)).foodTypes.at(-1)).toEqual({
      id: before.counters.nextId,
      name: 'Sea Salt',
      categoryId: idOf(before.foodCategories, 'Vegetables'),
      unit: 'grams',
      customThresholdDays: 30,
    });
  },
  ChangeFoodTypeUnit: async (world) => {
    await stock(world, 'Chicken', 100_000, 10);
    await stock(world, 'Chicken', 200_000, 10);
    const before = await snapshotOf(world);
    const [first, second] = before.batches.map((batch) => batch.id);

    const reply = await command(world, 'ChangeFoodTypeUnit', {
      foodTypeId: idOf(before.foodTypes, 'Chicken'),
      unit: 'pieces',
      batches: [{ batchId: first ?? 0, quantity: 500 }, { batchId: second ?? 0, quantity: 1_000 }],
    });

    expect(dataOf(reply)).toEqual({});
    const after = await snapshotOf(world);
    expect(after.foodTypes.find((foodType) => foodType.name === 'Chicken')?.unit).toBe('pieces');
    expect(after.batches.map((batch) => batch.quantity)).toEqual([500, 1_000]);
  },
  DeleteFoodType: async (world) => {
    const before = await snapshotOf(world);
    const tomato = idOf(before.foodTypes, 'Tomato');

    expect(dataOf(await command(world, 'DeleteFoodType', { foodTypeId: tomato }))).toEqual({});

    const after = await snapshotOf(world);
    expect(after.foodTypes.some((foodType) => foodType.id === tomato)).toBe(false);
    expect(after.recipeIngredients.find((row) => row.foodTypeId === tomato)?.deletedFoodTypeName).toBe('Tomato');
    const catalog = dataOf(await query(world, 'GetCatalog', { cuisineId: null })) as CatalogDto;
    expect(catalog.rows.find((row) => row.name === 'Tomato Egg Stir-Fry')?.status).toBe('blocked');
  },
  InboundBatch: async (world) => {
    const reply = await command(world, 'InboundBatch', inboundOf('milk', 500_000, 5));

    expect(dataOf(reply)).toEqual({});
    const after = await snapshotOf(world);
    expect(after.batches).toEqual([
      { id: after.counters.nextId - 1, foodTypeId: idOf(after.foodTypes, 'Milk'), quantity: 500_000, inboundDate: TODAY, expirationDate: '2026-10-06', createdSeq: 1 },
    ]);
  },
  EditBatchQuantity: async (world) => {
    await stock(world, 'Milk', 500_000, 5);
    const [batch] = (await snapshotOf(world)).batches;

    expect(dataOf(await command(world, 'EditBatchQuantity', { batchId: batch?.id ?? 0, quantity: 750_000 }))).toEqual({});

    expect((await snapshotOf(world)).batches).toEqual([{ ...batch, quantity: 750_000 }]);
  },
  RemoveBatch: async (world) => {
    await stock(world, 'Milk', 500_000, 5);
    const [batch] = (await snapshotOf(world)).batches;

    expect(dataOf(await command(world, 'RemoveBatch', { batchId: batch?.id ?? 0 }))).toEqual({});

    const after = await snapshotOf(world);
    expect(after.batches).toEqual([]);
    expect(after.foodTypes.some((foodType) => foodType.name === 'Milk')).toBe(true);
  },
  SaveRecipe: async (world) => {
    const before = await snapshotOf(world);
    const [beef, rice] = [idOf(before.foodTypes, 'Beef'), idOf(before.foodTypes, 'Rice')];
    const draft = { cuisineId: null, rows: [{ foodTypeId: beef, quantity: 100_000, unit: 'grams' }] };

    const created = await command(world, 'SaveRecipe', { recipeId: null, name: 'Beef Plate', draft });
    expect(dataOf(created)).toEqual({ recipeId: before.counters.nextId });
    const edited = await command(world, 'SaveRecipe', {
      recipeId: before.counters.nextId,
      name: 'Beef Rice Plate',
      draft: { cuisineId: idOf(before.recipeCategories, 'Chinese Cuisine'), rows: [...draft.rows, { foodTypeId: rice, quantity: 200_000, unit: 'grams' }] },
    });
    expect(dataOf(edited)).toEqual({ recipeId: before.counters.nextId });

    const after = await snapshotOf(world);
    expect(after.recipes.at(-1)).toEqual({ id: before.counters.nextId, name: 'Beef Rice Plate', recipeCategoryId: idOf(before.recipeCategories, 'Chinese Cuisine') });
    expect(after.recipeIngredients.filter((row) => row.recipeId === before.counters.nextId).map((row) => row.foodTypeId)).toEqual([beef, rice]);
  },
  DeleteRecipe: async (world) => {
    const before = await snapshotOf(world);
    const recipe = idOf(before.recipes, 'Tomato Egg Stir-Fry');

    expect(dataOf(await command(world, 'DeleteRecipe', { recipeId: recipe }))).toEqual({});

    const after = await snapshotOf(world);
    expect(after.recipes.some((candidate) => candidate.id === recipe)).toBe(false);
    expect(after.recipeIngredients.some((row) => row.recipeId === recipe)).toBe(false);
  },
  CookRecipes: async (world) => {
    // spec 4.5: the recipe needs 300 g of Beef and 200 g of Broccoli, and the fridge holds 150 g and 250 g
    await stock(world, 'Beef', 150_000, 30);
    await stock(world, 'Broccoli', 250_000, 30);
    const before = await snapshotOf(world);

    const reply = await command(world, 'CookRecipes', { recipeIds: [idOf(before.recipes, 'Beef and Broccoli Stir-Fry')] });

    const report = (dataOf(reply) as CookReportDto).reports[0];
    expect(report).toMatchObject({ recipeName: 'Beef and Broccoli Stir-Fry', outcome: 'cooked', reason: null });
    expect(report?.deducted).toEqual([{ foodTypeId: idOf(before.foodTypes, 'Broccoli'), name: 'Broccoli', quantity: 200_000, unit: 'grams' }]);
    expect(report?.missing).toEqual([{ foodTypeId: idOf(before.foodTypes, 'Beef'), name: 'Beef', needed: 300_000, available: 150_000, unit: 'grams' }]);
    const after = await snapshotOf(world);
    expect(after.batches.map((batch) => batch.quantity)).toEqual([150_000, 50_000]);
  },
  SetSimulatedToday: async (world) => {
    expect(dataOf(await command(world, 'SetSimulatedToday', { date: '2026-10-05' }))).toEqual({});

    expect((await snapshotOf(world)).settings).toEqual({ simulatedToday: '2026-10-05', bootstrapped: true });
    // the next request resolves today from it, and its reply says so
    const reference = dataOf(await query(world, 'GetReferenceData', {}), '2026-10-05') as ReferenceDataDto;
    expect(reference).toMatchObject({ today: '2026-10-05', simulatedToday: '2026-10-05' });
    expect(dataOf(await command(world, 'SetSimulatedToday', { date: null }), '2026-10-05')).toEqual({});
    expect(dataOf(await query(world, 'GetReferenceData', {}))).toMatchObject({ today: TODAY, simulatedToday: null });
  },
};

const QUERY_SCENARIOS: Record<QueryType, Scenario> = {
  GetReferenceData: async (world) => {
    const reference = dataOf(await query(world, 'GetReferenceData', {})) as ReferenceDataDto;

    expect(reference).toMatchObject({ today: TODAY, simulatedToday: null, globalThresholdDays: 3 });
    expect(reference.foodTypes).toHaveLength(8);
    expect(reference.cuisines.map((cuisine) => cuisine.name)).toEqual(['Chinese Cuisine', 'Vietnamese Cuisine', 'French Cuisine', 'Other']);
  },
  GetInventoryList: async (world) => {
    await stock(world, 'Chicken', 300_000, 2);

    const list = dataOf(await query(world, 'GetInventoryList', {})) as InventoryListDto;

    expect(list.rows.map((row) => row.name)).toEqual(['Beef', 'Broccoli', 'Chicken', 'Egg', 'Milk', 'Rice', 'Spinach', 'Tomato']);
    expect(list.rows.find((row) => row.name === 'Chicken')).toMatchObject({ total: 300_000, overall: 'nearExpiry', categoryPath: ['Meat', 'Poultry'] });
    expect(list.rows.find((row) => row.name === 'Beef')).toMatchObject({ total: 0, overall: null });
  },
  GetFoodTypeDetail: async (world) => {
    await stock(world, 'Chicken', 300_000, 2);
    const chicken = idOf((await snapshotOf(world)).foodTypes, 'Chicken');

    const detail = dataOf(await query(world, 'GetFoodTypeDetail', { foodTypeId: chicken })) as FoodTypeDetailDto;

    expect(detail).toMatchObject({ foodTypeId: chicken, name: 'Chicken', total: 300_000, threshold: { days: 3, source: 'global' } });
    expect(detail.batches.map((batch) => [batch.daysLeft, batch.status])).toEqual([[2, 'nearExpiry']]);
    expect(detail.referencingRecipes.map((recipe) => recipe.name)).toEqual(['Chicken Broccoli Gratin', 'Chicken Fried Rice', 'Vietnamese Chicken Rice']);
  },
  GetWarningPanel: async (world) => {
    await stock(world, 'Chicken', 300_000, 2);

    const panel = dataOf(await query(world, 'GetWarningPanel', {})) as WarningPanelDto;

    expect(panel.nearExpiry.map((row) => [row.foodTypeName, row.quantity, row.daysLeft])).toEqual([['Chicken', 300_000, 2]]);
    expect(panel.expired).toEqual([]);
  },
  GetRecommendations: async (world) => {
    await stock(world, 'Chicken', 300_000, 2);
    await stock(world, 'Rice', 600_000, 60);
    await stock(world, 'Egg', 4_000, 30);

    const recommendations = dataOf(await query(world, 'GetRecommendations', {})) as RecommendationDto;

    expect(recommendations.tier).toBe('full');
    expect(recommendations.recipes.map((recipe) => recipe.name)).toEqual(['Chicken Fried Rice', 'Vietnamese Chicken Rice']);
  },
  GetCatalog: async (world) => {
    const everything = dataOf(await query(world, 'GetCatalog', { cuisineId: null })) as CatalogDto;
    const french = idOf((await snapshotOf(world)).recipeCategories, 'French Cuisine');
    const filtered = dataOf(await query(world, 'GetCatalog', { cuisineId: french })) as CatalogDto;

    expect(everything.rows).toHaveLength(6);
    expect(everything.rows.every((row) => row.status === 'nothing')).toBe(true);
    expect(filtered.rows.map((row) => row.name)).toEqual(['Chicken Broccoli Gratin', 'Spinach Omelette']);
  },
};

describe('BX-01 BackendCoordinator', () => {
  describe('all 19 messages work through the port (plan, phase 6, row 3)', () => {
    it('has a scenario for exactly the 13 commands and the 6 queries of the contract, and for nothing else', () => {
      expect(Object.keys(COMMAND_SCENARIOS).sort()).toEqual([...COMMAND_TYPES].sort());
      expect(Object.keys(QUERY_SCENARIOS).sort()).toEqual([...QUERY_TYPES].sort());
      expect(COMMAND_TYPES).toHaveLength(13);
      expect(QUERY_TYPES).toHaveLength(6);
    });

    it.each(COMMAND_TYPES)('the command %s succeeds, and the store is a legal one afterwards', async (type) => {
      const world = await started();

      await COMMAND_SCENARIOS[type](world);

      expect(snapshotInvariantChecker(await snapshotOf(world)).ok).toBe(true);
    });

    it.each(QUERY_TYPES)('the query %s succeeds, and the store is a legal one afterwards', async (type) => {
      const world = await started();

      await QUERY_SCENARIOS[type](world);

      expect(snapshotInvariantChecker(await snapshotOf(world)).ok).toBe(true);
    });

    it('answers every one of the six queries from one read of the store, and writes nothing', async () => {
      const world = await started();
      await stock(world, 'Chicken', 300_000, 2);
      const [chicken] = (await snapshotOf(world)).foodTypes.filter((foodType) => foodType.name === 'Chicken');
      const asked: [QueryType, unknown][] = [
        ['GetReferenceData', {}],
        ['GetInventoryList', {}],
        ['GetFoodTypeDetail', { foodTypeId: chicken?.id }],
        ['GetWarningPanel', {}],
        ['GetRecommendations', {}],
        ['GetCatalog', { cuisineId: null }],
      ];
      world.counts.reads = 0;
      const writesBefore = world.counts.writeCalls;

      for (const [type, params] of asked) {
        const reply = await post(world, 'query', { type, params });

        expect(reply.status, type).toBe(200);
      }

      expect(world.counts.reads).toBe(6);
      expect(world.counts.writeCalls).toBe(writesBefore);
    });
  });

  describe('inbound (spec exception rows 3 and 18)', () => {
    it('creates the Food Type and its batch in one write, taking two ids from the counter, and the same name in another case adds a batch to it', async () => {
      const world = await started();
      const before = await snapshotOf(world);
      const mango = before.counters.nextId;

      dataOf(await command(world, 'InboundBatch', { ...inboundOf('Mango', 2_500, 6), unit: 'pieces' }));

      expect(world.writes).toHaveLength(1);
      const afterNew = await snapshotOf(world);
      expect(afterNew.counters).toEqual({ nextId: mango + 2, nextSeq: 2 });
      expect(afterNew.foodTypes.at(-1)).toEqual({ id: mango, name: 'Mango', categoryId: SYSTEM_IDS.FOOD_OTHER, unit: 'pieces', customThresholdDays: null });
      expect(afterNew.batches).toEqual([{ id: mango + 1, foodTypeId: mango, quantity: 2_500, inboundDate: TODAY, expirationDate: '2026-10-07', createdSeq: 1 }]);

      dataOf(await command(world, 'InboundBatch', inboundOf('MANGO', 1_000, 6)));

      expect(world.writes).toHaveLength(2);
      const afterSecond = await snapshotOf(world);
      expect(afterSecond.foodTypes).toHaveLength(afterNew.foodTypes.length);
      expect(afterSecond.batches.map((batch) => batch.foodTypeId)).toEqual([mango, mango]);
      expect(afterSecond.counters).toEqual({ nextId: mango + 3, nextSeq: 3 });
    });

    it('answers NAME_EMPTY (422) to a request that names no Food Type, which is what the form sends when its name is left blank, and writes nothing', async () => {
      const world = await started();
      const before = await storedDocument(world);

      const reply = await command(world, 'InboundBatch', { foodTypeId: null, foodName: null, categoryId: null, unit: 'grams', quantity: 100_000, expiry: { days: 5 } });

      expect(failureOf(reply)).toEqual({ status: 422, code: 'NAME_EMPTY', family: 'validation', today: null });
      expect(await storedDocument(world)).toEqual(before);
      expect(world.writes).toEqual([]);
    });

    it('answers NAME_EMPTY for a name of blanks too', async () => {
      const world = await started();

      const reply = await command(world, 'InboundBatch', { ...inboundOf('   ', 100_000, 5), unit: 'grams' });

      expect(failureOf(reply)).toMatchObject({ status: 422, code: 'NAME_EMPTY' });
    });
  });

  describe('a cook queue (spec exception rows 14, 16 and 21)', () => {
    it('lets two recipes share an ingredient: the first deducts it, the second finds it depleted, deducts none of it, and the queue goes on', async () => {
      const world = await started();
      await stock(world, 'Chicken', 300_000, 30);
      await stock(world, 'Rice', 600_000, 30);
      const before = await snapshotOf(world);
      world.writes.length = 0;

      const reply = await command(world, 'CookRecipes', {
        recipeIds: [idOf(before.recipes, 'Chicken Fried Rice'), idOf(before.recipes, 'Vietnamese Chicken Rice')],
      });

      const [first, second] = (dataOf(reply) as CookReportDto).reports;
      expect(first).toMatchObject({ recipeName: 'Chicken Fried Rice', outcome: 'cooked' });
      expect(first?.deducted.map((line) => [line.name, line.quantity])).toEqual([['Chicken', 200_000], ['Rice', 300_000]]);
      expect(first?.missing).toEqual([{ foodTypeId: idOf(before.foodTypes, 'Egg'), name: 'Egg', needed: 2_000, available: 0, unit: 'pieces' }]);
      expect(second).toMatchObject({ recipeName: 'Vietnamese Chicken Rice', outcome: 'cooked' });
      expect(second?.deducted.map((line) => [line.name, line.quantity])).toEqual([['Rice', 300_000]]);
      expect(second?.missing.map((line) => [line.name, line.needed, line.available])).toEqual([['Chicken', 250_000, 100_000]]);
      const after = await snapshotOf(world);
      expect(after.batches.map((batch) => [batch.foodTypeId, batch.quantity])).toEqual([[idOf(before.foodTypes, 'Chicken'), 100_000]]);
    });

    it('writes each cooked recipe as a unit of its own: two recipes are two writes, in queue order', async () => {
      const world = await started();
      await stock(world, 'Chicken', 300_000, 30);
      await stock(world, 'Rice', 600_000, 30);
      const recipes = (await snapshotOf(world)).recipes;
      world.writes.length = 0;

      await command(world, 'CookRecipes', { recipeIds: [idOf(recipes, 'Chicken Fried Rice'), idOf(recipes, 'Vietnamese Chicken Rice')] });

      expect(world.writes).toHaveLength(2);
      expect(world.writes.every((ops) => ops.every((op) => op.table === 'batches'))).toBe(true);
    });

    it('runs the same recipe twice when it is queued twice, and skips a third run that finds nothing left', async () => {
      const world = await started();
      await stock(world, 'Tomato', 4_000, 30);
      await stock(world, 'Egg', 6_000, 30);
      const tomatoEgg = idOf((await snapshotOf(world)).recipes, 'Tomato Egg Stir-Fry');
      world.writes.length = 0;

      const reply = await command(world, 'CookRecipes', { recipeIds: [tomatoEgg, tomatoEgg, tomatoEgg] });

      const reports = (dataOf(reply) as CookReportDto).reports;
      expect(reports.map((report) => [report.outcome, report.reason])).toEqual([['cooked', null], ['cooked', null], ['skipped', 'nothingAvailable']]);
      expect(world.writes).toHaveLength(2);
      expect((await snapshotOf(world)).batches).toEqual([]);
    });

    it('skips a blocked recipe, a recipe with nothing available and a recipe that was deleted, each with its reason, and the queue goes on to the end', async () => {
      const world = await started();
      await stock(world, 'Chicken', 300_000, 30);
      await stock(world, 'Rice', 600_000, 30);
      const before = await snapshotOf(world);
      const [tomato, chicken, rice] = [idOf(before.foodTypes, 'Tomato'), idOf(before.foodTypes, 'Chicken'), idOf(before.foodTypes, 'Rice')];
      dataOf(await command(world, 'DeleteFoodType', { foodTypeId: tomato }));
      const recipes = before.recipes;
      const gone = idOf(recipes, 'Spinach Omelette');
      dataOf(await command(world, 'DeleteRecipe', { recipeId: gone }));
      world.writes.length = 0;

      const reply = await command(world, 'CookRecipes', {
        recipeIds: [idOf(recipes, 'Tomato Egg Stir-Fry'), gone, idOf(recipes, 'Beef and Broccoli Stir-Fry'), idOf(recipes, 'Vietnamese Chicken Rice')],
      });

      const reports = (dataOf(reply) as CookReportDto).reports;
      expect(reports.map((report) => [report.recipeName, report.outcome, report.reason])).toEqual([
        ['Tomato Egg Stir-Fry', 'skipped', 'blocked'],
        ['', 'skipped', 'recipeNotFound'],
        ['Beef and Broccoli Stir-Fry', 'skipped', 'nothingAvailable'],
        ['Vietnamese Chicken Rice', 'cooked', null],
      ]);
      expect(world.writes).toHaveLength(1);
      expect((await snapshotOf(world)).batches.map((batch) => [batch.foodTypeId, batch.quantity])).toEqual([[chicken, 50_000], [rice, 300_000]]);
    });

    it('keeps a recipe that was written when a later write fails: the reply is that error, and the queue is not rolled back (spec 4.5)', async () => {
      // the calls are counted from the end of the start: two inbounds are calls 1 and 2, the first recipe is call 3, and the second is call 4
      const world = await started({ failWriteOnCall: 4 });
      await stock(world, 'Chicken', 300_000, 30);
      await stock(world, 'Rice', 600_000, 30);
      const recipes = (await snapshotOf(world)).recipes;
      expect(world.counts.writeCalls).toBe(2);

      const reply = await command(world, 'CookRecipes', { recipeIds: [idOf(recipes, 'Chicken Fried Rice'), idOf(recipes, 'Vietnamese Chicken Rice')] });

      expect(failureOf(reply)).toMatchObject({ status: 500, code: 'STORE_WRITE_FAILED' });
      expect(world.counts.writeCalls).toBe(4);
      const after = await snapshotOf(world);
      const quantityOf = (name: string) => after.batches.filter((batch) => batch.foodTypeId === idOf(after.foodTypes, name)).map((batch) => batch.quantity);
      expect(quantityOf('Chicken')).toEqual([100_000]);
      expect(quantityOf('Rice')).toEqual([300_000]);
    });

    it('checks each ChangeSet of a command against the snapshot that the one before it made, and not against the stored one (a test double)', async () => {
      const world = await started();
      await stock(world, 'Tomato', 4_000, 30);
      await stock(world, 'Egg', 6_000, 30);
      const before = await snapshotOf(world);
      const tomatoEgg = idOf(before.recipes, 'Tomato Egg Stir-Fry');
      const { nextId, nextSeq } = before.counters;
      world.writes.length = 0;

      // the first ChangeSet makes a category and the second deletes it, which only what the first one made can take
      control.cookSets.push(
        {
          ops: [
            { kind: 'putCounters', row: { nextId: nextId + 1, nextSeq } },
            { kind: 'putFoodCategory', row: { id: nextId, name: 'Twin', parentId: null, isSystem: false, customThresholdDays: null } },
          ],
        },
        { ops: [{ kind: 'deleteFoodCategory', id: nextId }] },
      );
      const reply = await command(world, 'CookRecipes', { recipeIds: [tomatoEgg, tomatoEgg] }).finally(() => {
        control.cookSets.length = 0;
      });

      expect((dataOf(reply) as CookReportDto).reports.map((report) => report.outcome)).toEqual(['cooked', 'cooked']);
      expect(world.writes).toHaveLength(2);
      const after = await snapshotOf(world);
      expect(after.foodCategories).toEqual(before.foodCategories);
      expect(after.counters.nextId).toBe(nextId + 1);
    });

    it('is a success with no write when every recipe of the queue is skipped, and an empty queue is a success with an empty report', async () => {
      const world = await started();
      const recipes = (await snapshotOf(world)).recipes;

      const skipped = await command(world, 'CookRecipes', { recipeIds: [idOf(recipes, 'Chicken Fried Rice'), 999] });
      const empty = await command(world, 'CookRecipes', { recipeIds: [] });

      expect((dataOf(skipped) as CookReportDto).reports.map((report) => report.outcome)).toEqual(['skipped', 'skipped']);
      expect(dataOf(empty)).toEqual({ reports: [] });
      expect(world.writes).toEqual([]);
    });
  });

  describe('a blocked write (spec exception row 2)', () => {
    it('answers CAP_EXCEEDED to a unit change whose new total is over 500,000, and leaves every batch as it was', async () => {
      const world = await started();
      await stock(world, 'Chicken', 100_000, 30);
      await stock(world, 'Chicken', 200_000, 30);
      const before = await snapshotOf(world);
      const [first, second] = before.batches.map((batch) => batch.id);
      const document = await storedDocument(world);
      world.writes.length = 0;

      const reply = await command(world, 'ChangeFoodTypeUnit', {
        foodTypeId: idOf(before.foodTypes, 'Chicken'),
        unit: 'kg',
        batches: [{ batchId: first ?? 0, quantity: 300_000_000 }, { batchId: second ?? 0, quantity: 200_000_001 }],
      });

      expect(failureOf(reply)).toEqual({ status: 422, code: 'CAP_EXCEEDED', family: 'validation', today: null });
      expect(await storedDocument(world)).toEqual(document);
      expect(world.writes).toEqual([]);
    });

    it('answers CAP_EXCEEDED to an inbound or an edit that would pass the cap, and allows a total of exactly 500,000', async () => {
      const world = await started();
      await stock(world, 'Beef', 450_000_000, 30);
      const [batch] = (await snapshotOf(world)).batches;

      expect(failureOf(await command(world, 'InboundBatch', inboundOf('Beef', 50_000_001, 30))).code).toBe('CAP_EXCEEDED');
      expect(failureOf(await command(world, 'EditBatchQuantity', { batchId: batch?.id ?? 0, quantity: 500_000_001 })).code).toBe('QTY_TOO_LARGE');
      dataOf(await command(world, 'InboundBatch', inboundOf('Beef', 50_000_000, 30)));
      expect(failureOf(await command(world, 'EditBatchQuantity', { batchId: batch?.id ?? 0, quantity: 450_000_001 })).code).toBe('CAP_EXCEEDED');
    });
  });

  describe('failures change nothing (plan, phase 6, row 4)', () => {
    /** A request that must be refused: what it is, the route it is sent to, what it says, and the code of the refusal. */
    type Bad = readonly [title: string, route: RouteName, message: unknown, code: string];

    const inboundMessage = (over: Partial<CommandPayloads['InboundBatch']>) => ({
      type: 'InboundBatch',
      payload: { foodTypeId: null, foodName: 'Chicken', categoryId: null, unit: null, quantity: 1_000, expiry: { days: 5 }, ...over },
    });

    const shapeFaults = (s: Snapshot): Bad[] => [
      ['text that is not JSON', 'command', '{not json', 'BAD_ENVELOPE'],
      ['JSON that is not an envelope', 'command', [], 'BAD_ENVELOPE'],
      ['an envelope with no type', 'command', { payload: {} }, 'BAD_ENVELOPE'],
      ['a command that does not exist', 'command', { type: 'Launch', payload: {} }, 'UNKNOWN_COMMAND'],
      ['a query sent to the command route', 'command', { type: 'GetCatalog', params: { cuisineId: null } }, 'UNKNOWN_COMMAND'],
      ['a field that is missing', 'command', { type: 'RemoveBatch', payload: {} }, 'MISSING_FIELD'],
      ['a field of the wrong type', 'command', { type: 'RemoveBatch', payload: { batchId: 'five' } }, 'WRONG_TYPE'],
      ['a Food Type named by id and by name', 'command', inboundMessage({ foodTypeId: idOf(s.foodTypes, 'Beef'), foodName: 'Beef' }), 'BAD_COMBINATION'],
      ['an expiry of days and a date', 'command', inboundMessage({ expiry: { days: 1, date: '2026-10-05' } as never }), 'BAD_COMBINATION'],
      ['a date that is not on the calendar', 'command', { type: 'SetSimulatedToday', payload: { date: '2026-02-30' } }, 'DATE_INVALID'],
      ['a query that does not exist', 'query', { type: 'GetEverything', params: {} }, 'UNKNOWN_QUERY'],
      ['a command sent to the query route', 'query', { type: 'RemoveBatch', payload: { batchId: 1 } }, 'UNKNOWN_QUERY'],
      ['a query with a parameter missing', 'query', { type: 'GetFoodTypeDetail', params: {} }, 'MISSING_FIELD'],
    ];

    const validationFaults = (s: Snapshot): Bad[] => {
      const saveCategory = (name: string) => ({ type: 'SaveCategory', payload: { scope: 'foodCategory', categoryId: null, parentId: null, name } });
      const saveFoodType = (over: Partial<CommandPayloads['SaveFoodType']>) => ({
        type: 'SaveFoodType',
        payload: { foodTypeId: null, name: 'Salt', categoryId: null, unit: 'grams', thresholdDays: null, ...over },
      });
      return [
        ['a category name of blanks', 'command', saveCategory('   '), 'NAME_EMPTY'],
        ['a category name over 200 characters', 'command', saveCategory('x'.repeat(201)), 'NAME_TOO_LONG'],
        ['a category called Other', 'command', saveCategory('Other'), 'NAME_RESERVED'],
        ['a Food Type name that is taken, in another case', 'command', saveFoodType({ name: 'chicken' }), 'NAME_DUPLICATE'],
        ['a quantity of 0', 'command', inboundMessage({ quantity: 0 }), 'QTY_NOT_POSITIVE'],
        ['a quantity that is not whole', 'command', inboundMessage({ quantity: 1.5 }), 'QTY_NOT_INTEGER'],
        ['a quantity over 500,000', 'command', inboundMessage({ quantity: 500_000_001 }), 'QTY_TOO_LARGE'],
        ['a unit that is not on the list', 'command', saveFoodType({ unit: 'dozen' }), 'UNIT_UNKNOWN'],
        ['a threshold of 0 days', 'command', { type: 'SetCategoryThreshold', payload: { categoryId: idOf(s.foodCategories, 'Dairy'), thresholdDays: 0 } }, 'THRESHOLD_INVALID'],
        ['a shelf life of -1 day', 'command', inboundMessage({ expiry: { days: -1 } }), 'DAYS_INVALID'],
        ['an expiration date that has passed', 'command', inboundMessage({ expiry: { date: '2026-09-30' } }), 'PAST_EXPIRY'],
        ['a total over the cap', 'command', inboundMessage({ foodName: 'Beef', quantity: 50_000_001 }), 'CAP_EXCEEDED'],
        [
          'a recipe name that is taken',
          'command',
          { type: 'SaveRecipe', payload: { recipeId: null, name: 'chicken fried rice', draft: { cuisineId: null, rows: [{ foodTypeId: idOf(s.foodTypes, 'Beef'), quantity: 1_000, unit: 'grams' }] } } },
          'NAME_DUPLICATE',
        ],
      ];
    };

    const ruleFaults = (s: Snapshot): Bad[] => {
      const [chicken, beef] = [idOf(s.foodTypes, 'Chicken'), idOf(s.foodTypes, 'Beef')];
      const draft = (rows: unknown[]) => ({ type: 'SaveRecipe', payload: { recipeId: null, name: 'New Recipe', draft: { cuisineId: null, rows } } });
      const beefRow = { foodTypeId: beef, quantity: 1_000, unit: 'grams' };
      return [
        ['a Child under a Child', 'command', { type: 'SaveCategory', payload: { scope: 'foodCategory', categoryId: null, parentId: idOf(s.foodCategories, 'Red Meat'), name: 'Steak' } }, 'PARENT_INVALID'],
        ['a category that is not there', 'command', { type: 'DeleteCategory', payload: { scope: 'foodCategory', categoryId: 999 } }, 'CATEGORY_NOT_FOUND'],
        ['the category Other deleted', 'command', { type: 'DeleteCategory', payload: { scope: 'foodCategory', categoryId: SYSTEM_IDS.FOOD_OTHER } }, 'SYSTEM_PROTECTED'],
        ['a threshold on Other', 'command', { type: 'SetCategoryThreshold', payload: { categoryId: SYSTEM_IDS.FOOD_OTHER, thresholdDays: 3 } }, 'THRESHOLD_FORBIDDEN'],
        ['a Food Type that is not there', 'command', { type: 'DeleteFoodType', payload: { foodTypeId: 999 } }, 'FOOD_TYPE_NOT_FOUND'],
        ['a Food Type that still has a batch', 'command', { type: 'DeleteFoodType', payload: { foodTypeId: chicken } }, 'HAS_BATCHES'],
        ['an inbound for a Food Type that is not there', 'command', inboundMessage({ foodTypeId: 999, foodName: null }), 'FOOD_TYPE_NOT_FOUND'],
        ['a new Food Type in a category that is not there', 'command', inboundMessage({ foodName: 'Mango', unit: 'pieces', categoryId: 999 }), 'CATEGORY_NOT_FOUND'],
        ['a batch that is not there', 'command', { type: 'RemoveBatch', payload: { batchId: 999 } }, 'BATCH_NOT_FOUND'],
        ['a recipe that is not there', 'command', { type: 'DeleteRecipe', payload: { recipeId: 999 } }, 'RECIPE_NOT_FOUND'],
        [
          'a unit change to the unit it has',
          'command',
          { type: 'ChangeFoodTypeUnit', payload: { foodTypeId: chicken, unit: 'grams', batches: s.batches.filter((b) => b.foodTypeId === chicken).map((b) => ({ batchId: b.id, quantity: 1_000 })) } },
          'UNIT_UNCHANGED',
        ],
        ['a unit change that leaves a batch out', 'command', { type: 'ChangeFoodTypeUnit', payload: { foodTypeId: chicken, unit: 'kg', batches: [] } }, 'BATCH_SET_MISMATCH'],
        ['a recipe with no ingredient', 'command', draft([]), 'NO_INGREDIENTS'],
        ['a recipe with the same Food Type twice', 'command', draft([beefRow, beefRow]), 'DUP_INGREDIENT'],
        ['a recipe with a Food Type that is not there', 'command', draft([{ ...beefRow, foodTypeId: 999 }]), 'UNKNOWN_FOOD_TYPE'],
        ['the detail of a Food Type that is not there', 'query', { type: 'GetFoodTypeDetail', params: { foodTypeId: 999 } }, 'FOOD_TYPE_NOT_FOUND'],
        ['the catalog of a cuisine that is not there', 'query', { type: 'GetCatalog', params: { cuisineId: 999 } }, 'CATEGORY_NOT_FOUND'],
      ];
    };

    /** Sends each request of the table to a world with stock, and checks the refusal and that the store and its writes are untouched. */
    async function allRefused(faults: (s: Snapshot) => Bad[], status: number, family: string): Promise<void> {
      const world = await started();
      await stock(world, 'Chicken', 100_000, 30);
      await stock(world, 'Beef', 450_000_000, 30);
      world.writes.length = 0;
      const snapshot = await snapshotOf(world);
      const document = await storedDocument(world);

      for (const [title, route, message, code] of faults(snapshot)) {
        const reply = await post(world, route, message);

        expect(failureOf(reply), title).toEqual({ status, code, family, today: null });
        expect(await storedDocument(world), `${title}: the store`).toEqual(document);
        expect(world.writes, `${title}: the writes`).toEqual([]);
      }
    }

    it('answers 400 with a shape code to a request that is not well formed', () => allRefused(shapeFaults, 400, 'shape'));

    it('answers 422 with a validation code to a value that breaks a rule of the input dictionary', () => allRefused(validationFaults, 422, 'validation'));

    it('answers 409 with a rules code to a request that a business rule refuses', () => allRefused(ruleFaults, 409, 'rules'));

    it('stops at the first error, so a request that cannot be parsed costs no read of the store', async () => {
      const world = await started();

      for (const [, route, message] of shapeFaults(await snapshotOf(world))) await post(world, route, message);

      // the snapshotOf above reads the memory store itself, and not through the port that counts
      expect(world.counts.reads).toBe(0);
    });

    it('answers 413 to a body that was too large, which the HTTP gateway reports as a failure of the request, and reads nothing', async () => {
      const world = await started();

      for (const route of ['command', 'query'] as const) {
        const reply = await world.coordinator.handle({ route, body: fails('PAYLOAD_TOO_LARGE', 'the body is over the limit') });

        expect(failureOf(reply)).toEqual({ status: 413, code: 'PAYLOAD_TOO_LARGE', family: 'io', today: null });
      }
      expect(world.counts.reads).toBe(0);
    });

    it('answers 503 when the store cannot be read, to a command and to a query, and writes nothing', async () => {
      const world = setup({ readAnswer: fails('STORE_UNAVAILABLE', 'the database is down') });

      const sent = await command(world, 'SetSimulatedToday', { date: null });
      const asked = await query(world, 'GetCatalog', { cuisineId: null });

      expect(failureOf(sent)).toEqual({ status: 503, code: 'STORE_UNAVAILABLE', family: 'io', today: null });
      expect(failureOf(asked)).toEqual({ status: 503, code: 'STORE_UNAVAILABLE', family: 'io', today: null });
      expect(world.writes).toEqual([]);
    });

    it('answers 500 when the store holds a document that is not a snapshot: CORRUPT_STORE for what is no object, SCHEMA_MISMATCH for what is the wrong object', async () => {
      const notAnObject = setup({ readAnswer: { ok: true, value: 'not a document' as never } });
      const wrongObject = setup({ readAnswer: { ok: true, value: { foodCategories: 'nope' } } });

      expect(failureOf(await query(notAnObject, 'GetCatalog', { cuisineId: null }))).toMatchObject({ status: 500, code: 'CORRUPT_STORE' });
      expect(failureOf(await command(wrongObject, 'SetSimulatedToday', { date: null }))).toMatchObject({ status: 500, code: 'SCHEMA_MISMATCH' });
      expect(wrongObject.writes).toEqual([]);
    });

    it('answers 500 STORE_WRITE_FAILED when the write fails, and the store is as it was', async () => {
      const world = await started({ failWriteOnCall: 1 });
      const before = await storedDocument(world);

      const reply = await command(world, 'SaveCategory', { scope: 'foodCategory', categoryId: null, parentId: null, name: 'Fruit' });

      expect(failureOf(reply)).toEqual({ status: 500, code: 'STORE_WRITE_FAILED', family: 'io', today: null });
      expect(await storedDocument(world)).toEqual(before);
      expect(dataOf(await command(world, 'SaveCategory', { scope: 'foodCategory', categoryId: null, parentId: null, name: 'Fruit' }))).toEqual({
        categoryId: (await snapshotOf(world)).counters.nextId - 1,
      });
    });

    it('answers 500 INVARIANT_BROKEN when a decider proposes an illegal ChangeSet (a test double), and writes nothing', async () => {
      const world = await started();
      const before = await storedDocument(world);

      control.mode = 'illegal';
      const reply = await command(world, 'SaveCategory', { scope: 'foodCategory', categoryId: null, parentId: null, name: 'Fruit' }).finally(() => {
        control.mode = 'none';
      });

      expect(failureOf(reply)).toEqual({ status: 500, code: 'INVARIANT_BROKEN', family: 'rules', today: null });
      expect(reply.response.ok ? '' : reply.response.error.detail).toContain('[foodTypeCategory]');
      expect(await storedDocument(world)).toEqual(before);
      expect(world.writes).toEqual([]);
      // with the double off, the same request is legal
      expect(dataOf(await command(world, 'SaveCategory', { scope: 'foodCategory', categoryId: null, parentId: null, name: 'Fruit' }))).toBeDefined();
    });

    it('answers 500 with the code of the applier when a decider proposes a ChangeSet that cannot be applied at all, and writes nothing', async () => {
      const world = await started();
      const before = await storedDocument(world);

      for (const [mode, code] of [['unknownTarget', 'UNKNOWN_TARGET'], ['conflicting', 'CONFLICTING_OPS']] as const) {
        control.mode = mode;
        const reply = await command(world, 'SaveCategory', { scope: 'foodCategory', categoryId: null, parentId: null, name: 'Fruit' }).finally(() => {
          control.mode = 'none';
        });

        expect(failureOf(reply), mode).toEqual({ status: 500, code, family: 'rules', today: null });
      }

      expect(await storedDocument(world)).toEqual(before);
      expect(world.writes).toEqual([]);
    });

    it('answers 500 INVARIANT_BROKEN to a shelf life of 3,000,000 days, which would make a date that no store can hold, and writes nothing', async () => {
      const world = await started();
      const before = await storedDocument(world);

      const reply = await command(world, 'InboundBatch', inboundOf('Chicken', 1_000, 3_000_000));

      expect(failureOf(reply)).toEqual({ status: 500, code: 'INVARIANT_BROKEN', family: 'rules', today: null });
      expect(reply.response.ok ? '' : reply.response.error.detail).toContain('[dates]');
      expect(await storedDocument(world)).toEqual(before);
      expect(world.writes).toEqual([]);
    });
  });

  describe('startup seeds an empty store once (plan, phase 6, row 5)', () => {
    it('adds the two system categories and the seed bundle in one write, and the store is then bootstrapped', async () => {
      const world = setup();

      const result = await world.coordinator.startup();

      expect(result).toEqual({ ok: true, value: {} });
      expect(world.writes).toHaveLength(1);
      const ops = world.writes[0] ?? [];
      const rowsOf = (table: string) => ops.filter((op) => op.table === table && op.op === 'put');
      expect(rowsOf('foodCategories')).toHaveLength(8);
      expect(rowsOf('recipeCategories')).toHaveLength(4);
      expect(rowsOf('foodTypes')).toHaveLength(8);
      expect(rowsOf('recipes')).toHaveLength(6);
      expect(rowsOf('recipeIngredients')).toHaveLength(15);
      expect(rowsOf('batches')).toHaveLength(0);
      const stored = await snapshotOf(world);
      expect(stored.foodCategories[0]).toMatchObject({ id: SYSTEM_IDS.FOOD_OTHER, name: 'Other', isSystem: true });
      expect(stored.recipeCategories[0]).toMatchObject({ id: SYSTEM_IDS.CUISINE_OTHER, name: 'Other', isSystem: true });
      expect(stored.settings).toEqual({ simulatedToday: null, bootstrapped: true });
      expect(snapshotInvariantChecker(stored).ok).toBe(true);
    });

    it('adds nothing on a second start, by the same coordinator or by a new one over the same store, which is a restart', async () => {
      const world = setup();
      await world.coordinator.startup();
      const once = await storedDocument(world);

      await world.coordinator.startup();
      const restarted = createBackendCoordinator({
        storeRead: world.memory,
        storeWrite: world.memory,
        clock: createFixedClock(TODAY),
        seedSource: world.seedSource,
      });
      const restart = await restarted.startup();

      expect(restart).toEqual({ ok: true, value: {} });
      expect(world.writes).toHaveLength(1);
      expect(await storedDocument(world)).toEqual(once);
      expect((await snapshotOf(world)).foodTypes).toHaveLength(8);
    });

    it('does not even read the seed when the store is bootstrapped already', async () => {
      const world = setup();
      await world.coordinator.startup();
      expect(world.counts.seedReads).toBe(1);

      await world.coordinator.startup();

      expect(world.counts.seedReads).toBe(1);
    });

    it('seeds the same data every time: the ids come from the counters, from the first free id', async () => {
      const first = setup();
      const second = setup({ today: '2026-12-24' });

      await first.coordinator.startup();
      await second.coordinator.startup();

      expect(await storedDocument(first)).toEqual(await storedDocument(second));
      expect((await snapshotOf(first)).counters).toEqual({ nextId: 27, nextSeq: 1 });
    });

    it('stops the start with SEED_UNREADABLE when the seed cannot be read, and writes nothing', async () => {
      const world = setup({ seedAnswer: fails('SEED_UNREADABLE', 'the seed file is missing') });

      const result = await world.coordinator.startup();

      expect(result).toEqual({ ok: false, err: { code: 'SEED_UNREADABLE', detail: 'the seed file is missing' } });
      expect(world.writes).toEqual([]);
      expect(valueOf(await world.memory.read())).toBeNull();
    });

    it('stops the start with the code of SeedBundleParser when the seed is not a seed, and writes nothing', async () => {
      const code = async (seed: unknown): Promise<string> => {
        const world = setup({ seed });
        const result = await world.coordinator.startup();
        expect(world.writes, 'the writes').toEqual([]);
        return result.ok ? 'ok' : result.err.code;
      };

      expect(await code(null)).toBe('BAD_SEED');
      expect(await code({ ...APPENDIX_A_SEED, foodTypes: [...APPENDIX_A_SEED.foodTypes, APPENDIX_A_SEED.foodTypes[0]] })).toBe('DUP_SEED_KEY');
      expect(await code({ ...APPENDIX_A_SEED, foodCategories: [{ key: 'orphan', name: 'Orphan', parentKey: 'nobody' }] })).toBe('SEED_BAD_CATEGORY');
      expect(await code({ ...APPENDIX_A_SEED, recipes: [{ key: 'soup', name: 'Soup', cuisineKey: null, ingredients: [{ foodTypeKey: 'nobody', quantity: 1_000, unit: 'grams' }] }] })).toBe(
        'SEED_BAD_FOODTYPE',
      );
    });

    it('stops the start with STORE_UNAVAILABLE when the store cannot be read, and reads no seed', async () => {
      const world = setup({ readAnswer: fails('STORE_UNAVAILABLE', 'the database is down') });

      const result = await world.coordinator.startup();

      expect(result).toMatchObject({ ok: false, err: { code: 'STORE_UNAVAILABLE' } });
      expect(world.counts.seedReads).toBe(0);
    });

    it('stops the start with STORE_WRITE_FAILED when the seed cannot be written, and the store is still empty, so that the next start seeds it again', async () => {
      const world = setup({ failWriteOnCall: 1 });

      const failed = await world.coordinator.startup();
      expect(failed).toMatchObject({ ok: false, err: { code: 'STORE_WRITE_FAILED' } });
      expect(valueOf(await world.memory.read())).toBeNull();

      expect((await world.coordinator.startup()).ok).toBe(true);
      expect((await snapshotOf(world)).settings.bootstrapped).toBe(true);
    });

    it('stops the start with CORRUPT_STORE or SCHEMA_MISMATCH when the store holds a document that is not a snapshot, and writes nothing', async () => {
      const corrupt = setup({ readAnswer: { ok: true, value: 'not a document' as never } });
      const mismatch = setup({ readAnswer: { ok: true, value: { foodCategories: 'nope' } } });

      expect(await corrupt.coordinator.startup()).toMatchObject({ ok: false, err: { code: 'CORRUPT_STORE' } });
      expect(await mismatch.coordinator.startup()).toMatchObject({ ok: false, err: { code: 'SCHEMA_MISMATCH' } });
      expect([...corrupt.writes, ...mismatch.writes]).toEqual([]);
    });

    it('builds no ApiResponse: it returns the Err to whoever starts the server, who prints it', async () => {
      const world = setup({ seedAnswer: fails('SEED_UNREADABLE') });

      const result = await world.coordinator.startup();

      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty('response');
      expect(result).not.toHaveProperty('status');
    });
  });

  describe('time, and nothing kept between requests', () => {
    it('reads the store again for each request, so a row written behind its back is there for the next one', async () => {
      const world = await started();
      const before = await snapshotOf(world);

      await world.memory.apply([
        { op: 'put', table: 'foodTypes', row: { id: before.counters.nextId, name: 'Salt', categoryId: SYSTEM_IDS.FOOD_OTHER, unit: 'grams', customThresholdDays: null } },
        { op: 'put', table: 'counters', row: { nextId: before.counters.nextId + 1, nextSeq: 1 } },
      ]);

      const list = dataOf(await query(world, 'GetInventoryList', {})) as InventoryListDto;
      expect(list.rows.some((row) => row.name === 'Salt')).toBe(true);
    });

    it('reads the store once for each request, and writes once for each command that changes it, and never for a query', async () => {
      const world = await started();

      await query(world, 'GetCatalog', { cuisineId: null });
      expect([world.counts.reads, world.counts.writeCalls]).toEqual([1, 0]);

      await command(world, 'SetSimulatedToday', { date: '2026-10-02' });
      expect([world.counts.reads, world.counts.writeCalls]).toEqual([2, 1]);

      await command(world, 'SaveCategory', { scope: 'cuisine', categoryId: null, parentId: null, name: 'Thai Cuisine' });
      expect([world.counts.reads, world.counts.writeCalls]).toEqual([3, 2]);
    });

    it('lets a day go by: a coordinator with a later clock over the same store sees the batch Expired (spec exception row 20)', async () => {
      const world = await started();
      await stock(world, 'Chicken', 300_000, 3);
      const onDay = (today: DateISO) =>
        createBackendCoordinator({ storeRead: world.memory, storeWrite: world.memory, clock: createFixedClock(today), seedSource: world.seedSource });
      const statusOn = async (today: DateISO): Promise<[string | undefined, string]> => {
        const reply = await onDay(today).handle({ route: 'query', body: { ok: true, value: JSON.stringify({ type: 'GetInventoryList', params: {} }) } });
        const rows = (dataOf(reply, today) as InventoryListDto).rows;
        return [rows.find((row) => row.name === 'Chicken')?.overall ?? undefined, today];
      };

      expect(await statusOn('2026-10-01')).toEqual(['nearExpiry', '2026-10-01']);
      expect(await statusOn('2026-10-04')).toEqual(['nearExpiry', '2026-10-04']);
      expect(await statusOn('2026-10-05')).toEqual(['expired', '2026-10-05']);
    });

    it('stamps a new batch with the date that was resolved for the request: Simulated Today replaces the device date', async () => {
      const world = await started();
      await command(world, 'SetSimulatedToday', { date: '2026-12-30' });

      dataOf(await command(world, 'InboundBatch', inboundOf('Chicken', 1_000, 3)), '2026-12-30');

      expect((await snapshotOf(world)).batches[0]).toMatchObject({ inboundDate: '2026-12-30', expirationDate: '2027-01-02' });
    });

    it('refuses a past expiry against the resolved date too: a date that is fine on the device date is past on Simulated Today', async () => {
      const world = await started();
      await command(world, 'SetSimulatedToday', { date: '2026-12-30' });

      const reply = await command(world, 'InboundBatch', { ...inboundOf('Chicken', 1_000, 0), expiry: { date: '2026-12-01' } });

      expect(failureOf(reply)).toMatchObject({ status: 422, code: 'PAST_EXPIRY' });
    });

    it('answers a failure with no date, and a success with the date that it resolved', async () => {
      const world = await started({ today: '2026-11-11' });

      const success = await query(world, 'GetReferenceData', {});
      const failure = await query(world, 'GetFoodTypeDetail', { foodTypeId: 999 });

      expect(dataOf(success, '2026-11-11')).toBeDefined();
      expect(failureOf(failure).today).toBeNull();
    });

    it('is a CoordinatorPort, which has a handle that answers a promise, and it has a startup of its own', async () => {
      const world = setup();

      expect(typeof world.coordinator.handle).toBe('function');
      expect(typeof world.coordinator.startup).toBe('function');
      expect(world.coordinator.handle({ route: 'query', body: { ok: true, value: '{}' } })).toBeInstanceOf(Promise);
    });
  });
});
