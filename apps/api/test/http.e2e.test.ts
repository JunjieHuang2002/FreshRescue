import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeMysqlPool, createMysqlPool, createStoreWriteGateway, migrate } from '@freshrescue/backend';
import { startApi } from '../src/compose';

// The HTTP contract (plan, phase 7, row 3): the API as main.ts starts it, with real Express and real
// MySQL. Each route answers one success and its failures with the status of the errors contract: 400,
// 422, 409, 500 for a fault of the server, 413 for an oversized body, and 404 for an unknown URL.
// The e2e project's setup points DATABASE_URL at the test database, which this file empties first.

const DATABASE_URL = process.env.DATABASE_URL ?? expect.unreachable('DATABASE_URL is not set: run this file with npm run test:e2e');

/** The eight logical tables of the store, as the `changeset` contract names them. */
const STORE_TABLES = ['foodCategories', 'foodTypes', 'batches', 'recipeCategories', 'recipes', 'recipeIngredients', 'settings', 'counters'] as const;

type Failure = { readonly code: string; readonly family: string; readonly detail?: string };
type Answer = {
  readonly status: number;
  readonly ok: boolean;
  readonly data: unknown;
  readonly error: Failure | undefined;
  readonly meta: { readonly today: string | null };
};
type ReferenceData = {
  readonly today: string;
  readonly simulatedToday: string | null;
  readonly units: readonly string[];
  readonly foodCategories: readonly { readonly id: number; readonly name: string; readonly isSystem: boolean }[];
  readonly cuisines: readonly { readonly name: string }[];
  readonly foodTypes: readonly { readonly id: number; readonly name: string; readonly unit: string }[];
};

let base = '';
let stop: () => Promise<void> = async () => {};

/** Empties the store through its own write gateway: a delete with no key field removes every row of a table. */
async function emptyStore(): Promise<void> {
  const migrated = await migrate(DATABASE_URL);
  if (!migrated.ok) expect.unreachable(`the test database cannot be migrated: ${migrated.err.detail}`);
  const pool = createMysqlPool(DATABASE_URL);
  if (!pool.ok) expect.unreachable(`no pool: ${pool.err.detail}`);
  const emptied = await createStoreWriteGateway(pool.value).apply(STORE_TABLES.map((table) => ({ op: 'delete' as const, table, key: {} })));
  await closeMysqlPool(pool.value);
  if (!emptied.ok) expect.unreachable(`the store cannot be emptied: ${emptied.err.detail}`);
}

/** Writes to the store behind the running server's back, to break it the way a fault of the server would. */
async function writeDirectly(ops: Parameters<ReturnType<typeof createStoreWriteGateway>['apply']>[0]): Promise<void> {
  const pool = createMysqlPool(DATABASE_URL);
  if (!pool.ok) expect.unreachable(`no pool: ${pool.err.detail}`);
  const written = await createStoreWriteGateway(pool.value).apply(ops);
  await closeMysqlPool(pool.value);
  if (!written.ok) expect.unreachable(`the direct write failed: ${written.err.detail}`);
}

async function post(path: string, body: string, contentType = 'application/json'): Promise<Answer> {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': contentType }, body });
  expect(response.headers.get('content-type'), `${path} answers JSON`).toMatch(/^application\/json/);
  return { status: response.status, ...((await response.json()) as Omit<Answer, 'status'>) };
}

const command = (type: string, payload: unknown): Promise<Answer> => post('/api/command', JSON.stringify({ type, payload }));
const query = (type: string, params: unknown = {}): Promise<Answer> => post('/api/query', JSON.stringify({ type, params }));

async function referenceData(): Promise<ReferenceData> {
  const answer = await query('GetReferenceData');
  return answer.ok ? (answer.data as ReferenceData) : expect.unreachable(`GetReferenceData failed: ${answer.error?.code}`);
}

async function riceId(): Promise<number> {
  return (await referenceData()).foodTypes.find((foodType) => foodType.name === 'Rice')?.id ?? expect.unreachable('the seed has no Rice');
}

