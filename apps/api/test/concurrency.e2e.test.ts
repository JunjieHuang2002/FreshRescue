import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeMysqlPool, createMysqlPool, createStoreWriteGateway, migrate } from '@freshrescue/backend';
import { startApi } from '../src/compose';

// Requests run one at a time (plan, phase 7, row 5). Each request reads the whole store at its start and
// writes at its end, so two requests that overlapped would both start from the same snapshot, and the
// later write would erase the earlier one. The HTTP gateway queues them; these tests send at once.

const DATABASE_URL = process.env.DATABASE_URL ?? expect.unreachable('DATABASE_URL is not set: run this file with npm run test:e2e');

const STORE_TABLES = ['foodCategories', 'foodTypes', 'batches', 'recipeCategories', 'recipes', 'recipeIngredients', 'settings', 'counters'] as const;

type Answer = { readonly status: number; readonly ok: boolean; readonly data: unknown; readonly error?: { readonly code: string } };
type Detail = { readonly batches: readonly { readonly id: number; readonly quantity: number; readonly createdSeq: number }[] };

let base = '';
let stop: () => Promise<void> = async () => {};

async function emptyStore(): Promise<void> {
  const migrated = await migrate(DATABASE_URL);
  if (!migrated.ok) expect.unreachable(`the test database cannot be migrated: ${migrated.err.detail}`);
  const pool = createMysqlPool(DATABASE_URL);
  if (!pool.ok) expect.unreachable(`no pool: ${pool.err.detail}`);
  const emptied = await createStoreWriteGateway(pool.value).apply(STORE_TABLES.map((table) => ({ op: 'delete' as const, table, key: {} })));
  await closeMysqlPool(pool.value);
  if (!emptied.ok) expect.unreachable(`the store cannot be emptied: ${emptied.err.detail}`);
}

async function send(route: 'command' | 'query', envelope: object): Promise<Answer> {
  const response = await fetch(`${base}/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) });
  return { status: response.status, ...((await response.json()) as Omit<Answer, 'status'>) };
}

async function succeeded(route: 'command' | 'query', envelope: object): Promise<unknown> {
  const answer = await send(route, envelope);
  return answer.ok ? answer.data : expect.unreachable(`${JSON.stringify(envelope)} failed: ${answer.status} ${answer.error?.code}`);
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

describe('requests sent at the same time', () => {
  it('ten parallel InboundBatch requests of 100,000 each for one Food Type: exactly 5 succeed and 5 answer CAP_EXCEEDED', async () => {
    const reference = (await succeeded('query', { type: 'GetReferenceData', params: {} })) as { foodTypes: { id: number; name: string }[] };
    const rice = reference.foodTypes.find((foodType) => foodType.name === 'Rice')?.id ?? expect.unreachable('the seed has no Rice');
    const inbound = { type: 'InboundBatch', payload: { foodTypeId: rice, foodName: null, categoryId: null, unit: null, quantity: 100_000_000, expiry: { days: 5 } } };

    const answers = await Promise.all(Array.from({ length: 10 }, () => send('command', inbound)));

    expect(answers.filter((answer) => answer.status === 200)).toHaveLength(5);
    const refused = answers.filter((answer) => answer.status !== 200);
    expect(refused.map((answer) => [answer.status, answer.error?.code])).toEqual(Array.from({ length: 5 }, () => [422, 'CAP_EXCEEDED']));
    const detail = (await succeeded('query', { type: 'GetFoodTypeDetail', params: { foodTypeId: rice } })) as Detail;
    expect(detail.batches.map((batch) => batch.quantity)).toEqual([100_000_000, 100_000_000, 100_000_000, 100_000_000, 100_000_000]);
    expect(new Set(detail.batches.map((batch) => batch.id)).size).toBe(5);
    expect(detail.batches.map((batch) => batch.createdSeq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('gives each of ten categories created at the same time an id of its own, and stores all ten', async () => {
    const names = Array.from({ length: 10 }, (_, index) => `Shelf ${index + 1}`);

    const answers = await Promise.all(names.map((name) => send('command', { type: 'SaveCategory', payload: { scope: 'foodCategory', categoryId: null, parentId: null, name } })));

    expect(answers.map((answer) => answer.status)).toEqual(names.map(() => 200));
    const ids = answers.map((answer) => (answer.data as { categoryId: number }).categoryId);
    expect(new Set(ids).size).toBe(10);
    const reference = (await succeeded('query', { type: 'GetReferenceData', params: {} })) as { foodCategories: { name: string }[] };
    expect(reference.foodCategories.map((category) => category.name).filter((name) => name.startsWith('Shelf ')).sort()).toEqual([...names].sort());
  });
});
