import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeMysqlPool, createMysqlPool, createStoreWriteGateway, migrate } from '@freshrescue/backend';
import { startApi } from '../src/compose';

// State survives a restart (plan, phase 7, row 4). The API is started on the test database, used,
// stopped and started again on the same database, as main.ts would start it. The first start of an
// empty store seeds spec Appendix A; a later start finds the store bootstrapped and seeds nothing.

const DATABASE_URL = process.env.DATABASE_URL ?? expect.unreachable('DATABASE_URL is not set: run this file with npm run test:e2e');

const STORE_TABLES = ['foodCategories', 'foodTypes', 'batches', 'recipeCategories', 'recipes', 'recipeIngredients', 'settings', 'counters'] as const;

const APPENDIX_A_RECIPES = [
  'Beef and Broccoli Stir-Fry',
  'Chicken Broccoli Gratin',
  'Chicken Fried Rice',
  'Spinach Omelette',
  'Tomato Egg Stir-Fry',
  'Vietnamese Chicken Rice',
];
const APPENDIX_A_FOOD_TYPES = ['Beef', 'Broccoli', 'Chicken', 'Egg', 'Milk', 'Rice', 'Spinach', 'Tomato'];

type Answer = { readonly status: number; readonly ok: boolean; readonly data: unknown; readonly error?: { readonly code: string }; readonly meta: { readonly today: string | null } };
type Running = { readonly base: string; readonly migrated: readonly string[]; readonly stop: () => Promise<void> };
type CatalogRow = { readonly recipeId: number; readonly name: string; readonly status: string };
type InventoryRow = { readonly foodTypeId: number; readonly name: string; readonly total: number; readonly overall: string | null };

const running: Running[] = [];

async function emptyStore(): Promise<void> {
  const migrated = await migrate(DATABASE_URL);
  if (!migrated.ok) expect.unreachable(`the test database cannot be migrated: ${migrated.err.detail}`);
  const pool = createMysqlPool(DATABASE_URL);
  if (!pool.ok) expect.unreachable(`no pool: ${pool.err.detail}`);
  const emptied = await createStoreWriteGateway(pool.value).apply(STORE_TABLES.map((table) => ({ op: 'delete' as const, table, key: {} })));
  await closeMysqlPool(pool.value);
  if (!emptied.ok) expect.unreachable(`the store cannot be emptied: ${emptied.err.detail}`);
}

/** Starts the API on the test database, as main.ts does, on a free port. */
async function start(): Promise<Running> {
  const started = await startApi({ databaseUrl: DATABASE_URL, port: 0 });
  if (!started.ok) expect.unreachable(`the API did not start: ${started.err.code} ${started.err.detail}`);
  const api = { base: `http://127.0.0.1:${started.value.port}`, migrated: started.value.migrated, stop: started.value.stop };
  running.push(api);
  return api;
}

async function stop(api: Running): Promise<void> {
  running.splice(running.indexOf(api), 1);
  await api.stop();
}

async function send(api: Running, route: 'command' | 'query', envelope: object): Promise<Answer> {
  const response = await fetch(`${api.base}/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) });
  return { status: response.status, ...((await response.json()) as Omit<Answer, 'status'>) };
}

async function succeeded(api: Running, route: 'command' | 'query', envelope: object): Promise<unknown> {
  const answer = await send(api, route, envelope);
  return answer.ok ? answer.data : expect.unreachable(`${JSON.stringify(envelope)} failed: ${answer.status} ${answer.error?.code}`);
}

/** The answers that the six queries give, plus the detail of one Food Type: what must not change across a restart. */
async function everythingVisible(api: Running, foodTypeId: number): Promise<Answer[]> {
  return Promise.all([
    send(api, 'query', { type: 'GetReferenceData', params: {} }),
    send(api, 'query', { type: 'GetInventoryList', params: {} }),
    send(api, 'query', { type: 'GetFoodTypeDetail', params: { foodTypeId } }),
    send(api, 'query', { type: 'GetWarningPanel', params: {} }),
    send(api, 'query', { type: 'GetRecommendations', params: {} }),
    send(api, 'query', { type: 'GetCatalog', params: { cuisineId: null } }),
  ]);
}

beforeAll(emptyStore);

afterEach(async () => {
  for (const api of running.splice(0)) await api.stop();
});

describe('a restart of the API on the same database', () => {
  it('seeds spec Appendix A at the first start of an empty store: the catalog lists its 6 recipes, none blocked, and the inventory its 8 Food Types with no stock', async () => {
    const api = await start();

    const catalog = (await succeeded(api, 'query', { type: 'GetCatalog', params: { cuisineId: null } })) as { rows: CatalogRow[] };
    const inventory = (await succeeded(api, 'query', { type: 'GetInventoryList', params: {} })) as { rows: InventoryRow[] };

    expect(catalog.rows.map((row) => row.name)).toEqual(APPENDIX_A_RECIPES);
    expect(catalog.rows.filter((row) => row.status === 'blocked')).toEqual([]);
    expect(new Set(catalog.rows.map((row) => row.status))).toEqual(new Set(['nothing']));
    expect(inventory.rows.map((row) => [row.name, row.total, row.overall])).toEqual(APPENDIX_A_FOOD_TYPES.map((name) => [name, 0, null]));
  });

  it('answers every query the same after a restart, and does not load the seed a second time', async () => {
    const first = await start();
    const reference = (await succeeded(first, 'query', { type: 'GetReferenceData', params: {} })) as { foodTypes: { id: number; name: string }[] };
    const chicken = reference.foodTypes.find((foodType) => foodType.name === 'Chicken')?.id ?? expect.unreachable('the seed has no Chicken');
    const cuisineOther = 2;
    // a little of everything: a demo date, a batch, a category, a recipe
    await succeeded(first, 'command', { type: 'SetSimulatedToday', payload: { date: '2026-10-01' } });
    await succeeded(first, 'command', { type: 'InboundBatch', payload: { foodTypeId: chicken, foodName: null, categoryId: null, unit: null, quantity: 500_000, expiry: { days: 3 } } });
    await succeeded(first, 'command', { type: 'SaveCategory', payload: { scope: 'foodCategory', categoryId: null, parentId: null, name: 'Fish' } });
    await succeeded(first, 'command', {
      type: 'SaveRecipe',
      payload: { recipeId: null, name: 'Chicken Soup', draft: { cuisineId: cuisineOther, rows: [{ foodTypeId: chicken, quantity: 300_000, unit: 'grams' }] } },
    });
    const before = await everythingVisible(first, chicken);
    expect(before.map((answer) => answer.status)).toEqual([200, 200, 200, 200, 200, 200]);
    await stop(first);

    const second = await start();
    const after = await everythingVisible(second, chicken);
    await stop(second);
    const third = await start();
    const afterAnother = await everythingVisible(third, chicken);

    expect(after).toEqual(before);
    expect(afterAnother).toEqual(before);
    expect([second.migrated, third.migrated]).toEqual([[], []]);
    const catalog = after[5]?.data as { rows: CatalogRow[] };
    const inventory = after[1]?.data as { rows: InventoryRow[] };
    expect(catalog.rows.map((row) => row.name)).toEqual([...APPENDIX_A_RECIPES.slice(0, 3), 'Chicken Soup', ...APPENDIX_A_RECIPES.slice(3)]);
    expect(inventory.rows.map((row) => row.name)).toEqual(APPENDIX_A_FOOD_TYPES);
    expect(inventory.rows.find((row) => row.name === 'Chicken')).toMatchObject({ total: 500_000, overall: 'nearExpiry' });
    expect(after[0]?.meta.today).toBe('2026-10-01');
  });
});