beforeAll(async () => {
  await emptyStore();
  const started = await startApi({ databaseUrl: DATABASE_URL, port: 0 });
  if (!started.ok) expect.unreachable(`the API did not start: ${started.err.code} ${started.err.detail}`);
  base = `http://127.0.0.1:${started.value.port}`;
  stop = started.value.stop;
});

afterAll(async () => {
  await stop();
});

describe('the API over HTTP, on real Express and real MySQL', () => {
  it('answers GET /healthz with { ok: true }', async () => {
    const response = await fetch(`${base}/healthz`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  describe('POST /api/command', () => {
    it('answers 200 with the command’s own payload: SaveCategory answers the new id, and the category is stored', async () => {
      const answer = await command('SaveCategory', { scope: 'foodCategory', categoryId: null, parentId: null, name: 'Fish' });

      expect(answer.status).toBe(200);
      expect(answer.ok).toBe(true);
      const categoryId = (answer.data as { categoryId: number }).categoryId;
      expect(Number.isInteger(categoryId)).toBe(true);
      expect(answer.meta.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((await referenceData()).foodCategories).toContainEqual(expect.objectContaining({ id: categoryId, name: 'Fish', isSystem: false }));
    });

    it('answers 400 to a malformed request: BAD_ENVELOPE for a body that is not JSON, UNKNOWN_COMMAND, MISSING_FIELD', async () => {
      const notJson = await post('/api/command', 'this is not JSON');
      const unknown = await command('MakeCoffee', {});
      const missing = await command('SaveCategory', { scope: 'foodCategory', categoryId: null, parentId: null });

      expect([notJson.status, notJson.error?.code]).toEqual([400, 'BAD_ENVELOPE']);
      expect([unknown.status, unknown.error?.code]).toEqual([400, 'UNKNOWN_COMMAND']);
      expect([missing.status, missing.error?.code]).toEqual([400, 'MISSING_FIELD']);
    });

    it('answers 422 to an invalid value: NAME_EMPTY for a blank name, and for an inbound that names no Food Type', async () => {
      const blank = await command('SaveCategory', { scope: 'foodCategory', categoryId: null, parentId: null, name: '   ' });
      const nameless = await command('InboundBatch', { foodTypeId: null, foodName: null, categoryId: null, unit: 'grams', quantity: 1_000, expiry: { days: 3 } });

      expect([blank.status, blank.error?.code, blank.error?.family]).toEqual([422, 'NAME_EMPTY', 'validation']);
      expect([nameless.status, nameless.error?.code]).toEqual([422, 'NAME_EMPTY']);
    });

    it('answers 409 to a broken rule: CATEGORY_NOT_FOUND for the deletion of a category that is not there', async () => {
      const answer = await command('DeleteCategory', { scope: 'foodCategory', categoryId: 99_999 });

      expect([answer.status, answer.error?.code, answer.error?.family]).toEqual([409, 'CATEGORY_NOT_FOUND', 'rules']);
    });

    it('answers 500 to a fault of the server, and writes nothing: a shelf life of 3,000,000 days gives a date that no store can hold, INVARIANT_BROKEN', async () => {
      const before = await query('GetInventoryList');

      const answer = await command('InboundBatch', { foodTypeId: await riceId(), foodName: null, categoryId: null, unit: null, quantity: 1_000, expiry: { days: 3_000_000 } });

      expect([answer.status, answer.error?.code]).toEqual([500, 'INVARIANT_BROKEN']);
      expect(await query('GetInventoryList')).toEqual(before);
    });

    it('answers 413 PAYLOAD_TOO_LARGE to a body over the 1 MiB the API reads', async () => {
      const answer = await post('/api/command', JSON.stringify({ type: 'SaveCategory', payload: { name: 'x'.repeat(1_100_000) } }));

      expect([answer.status, answer.error?.code, answer.error?.family]).toEqual([413, 'PAYLOAD_TOO_LARGE', 'io']);
    });
  });

  describe('POST /api/query', () => {
    it('answers 200 with the read model: the reference data of the seeded store, for today', async () => {
      const answer = await query('GetReferenceData');
      const data = answer.data as ReferenceData;

      expect(answer.status).toBe(200);
      expect(answer.meta.today).toBe(data.today);
      expect(data.units).toEqual(['grams', 'kg', 'ml', 'liters', 'pieces', 'cartons']);
      expect(data.foodTypes.map((foodType) => foodType.name)).toEqual(['Beef', 'Broccoli', 'Chicken', 'Egg', 'Milk', 'Rice', 'Spinach', 'Tomato']);
      expect(data.cuisines.map((cuisine) => cuisine.name)).toEqual(['Chinese Cuisine', 'Vietnamese Cuisine', 'French Cuisine', 'Other']);
    });

    it('answers 400 to a malformed query: UNKNOWN_QUERY, and WRONG_TYPE for an id that is not one', async () => {
      const unknown = await query('GetWeather');
      const wrong = await query('GetFoodTypeDetail', { foodTypeId: 'beef' });

      expect([unknown.status, unknown.error?.code]).toEqual([400, 'UNKNOWN_QUERY']);
      expect([wrong.status, wrong.error?.code]).toEqual([400, 'WRONG_TYPE']);
    });

    it('answers 409 FOOD_TYPE_NOT_FOUND to the detail of a Food Type that is not there', async () => {
      const answer = await query('GetFoodTypeDetail', { foodTypeId: 99_999 });

      expect([answer.status, answer.error?.code]).toEqual([409, 'FOOD_TYPE_NOT_FOUND']);
    });

    it('answers 500 SCHEMA_MISMATCH while the store has lost its settings row, a fault of the server, and answers again once it is back', async () => {
      const { simulatedToday } = await referenceData();
      await writeDirectly([{ op: 'delete', table: 'settings', key: {} }]);

      const broken = await query('GetReferenceData');
      const brokenCommand = await command('SetSimulatedToday', { date: '2026-10-01' });
      await writeDirectly([{ op: 'put', table: 'settings', row: { simulatedToday, bootstrapped: true } }]);

      expect([broken.status, broken.error?.code, broken.error?.family]).toEqual([500, 'SCHEMA_MISMATCH', 'shape']);
      expect([brokenCommand.status, brokenCommand.error?.code]).toEqual([500, 'SCHEMA_MISMATCH']);
      expect((await query('GetReferenceData')).status).toBe(200);
    });

    it('answers 413 PAYLOAD_TOO_LARGE to a body over the 1 MiB the API reads', async () => {
      const answer = await post('/api/query', 'x'.repeat(1_048_577), 'text/plain');

      expect([answer.status, answer.error?.code]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
    });
  });

  it('answers 404 to a URL that is not one of the routes, and to GET on a route that takes POST', async () => {
    const statuses = await Promise.all([
      fetch(`${base}/`).then((response) => response.status),
      fetch(`${base}/api/nothing`, { method: 'POST', body: '{}' }).then((response) => response.status),
      fetch(`${base}/api/command`).then((response) => response.status),
      fetch(`${base}/api/query`, { method: 'PUT', body: '{}' }).then((response) => response.status),
    ]);

    expect(statuses).toEqual([404, 404, 404, 404]);
  });

  it('gives every failure one shape: ok false, the code with its family and a detail, and meta.today null; a success carries the today it was worked out for', async () => {
    const deviceToday = (await query('GetReferenceData')).meta.today;
    const success = await command('SetSimulatedToday', { date: '2026-10-01' });
    const next = await query('GetReferenceData');
    const failure = await command('SetSimulatedToday', { date: '2026-02-30' });
    await command('SetSimulatedToday', { date: null });
    const cleared = await query('GetReferenceData');

    // the command answers with the today of its own request; the next request resolves the new one
    expect(success).toEqual({ status: 200, ok: true, data: {}, meta: { today: deviceToday } });
    expect(next.meta.today).toBe('2026-10-01');
    expect(failure).toMatchObject({ status: 400, ok: false, error: { code: 'DATE_INVALID', family: 'shape' }, meta: { today: null } });
    expect(typeof failure.error?.detail).toBe('string');
    expect(failure.data).toBeUndefined();
    expect(cleared.meta.today).toBe(deviceToday);
  });
});
