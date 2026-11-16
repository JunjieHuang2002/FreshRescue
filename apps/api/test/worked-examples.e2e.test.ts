import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeMysqlPool, createMysqlPool, createStoreWriteGateway, migrate } from '@freshrescue/backend';
import { startApi } from '../src/compose';

// The worked examples of spec v1.3 (plan, phase 10, row 1), as HTTP scenarios against the API as main.ts
// starts it, with real Express and real MySQL: 4.2.1, 4.2.2, 4.3.4, and 4.5 in its Partial and FEFO
// forms. Each scenario starts from an empty test database, so the first start seeds spec Appendix A, and
// sets Simulated Today wherever a figure depends on the date. The texts of spec 4.2.1 ("expires in 4
// days") are worked out by the frontend from `daysLeft`, so the figures checked here are the read models.

const DATABASE_URL = process.env.DATABASE_URL ?? expect.unreachable('DATABASE_URL is not set: run this file with npm run test:e2e');

/** The eight logical tables of the store, as the `changeset` contract names them. */
const STORE_TABLES = ['foodCategories', 'foodTypes', 'batches', 'recipeCategories', 'recipes', 'recipeIngredients', 'settings', 'counters'] as const;

// The replies and read models, as far as these scenarios read them. apps/api imports its own package only,
// so the shapes of the `messages` and `views` contracts are written out here.
type Status = 'fresh' | 'nearExpiry' | 'expired';
type Answer = {
  readonly status: number;
  readonly ok: boolean;
  readonly data: unknown;
  readonly error?: { readonly code: string; readonly detail?: string };
  readonly meta: { readonly today: string | null };
};
type BatchView = {
  readonly id: number;
  readonly quantity: number;
  readonly inboundDate: string;
  readonly expirationDate: string;
  readonly createdSeq: number;
  readonly daysLeft: number;
  readonly status: Status;
};
type Detail = {
  readonly name: string;
  readonly categoryPath: readonly string[];
  readonly unit: string;
  readonly total: number;
  readonly byStatus: Readonly<Record<Status, number>>;
  readonly overall: Status | null;
  readonly batches: readonly BatchView[];
};
type InventoryRow = { readonly foodTypeId: number; readonly name: string; readonly unit: string; readonly total: number };
type Line = {
  readonly name: string;
  readonly requiredQuantity: number;
  readonly requiredUnit: string;
  readonly available: number | null;
  readonly state: string;
  readonly foodTypeUnit: string | null;
};
type CatalogRow = {
  readonly recipeId: number;
  readonly name: string;
  readonly status: string;
  readonly availableCount: number;
  readonly totalCount: number;
  readonly ingredients: readonly Line[];
};
type WarningRow = { readonly batchId: number; readonly daysLeft: number; readonly status: Status };
type Warnings = { readonly nearExpiry: readonly WarningRow[]; readonly expired: readonly WarningRow[] };
type CookEntry = {
  readonly recipeName: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly deducted: readonly { readonly name: string; readonly quantity: number; readonly unit: string }[];
  readonly missing: readonly { readonly name: string; readonly needed: number; readonly available: number; readonly unit: string }[];
};
type Reference = { readonly today: string; readonly foodTypes: readonly { readonly id: number; readonly name: string }[] };

let base = '';
let stopApi: (() => Promise<void>) | null = null;

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

async function send(route: 'command' | 'query', envelope: object): Promise<Answer> {
  const response = await fetch(`${base}/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) });
  return { status: response.status, ...((await response.json()) as Omit<Answer, 'status'>) };
}

const command = (type: string, payload: object): Promise<Answer> => send('command', { type, payload });
const query = (type: string, params: object = {}): Promise<Answer> => send('query', { type, params });

/** The data of a reply that must be a success. */
async function ok<D>(reply: Promise<Answer>): Promise<D> {
  const answer = await reply;
  return answer.ok ? (answer.data as D) : expect.unreachable(`the request failed: ${answer.status} ${answer.error?.code} ${answer.error?.detail ?? ''}`);
}

/** Sets Simulated Today, the demo date that replaces the device date everywhere (spec 4.3.4); null clears it. */
const setToday = (date: string | null): Promise<unknown> => ok(command('SetSimulatedToday', { date }));

async function foodTypeIdOf(name: string): Promise<number> {
  const reference = await ok<Reference>(query('GetReferenceData'));
  return reference.foodTypes.find((foodType) => foodType.name === name)?.id ?? expect.unreachable(`the seed has no ${name}`);
}

/** Adds one batch to an existing Food Type, as the inbound form does once the Food Type is picked. */
const inbound = (foodTypeId: number, quantity: number, expiry: { days: number } | { date: string }): Promise<unknown> =>
  ok(command('InboundBatch', { foodTypeId, foodName: null, categoryId: null, unit: null, quantity, expiry }));

const detailOf = (foodTypeId: number): Promise<Detail> => ok<Detail>(query('GetFoodTypeDetail', { foodTypeId }));
const inventory = async (): Promise<readonly InventoryRow[]> => (await ok<{ rows: InventoryRow[] }>(query('GetInventoryList'))).rows;
const catalog = async (): Promise<readonly CatalogRow[]> => (await ok<{ rows: CatalogRow[] }>(query('GetCatalog', { cuisineId: null }))).rows;
const warnings = (): Promise<Warnings> => ok<Warnings>(query('GetWarningPanel'));
const cook = async (recipeIds: readonly number[]): Promise<readonly CookEntry[]> =>
  (await ok<{ reports: CookEntry[] }>(command('CookRecipes', { recipeIds }))).reports;

async function recipeOf(name: string): Promise<CatalogRow> {
  return (await catalog()).find((row) => row.name === name) ?? expect.unreachable(`the catalog has no recipe ${name}`);
}

const rowOf = async (foodTypeId: number): Promise<InventoryRow | undefined> => (await inventory()).find((row) => row.foodTypeId === foodTypeId);

beforeEach(async () => {
  await emptyStore();
  const started = await startApi({ databaseUrl: DATABASE_URL, port: 0 });
  if (!started.ok) expect.unreachable(`the API did not start: ${started.err.code} ${started.err.detail}`);
  base = `http://127.0.0.1:${started.value.port}`;
  stopApi = started.value.stop;
});

afterEach(async () => {
  await stopApi?.();
  stopApi = null;
});

describe('the worked examples of spec v1.3, over real HTTP and real MySQL', () => {
  it('4.2.1, separate batches: Milk added on Oct 1 (500 ml, 5 days) and on Oct 2 (1000 ml, 10 days) stays two batches under Dairy → Liquid Dairy → Milk, expiring in 4 and in 10 days on Oct 2', async () => {
    const milk = await foodTypeIdOf('Milk');

    await setToday('2026-10-01');
    // the inbound form names the Food Type; "Milk" matches the seeded one, so the batch joins it (spec 4.2.5)
    await ok(command('InboundBatch', { foodTypeId: null, foodName: 'Milk', categoryId: null, unit: null, quantity: 500_000, expiry: { days: 5 } }));
    const onOctober1 = await detailOf(milk);
    await setToday('2026-10-02');
    await ok(command('InboundBatch', { foodTypeId: null, foodName: 'Milk', categoryId: null, unit: null, quantity: 1_000_000, expiry: { days: 10 } }));
    const onOctober2 = await detailOf(milk);

    // on Oct 1 the first entry read "expires in 5 days"; the text changes every day
    expect(onOctober1.batches.map((batch) => [batch.quantity, batch.expirationDate, batch.daysLeft])).toEqual([[500_000, '2026-10-06', 5]]);
    expect([onOctober2.name, onOctober2.categoryPath, onOctober2.unit]).toEqual(['Milk', ['Dairy', 'Liquid Dairy'], 'ml']);
    expect(onOctober2.batches.map((batch) => [batch.quantity, batch.inboundDate, batch.expirationDate, batch.daysLeft])).toEqual([
      [500_000, '2026-10-01', '2026-10-06', 4],
      [1_000_000, '2026-10-02', '2026-10-12', 10],
    ]);
    // two distinct entries, never merged: each has its own id and its own creation sequence number
    const [first, second] = onOctober2.batches;
    expect(first?.id).not.toBe(second?.id);
    expect((first?.createdSeq ?? 0) < (second?.createdSeq ?? 0)).toBe(true);
    // one Food Type: the list still has the 8 seeded ones, and Milk holds both batches
    expect(await inventory()).toHaveLength(8);
    expect((await rowOf(milk))?.total).toBe(1_500_000);
  });

  it('4.2.2, unit change: Chicken with batches of 100 g and 200 g changes its unit from grams to pieces, and the batches then hold 0.5 and 1 pieces', async () => {
    const chicken = await foodTypeIdOf('Chicken');
    await inbound(chicken, 100_000, { days: 4 });
    await inbound(chicken, 200_000, { days: 6 });
    const before = await detailOf(chicken);
    const [batch1, batch2] = before.batches;
    if (batch1 === undefined || batch2 === undefined) expect.unreachable('Chicken has two batches');

    // the modal asks for both batches in the new unit, and the user enters 0.5 and 1
    await ok(command('ChangeFoodTypeUnit', {
      foodTypeId: chicken,
      unit: 'pieces',
      batches: [
        { batchId: batch1.id, quantity: 500 },
        { batchId: batch2.id, quantity: 1_000 },
      ],
    }));
    const after = await detailOf(chicken);

    expect(before.batches.map((batch) => batch.quantity)).toEqual([100_000, 200_000]);
    expect(after.unit).toBe('pieces');
    // both batches are now in pieces; expiration dates and createdSeq are untouched
    expect(after.batches.map((batch) => [batch.id, batch.quantity, batch.expirationDate, batch.createdSeq])).toEqual([
      [batch1.id, 500, batch1.expirationDate, batch1.createdSeq],
      [batch2.id, 1_000, batch2.expirationDate, batch2.createdSeq],
    ]);
    expect(await rowOf(chicken)).toMatchObject({ unit: 'pieces', total: 1_500 });
    // recipes are never rewritten: the ones that need Chicken in grams are now Unit Conflicts (spec 4.2.2, item 4)
    const needChicken = ['Chicken Broccoli Gratin', 'Chicken Fried Rice', 'Vietnamese Chicken Rice'];
    for (const name of needChicken) {
      const recipe = await recipeOf(name);
      expect(recipe.status, name).toBe('blocked');
      expect(recipe.ingredients.find((line) => line.name === 'Chicken')).toMatchObject({ state: 'unitConflict', requiredUnit: 'grams', foodTypeUnit: 'pieces' });
    }
  });

  it('4.3.4, dates: a batch added on Oct 1, 2026 with a 3-day shelf life expires on Oct 4; it is Near-Expiry from Oct 1 through Oct 4, and Expired from Oct 5', async () => {
    const chicken = await foodTypeIdOf('Chicken');
    await setToday('2026-10-01');
    await inbound(chicken, 500_000, { days: 3 });
    const [batch] = (await detailOf(chicken)).batches;
    if (batch === undefined) expect.unreachable('Chicken has a batch');

    // with the default T_eff of 3 days, days left = 3 <= 3: Near-Expiry from the moment it is added
    expect([batch.inboundDate, batch.expirationDate]).toEqual(['2026-10-01', '2026-10-04']);
    const seen: (readonly [string, number, Status, boolean, boolean])[] = [];
    for (const date of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']) {
      await setToday(date);
      const [view] = (await detailOf(chicken)).batches;
      const panel = await warnings();
      const inPanel = (rows: readonly WarningRow[]): boolean => rows.some((row) => row.batchId === batch.id);
      seen.push([date, view?.daysLeft ?? NaN, view?.status ?? 'fresh', inPanel(panel.nearExpiry), inPanel(panel.expired)]);
    }

    // usable all day on Oct 4, and Expired from 00:00 on Oct 5: Simulated Today moves the date a day at a time
    expect(seen).toEqual([
      ['2026-10-01', 3, 'nearExpiry', true, false],
      ['2026-10-02', 2, 'nearExpiry', true, false],
      ['2026-10-03', 1, 'nearExpiry', true, false],
      ['2026-10-04', 0, 'nearExpiry', true, false],
      ['2026-10-05', -1, 'expired', false, true],
    ]);
    // an Expired batch still counts in the total, and gives nothing to Q_avail
    expect(await rowOf(chicken)).toMatchObject({ total: 500_000 });
    const chickenLine = (await recipeOf('Vietnamese Chicken Rice')).ingredients.find((line) => line.name === 'Chicken');
    expect(chickenLine).toMatchObject({ available: 0, state: 'missing' });

    // and spec 4.3.4's own example: a batch with a 2-day shelf life, then Simulated Today three days ahead
    const beef = await foodTypeIdOf('Beef');
    await setToday('2026-10-10');
    await inbound(beef, 100_000, { days: 2 });
    await setToday('2026-10-13');
    expect((await detailOf(beef)).batches.map((view) => [view.expirationDate, view.status])).toEqual([['2026-10-12', 'expired']]);
  });

  it('4.5, Partial: with 150 g Beef and 250 g Broccoli in stock, cooking the recipe that needs 300 g Beef and 200 g Broccoli deducts 200 g Broccoli (50 g left) and 0 g Beef', async () => {
    const beef = await foodTypeIdOf('Beef');
    const broccoli = await foodTypeIdOf('Broccoli');
    await inbound(beef, 150_000, { days: 10 });
    await inbound(broccoli, 250_000, { days: 10 });
    // the seeded Beef and Broccoli Stir-Fry is that recipe
    const recipe = await recipeOf('Beef and Broccoli Stir-Fry');

    const reports = await cook([recipe.recipeId]);

    expect([recipe.status, recipe.availableCount, recipe.totalCount]).toEqual(['partial', 1, 2]);
    expect(recipe.ingredients.map((line) => [line.name, line.requiredQuantity, line.available, line.state])).toEqual([
      ['Beef', 300_000, 150_000, 'missing'],
      ['Broccoli', 200_000, 250_000, 'ok'],
    ]);
    expect(reports).toEqual([
      {
        recipeId: recipe.recipeId,
        recipeName: 'Beef and Broccoli Stir-Fry',
        outcome: 'cooked',
        reason: null,
        deducted: [{ foodTypeId: broccoli, name: 'Broccoli', quantity: 200_000, unit: 'grams' }],
        missing: [{ foodTypeId: beef, name: 'Beef', needed: 300_000, available: 150_000, unit: 'grams' }],
      },
    ]);
    // 50 g Broccoli left; the 150 g Beef untouched, because 150 g < 300 g
    expect((await detailOf(broccoli)).batches.map((batch) => batch.quantity)).toEqual([50_000]);
    expect((await detailOf(beef)).batches.map((batch) => batch.quantity)).toEqual([150_000]);
  });

  it('4.5, FEFO: a recipe needing 300 g Beef, with batch A of 100 g expired, B of 150 g near-expiry and C of 200 g fresh, uses up B and takes 150 g from C (50 g left), and leaves A alone', async () => {
    const beef = await foodTypeIdOf('Beef');
    const { recipeId } = await ok<{ recipeId: number }>(
      command('SaveRecipe', { recipeId: null, name: 'Beef Steak', draft: { cuisineId: null, rows: [{ foodTypeId: beef, quantity: 300_000, unit: 'grams' }] } }),
    );
    // inbound refuses a past expiry, so batch A is added the day before, expiring that day
    await setToday('2026-10-01');
    await inbound(beef, 100_000, { days: 0 });
    await setToday('2026-10-02');
    await inbound(beef, 150_000, { days: 1 }); // B: expiring tomorrow
    await inbound(beef, 200_000, { days: 7 }); // C: expiring in 7 days
    const before = await detailOf(beef);
    const [batchA, batchB, batchC] = before.batches;
    if (batchA === undefined || batchB === undefined || batchC === undefined) expect.unreachable('Beef has three batches');
    const recipe = await recipeOf('Beef Steak');

    const reports = await cook([recipeId]);

    expect(before.batches.map((batch) => [batch.quantity, batch.status, batch.daysLeft])).toEqual([
      [100_000, 'expired', -1],
      [150_000, 'nearExpiry', 1],
      [200_000, 'fresh', 7],
    ]);
    // A is excluded, so Q_avail = 150 g + 200 g = 350 g >= 300 g: the recipe is a full match
    expect([recipe.status, recipe.ingredients.map((line) => line.available)]).toEqual(['full', [350_000]]);
    expect(reports.map((entry) => [entry.outcome, entry.deducted, entry.missing])).toEqual([['cooked', [{ foodTypeId: beef, name: 'Beef', quantity: 300_000, unit: 'grams' }], []]]);
    // B is used up and removed from active inventory, C keeps 50 g, and the expired A is untouched
    expect((await detailOf(beef)).batches.map((batch) => [batch.id, batch.quantity, batch.status])).toEqual([
      [batchA.id, 100_000, 'expired'],
      [batchC.id, 50_000, 'fresh'],
    ]);
  });
});
