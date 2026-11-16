// @vitest-environment jsdom
// The real frontend on the real API (plan, phase 10, row 3): six journeys through the page that AppHost
// mounts, with the real coordinators, the real three gateways and the real views, in jsdom, talking over
// HTTP to the API as main.ts starts it, on real MySQL. The `apiGateway` is pointed at that server's
// address, so no proxy stands between them. The journey that covers row 4 of the spec's exception matrix
// names it in its title.
//
// The API runs as a process of its own (`node --import tsx apps/api/src/main.ts`), not inside this file:
// jsdom replaces Node's `URL`, and the backend works out the folder of its migrations with Node's URL when
// it is imported. A process of its own is also the real thing, which a journey can stop and start again.
// The store is emptied the way the other e2e files do it, through the backend's own write gateway, in a
// one-shot Node process for the same reason. The e2e project's setup points DATABASE_URL at the test
// database, and both processes inherit it.
//
// A person's actions are clicks, typing and choices on the painted page (testing/page.ts). After each one,
// a journey waits until every request that the page sent has been answered and painted: the coordinators
// do no other asynchronous work, so the page has settled once no request is on its way.
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiGateway, createAppCoordinator, createDomHostGateway, createMidnightTimerGateway } from '@freshrescue/frontend';
import type { ApiPort, SlotId } from '@freshrescue/frontend';
import { addSlots, choose, click, hintOf, inputOf, isShown, selectOf, slotElement, textsOf, typeInto } from '../packages/frontend/src/testing/page';

const DATABASE_URL = process.env.DATABASE_URL ?? expect.unreachable('DATABASE_URL is not set: run this file with npm run test:e2e');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JOURNEY = { timeout: 60_000 } as const;
const SERVER_START_MS = 20_000;
const SERVER_STOP_MS = 10_000;

/** The eight logical tables of the store, as the `changeset` contract names them. */
const STORE_TABLES = ['foodCategories', 'foodTypes', 'batches', 'recipeCategories', 'recipes', 'recipeIngredients', 'settings', 'counters'];

/** Spec Appendix A, as the catalog lists it: A to Z. */
const APPENDIX_A_RECIPES = [
  'Beef and Broccoli Stir-Fry',
  'Chicken Broccoli Gratin',
  'Chicken Fried Rice',
  'Spinach Omelette',
  'Tomato Egg Stir-Fry',
  'Vietnamese Chicken Rice',
];

/** What a person reads for each code that these journeys meet, as ErrorNoticeMapper words it: the hint beside a field, or a notice. */
const SAYS = {
  FIELD_REQUIRED: 'This field is required.',
  QTY_FORMAT: 'Use digits and one decimal point, like 1.5.',
  QTY_DECIMALS: 'Use at most 3 decimal places.',
  INT_FORMAT: 'Use a whole number, like 3.',
  NAME_EMPTY: 'The name is empty. Enter 1 to 200 characters.',
  THRESHOLD_INVALID: 'The threshold must be a whole number of days, at least 1.',
  DUP_INGREDIENT: 'A Food Type can be used only once in a recipe.',
  NETWORK_ERROR: 'Cannot reach the server. Check that it is running, then try again.',
} as const;

// ---- the server ------------------------------------------------------------------------------

type Server = {
  readonly port: number;
  readonly base: string;
  readonly child: ChildProcess;
  /** What the process printed, for the message of a failure. */
  readonly output: () => string;
};

const servers = new Set<Server>();

/** Empties the store through the backend's own write gateway: a delete with no key field removes every row of a table. */
const EMPTY_STORE = `
import { closeMysqlPool, createMysqlPool, createStoreWriteGateway, migrate } from '@freshrescue/backend';
const url = process.env.DATABASE_URL;
const migrated = await migrate(url);
if (!migrated.ok) { console.error('migrate', migrated.err.code, migrated.err.detail); process.exit(1); }
const pool = createMysqlPool(url);
if (!pool.ok) { console.error('pool', pool.err.code, pool.err.detail); process.exit(1); }
const tables = ${JSON.stringify(STORE_TABLES)};
const emptied = await createStoreWriteGateway(pool.value).apply(tables.map((table) => ({ op: 'delete', table, key: {} })));
await closeMysqlPool(pool.value);
if (!emptied.ok) { console.error('empty', emptied.err.code, emptied.err.detail); process.exit(1); }
`;

function emptyStore(): void {
  const run = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', EMPTY_STORE], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL },
    encoding: 'utf8',
    timeout: SERVER_START_MS,
  });
  if (run.status !== 0) expect.unreachable(`the store cannot be emptied (exit ${run.status}): ${run.stderr}${run.stdout}`);
}

/** Starts the API as main.ts does, on `port` (0 picks a free one), and resolves once it listens. Its first start on an empty store seeds Appendix A. */
async function startServer(port = 0): Promise<Server> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/main.ts'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL, API_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const listening = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), SERVER_START_MS);
    const read = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      const found = /API listening on http:\/\/localhost:(\d+)/.exec(output);
      if (found !== null) {
        clearTimeout(timer);
        resolve(Number(found[1]));
      }
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
  if (listening === null) {
    child.kill('SIGKILL');
    return expect.unreachable(`the API did not start on port ${port}:\n${output}`);
  }
  const server: Server = { port: listening, base: `http://127.0.0.1:${listening}`, child, output: () => output };
  servers.add(server);
  return server;
}

/** Stops the server the way a person stops `npm run dev` (SIGTERM, which main.ts answers by closing it), and resolves once the process has ended. */
async function stopServer(server: Server): Promise<void> {
  servers.delete(server);
  const { child } = server;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), SERVER_STOP_MS);
  await ended;
  clearTimeout(timer);
}

// ---- the page --------------------------------------------------------------------------------

type Where = { readonly slot?: SlotId; readonly nth?: number };

type Page = {
  /** The names of the messages that the page sent, in the order it sent them. */
  readonly sent: string[];
  /** Does what a person does, and waits until the page has had every answer it asked for and has painted them. */
  act(action: () => void): Promise<void>;
  /** Stops the app as AppHost does when it unmounts, and takes the slots out of the page. */
  close(): void;
};

const pages = new Set<Page>();

const nextTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Opens the app as AppHost and compose.ts do: the 16 empty slots, the app coordinator on the real API
 * gateway (pointed at `server`), the real DOM host and the real midnight timer, then `start`. The gateway
 * is wrapped only to count the requests on their way and to note their names.
 */
async function openPage(server: Server): Promise<Page> {
  const gateway = createApiGateway({ baseUrl: server.base });
  const sent: string[] = [];
  let pending = 0;
  const api: ApiPort = {
    async send(envelope) {
      pending += 1;
      sent.push(envelope.type);
      try {
        return await gateway.send(envelope);
      } finally {
        pending -= 1;
      }
    },
  };
  const removeSlots = addSlots();
  const app = createAppCoordinator({ api, dom: createDomHostGateway(), timer: createMidnightTimerGateway() });
  const settled = async (): Promise<void> => {
    do await nextTurn();
    while (pending > 0);
  };
  const page: Page = {
    sent,
    act: async (action) => {
      action();
      await settled();
    },
    close: () => {
      pages.delete(page);
      app.stop();
      removeSlots();
    },
  };
  pages.add(page);
  await app.start();
  await settled();
  return page;
}

/** Chooses the entry of a drop-down by what it says, as a person does. */
function pick(caption: string, label: string, where: Where): void {
  const option = [...selectOf(caption, where).options].find((each) => each.textContent === label);
  if (option === undefined) expect.unreachable(`the drop-down "${caption}" has no entry "${label}"`);
  choose(caption, option.value, where);
}

/** The entry that a drop-down shows. */
const pickedIn = (caption: string, where: Where): string | null | undefined => selectOf(caption, where).selectedOptions[0]?.textContent;

/** The button with this label that belongs with a text of the slot: the "Set threshold" of a category's row, the "Edit" of a recipe's card. */
function buttonWith(slot: SlotId, text: string, label: string): HTMLButtonElement {
  const host = slotElement(slot);
  const span = [...host.querySelectorAll('span')].find((each) => each.textContent === text && each.closest('button') === null);
  for (let box = span?.parentElement ?? null; box !== null && box !== host; box = box.parentElement) {
    const button = [...box.querySelectorAll('button')].find((each) => each.textContent === label);
    if (button !== undefined) return button;
  }
  return expect.unreachable(`no button "${label}" goes with "${text}" in the ${slot} slot`);
}

/** The recipes that the catalog shows, in its order. */
const recipesShown = (names: readonly string[]): string[] => textsOf('catalog').filter((text) => names.includes(text));

/** The texts of the notice bar, without its Dismiss buttons. */
const notices = (): string[] => textsOf('notices').filter((text) => text !== 'Dismiss');

/** Dismisses every notice, oldest first. */
async function dismissAll(page: Page): Promise<void> {
  while (notices().length > 0) await page.act(() => click('Dismiss', { slot: 'notices' }));
}

/** Sets Simulated Today with the demo control, as a person does: open it, type the date, save. */
async function setToday(page: Page, date: string): Promise<void> {
  await page.act(() => click('Set Simulated Today', { slot: 'demo' }));
  await page.act(() => typeInto('Simulated Today', date, { slot: 'demo' }));
  await page.act(() => click('Save', { slot: 'demo' }));
}

/** The texts of one row of the inventory list, from the Food Type's name to its status. */
function inventoryRow(name: string): string[] {
  const texts = textsOf('inventoryList');
  const start = texts.indexOf(name);
  if (start === -1) return [];
  const row = texts.slice(start);
  const end = row.findIndex((text, index) => index > 0 && (text === '—' || ['Fresh', 'Near-Expiry', 'Expired'].includes(text)));
  return row.slice(0, end + 1);
}

afterEach(async () => {
  for (const page of [...pages]) page.close();
  for (const server of [...servers]) await stopServer(server);
});

describe('the real frontend on the real API: six journeys', () => {
  it('first run: on an empty database the first start seeds Appendix A, the page lists its 8 Food Types with quantity 0 and "—", and the catalog lists its 6 recipes', JOURNEY, async () => {
    emptyStore();
    const server = await startServer();

    const page = await openPage(server);

    // the start sends the reference data and the queries of the first screen, the Inventory tab
    expect(page.sent).toEqual(['GetReferenceData', 'GetInventoryList']);
    expect([isShown('inventoryList'), isShown('catalog')]).toEqual([true, false]);
    expect(textsOf('inventoryList')).toEqual([
      'Inventory', 'Add Food Type', 'Add batch',
      'Beef', 'Meat → Red Meat', '0 grams', '—',
      'Broccoli', 'Vegetables', '0 grams', '—',
      'Chicken', 'Meat → Poultry', '0 grams', '—',
      'Egg', 'Other', '0 pieces', '—',
      'Milk', 'Dairy → Liquid Dairy', '0 ml', '—',
      'Rice', 'Other', '0 grams', '—',
      'Spinach', 'Vegetables → Leafy Greens', '0 grams', '—',
      'Tomato', 'Vegetables', '0 pieces', '—',
    ]);
    await page.act(() => click('Recipes'));
    expect(recipesShown(APPENDIX_A_RECIPES)).toEqual(APPENDIX_A_RECIPES);
    // none of them is blocked, and with nothing in stock none can be cooked yet
    expect(textsOf('catalog').filter((text) => text === 'Nothing available to deduct')).toHaveLength(6);
    expect(textsOf('catalog')).not.toContain('Blocked');
    expect(notices()).toEqual([]);
  });

  it('stock in (row 3): a batch under a new name creates its Food Type, its quantity is edited and the batch removed, and a blank name is refused with "The name is empty."', JOURNEY, async () => {
    emptyStore();
    const page = await openPage(await startServer());
    const form = { slot: 'batchForm' } as const;
    await page.act(() => click('Add batch', { slot: 'inventoryList' }));
    const sentBefore = page.sent.length;

    // the form refuses what it cannot read, beside each field, and sends nothing
    await page.act(() => click('Save', form));
    expect([hintOf('Quantity', form), hintOf('Shelf life in days', form)]).toEqual([SAYS.FIELD_REQUIRED, SAYS.FIELD_REQUIRED]);
    await page.act(() => typeInto('Quantity', '1,000', form));
    await page.act(() => typeInto('Shelf life in days', '5', form));
    await page.act(() => click('Save', form));
    expect(hintOf('Quantity', form)).toBe(SAYS.QTY_FORMAT);
    await page.act(() => typeInto('Quantity', '1.2345', form));
    await page.act(() => typeInto('Shelf life in days', '2.5', form));
    await page.act(() => click('Save', form));
    expect([hintOf('Quantity', form), hintOf('Shelf life in days', form)]).toEqual([SAYS.QTY_DECIMALS, SAYS.INT_FORMAT]);
    expect(page.sent).toHaveLength(sentBefore);

    // with the name left blank, the form is sent, and the backend refuses it: the name is empty (row 3)
    await page.act(() => typeInto('Quantity', '500', form));
    await page.act(() => typeInto('Shelf life in days', '5', form));
    await page.act(() => choose('Unit', 'cartons', form));
    await page.act(() => click('Save', form));
    expect(page.sent.slice(sentBefore)).toEqual(['InboundBatch']);
    expect(notices()).toEqual([SAYS.NAME_EMPTY]);
    expect(hintOf('New Food Type name', form)).toBe(SAYS.NAME_EMPTY);

    // a name that no Food Type has creates one, in Other by default, together with its first batch
    await page.act(() => typeInto('New Food Type name', 'Yogurt', form));
    await page.act(() => click('Save', form));
    await dismissAll(page);
    expect(textsOf('batchForm')).toEqual([]);
    expect(inventoryRow('Yogurt')).toEqual(['Yogurt', 'Other', '500 cartons', 'Fresh 500', 'Fresh']);
    expect(textsOf('inventoryList').filter((text) => text === '—')).toHaveLength(8);

    // its detail, with the batch and the text of spec 4.2.1
    await page.act(() => click('Yogurt', { slot: 'inventoryList' }));
    expect(textsOf('foodTypeDetail')).toEqual(
      expect.arrayContaining(['Yogurt', 'Unit: cartons', 'Total: 500 cartons', 'Near-expiry threshold: 3 days (global default)', '500 cartons of Yogurt — expires in 5 days']),
    );
    // the quantity is the one field of a batch that can be edited
    await page.act(() => click('Edit quantity', { slot: 'foodTypeDetail' }));
    expect(textsOf('batchForm')).toEqual(expect.arrayContaining(['Edit quantity', 'Yogurt · cartons']));
    expect(inputOf('Quantity', form).value).toBe('500');
    await page.act(() => typeInto('Quantity', '450', form));
    await page.act(() => click('Save', form));
    expect(textsOf('foodTypeDetail')).toEqual(expect.arrayContaining(['Total: 450 cartons', '450 cartons of Yogurt — expires in 5 days']));
    // removing the batch asks first, then leaves the Food Type registered with nothing in it
    await page.act(() => click('Remove batch', { slot: 'foodTypeDetail' }));
    expect(textsOf('confirm')).toEqual(['Remove this batch?', '450 cartons of Yogurt — expires in 5 days', 'Remove batch', 'Cancel']);
    await page.act(() => click('Remove batch', { slot: 'confirm' }));
    expect(textsOf('confirm')).toEqual([]);
    expect(textsOf('foodTypeDetail')).toEqual(expect.arrayContaining(['Total: 0 cartons', '—', 'No batches']));
    await page.act(() => click('Back to inventory', { slot: 'foodTypeDetail' }));
    expect(inventoryRow('Yogurt')).toEqual(['Yogurt', 'Other', '0 cartons', '—']);
    expect(notices()).toEqual([]);
  });

  it('rescue and cook (row 4): a Chicken batch joins the seeded Chicken with its unit and category shown read-only; Near-Expiry at once, it is in the warning panel and rescued by the recommended recipes; one is cooked from the queue, and the stock drops by what the report says', JOURNEY, async () => {
    emptyStore();
    const page = await openPage(await startServer());
    const form = { slot: 'batchForm' } as const;

    // Add batch on the detail of an existing Food Type: it is picked, and its unit and category are
    // shown read-only, inherited, with no field to change them (row 4)
    await page.act(() => click('Chicken', { slot: 'inventoryList' }));
    await page.act(() => click('Add batch', { slot: 'foodTypeDetail' }));
    expect(pickedIn('Food Type', form)).toBe('Chicken');
    expect(textsOf('batchForm')).toEqual(expect.arrayContaining(['Unit: grams', 'Category: Meat → Poultry']));
    expect(textsOf('batchForm')).not.toEqual(expect.arrayContaining(['New Food Type name']));
    expect(textsOf('batchForm').filter((text) => text === 'Unit' || text === 'Category')).toEqual([]);
    // the same holds when the Food Type is picked in the form that the list opens
    await page.act(() => click('Cancel', form));
    await page.act(() => click('Back to inventory', { slot: 'foodTypeDetail' }));
    await page.act(() => click('Add batch', { slot: 'inventoryList' }));
    await page.act(() => pick('Food Type', 'Chicken', form));
    expect(textsOf('batchForm')).toEqual(expect.arrayContaining(['Unit: grams', 'Category: Meat → Poultry']));
    expect(textsOf('batchForm')).not.toContain('New Food Type name');

    // a 3-day shelf life with the default 3-day threshold is Near-Expiry at once
    await page.act(() => typeInto('Quantity', '500', form));
    await page.act(() => typeInto('Shelf life in days', '3', form));
    await page.act(() => click('Save', form));
    expect(inventoryRow('Chicken')).toEqual(['Chicken', 'Meat → Poultry', '500 grams', 'Near-Expiry 500', 'Near-Expiry']);

    await page.act(() => click('Warnings'));
    expect(textsOf('warnings')).toEqual(['Warning Panel', 'Near-Expiry', '500 grams of Chicken — expires in 3 days', 'Near-Expiry']);

    // no recipe is a full match on Chicken alone, so the recipes that rescue it are Partial Matches
    await page.act(() => click('Recommendations'));
    const rescuers = ['Chicken Broccoli Gratin', 'Chicken Fried Rice', 'Vietnamese Chicken Rice'];
    expect(textsOf('recommendations').filter((text) => APPENDIX_A_RECIPES.includes(text))).toEqual(rescuers);
    expect(textsOf('recommendations')).toContain('Partial Matches');
    expect(textsOf('recommendations').filter((text) => text === 'Rescues near-expiry stock')).toHaveLength(3);

    // Open in Cook takes it to the catalog, where it is queued and cooked
    await page.act(() => buttonWith('recommendations', 'Vietnamese Chicken Rice', 'Open in Cook').click());
    expect([isShown('catalog'), isShown('cookQueue')]).toEqual([true, true]);
    expect(textsOf('catalog')).toContain('Opened from Recommendations');
    await page.act(() => buttonWith('catalog', 'Vietnamese Chicken Rice', 'Add to cook queue').click());
    expect(textsOf('cookQueue')).toEqual(expect.arrayContaining(['1 in the queue', '1. Vietnamese Chicken Rice']));
    const sentBefore = page.sent.length;
    await page.act(() => click('Cook & Deduct', { slot: 'cookQueue' }));

    expect(page.sent.slice(sentBefore, sentBefore + 1)).toEqual(['CookRecipes']);
    expect(textsOf('cookReport')).toEqual([
      'Cook report',
      'Vietnamese Chicken Rice',
      'Cooked',
      'Deducted 250 grams of Chicken',
      'Missing Rice: needed 300 grams, available 0, so none was deducted',
      'Dismiss',
    ]);
    expect(textsOf('cookQueue')).toContain('0 in the queue');
    // 500 g less the 250 g of the report
    await page.act(() => click('Inventory'));
    expect(inventoryRow('Chicken')).toEqual(['Chicken', 'Meat → Poultry', '250 grams', 'Near-Expiry 250', 'Near-Expiry']);
    expect(notices()).toEqual([]);
  });

  it('taxonomy (row 15): a new category takes a Food Type and a threshold, the unit changes through the conversion modal, a Food Type with batches cannot be deleted ("Remove all 2 batches first."), and once it is empty it can', JOURNEY, async () => {
    emptyStore();
    const page = await openPage(await startServer());
    const categories = { slot: 'categories' } as const;

    // a category
    await page.act(() => click('Categories'));
    await page.act(() => click('Add food category', categories));
    expect(textsOf('categories')).toContain('New food category');
    await page.act(() => typeInto('Name', 'Fish', categories));
    await page.act(() => click('Save', categories));
    expect(textsOf('categories')).toEqual(expect.arrayContaining(['Fish', 'Threshold: inherited']));
    // its threshold: 0 days is refused by the backend, 5 days is kept
    await page.act(() => buttonWith('categories', 'Fish', 'Set threshold').click());
    await page.act(() => typeInto('Days', '0', categories));
    await page.act(() => click('Save', categories));
    expect(notices()).toEqual([SAYS.THRESHOLD_INVALID]);
    expect(hintOf('Days', categories)).toBe(SAYS.THRESHOLD_INVALID);
    await page.act(() => typeInto('Days', '5', categories));
    await page.act(() => click('Save', categories));
    await dismissAll(page);
    expect(textsOf('categories')).toContain('Threshold: 5 days');

    // Tomato moves into it, and takes its threshold
    await page.act(() => click('Inventory'));
    await page.act(() => click('Tomato', { slot: 'inventoryList' }));
    await page.act(() => click('Edit Food Type', { slot: 'foodTypeDetail' }));
    expect(textsOf('foodTypeForm')).toEqual(expect.arrayContaining(['Edit Food Type', 'Unit: pieces']));
    await page.act(() => pick('Category', 'Fish', { slot: 'foodTypeForm' }));
    await page.act(() => click('Save', { slot: 'foodTypeForm' }));
    expect(textsOf('foodTypeDetail')).toEqual(expect.arrayContaining(['Fish', 'Near-expiry threshold: 5 days (Parent category)']));
    // two batches: under the 5 days of Fish, 4 days left is Near-Expiry
    for (const [quantity, days] of [['2', '4'], ['3', '10']] as const) {
      await page.act(() => click('Add batch', { slot: 'foodTypeDetail' }));
      await page.act(() => typeInto('Quantity', quantity, { slot: 'batchForm' }));
      await page.act(() => typeInto('Shelf life in days', days, { slot: 'batchForm' }));
      await page.act(() => click('Save', { slot: 'batchForm' }));
    }
    expect(textsOf('foodTypeDetail')).toEqual(
      expect.arrayContaining(['Total: 5 pieces', '2 pieces of Tomato — expires in 4 days', 'Near-Expiry', '3 pieces of Tomato — expires in 10 days', 'Fresh']),
    );

    // the unit changes through the conversion modal: Cancel changes nothing, and Save waits for a quantity for every batch
    const modal = { slot: 'unitConversion' } as const;
    await page.act(() => click('Change unit', { slot: 'foodTypeDetail' }));
    expect(textsOf('unitConversion')).toEqual(expect.arrayContaining(['Change unit of Tomato', 'Now in pieces.', 'New unit']));
    await page.act(() => click('Cancel', modal));
    expect(textsOf('unitConversion')).toEqual([]);
    expect(textsOf('foodTypeDetail')).toContain('Unit: pieces');
    await page.act(() => click('Change unit', { slot: 'foodTypeDetail' }));
    const [first, second] = textsOf('unitConversion').filter((text) => /^\d+ pieces, expires \d{4}-\d{2}-\d{2}$/.test(text));
    if (first === undefined || second === undefined) expect.unreachable('the modal has a field for each of the two batches');
    const save = (): HTMLButtonElement => [...slotElement('unitConversion').querySelectorAll('button')].find((each) => each.textContent === 'Save') ?? expect.unreachable('no Save');
    await page.act(() => choose('New unit', 'kg', modal));
    await page.act(() => typeInto(first, '0.3', modal));
    expect(save().disabled).toBe(true);
    await page.act(() => typeInto(second, '0.45', modal));
    expect(save().disabled).toBe(false);
    await page.act(() => click('Save', modal));
    expect(textsOf('foodTypeDetail')).toEqual(
      expect.arrayContaining(['Unit: kg', 'Total: 0.75 kg', '0.3 kg of Tomato — expires in 4 days', '0.45 kg of Tomato — expires in 10 days']),
    );

    // a Food Type that still has batches cannot be deleted; the dialog names the recipe it would block
    await page.act(() => click('Delete Food Type', { slot: 'foodTypeDetail' }));
    expect(textsOf('confirm')).toEqual(['Delete Tomato?', 'These recipes will become blocked: Tomato Egg Stir-Fry.', 'Delete Food Type', 'Cancel']);
    await page.act(() => click('Delete Food Type', { slot: 'confirm' }));
    expect(notices()).toEqual(['Remove all 2 batches first.']);
    await page.act(() => click('Cancel', { slot: 'confirm' }));
    await dismissAll(page);
    // once its batches are removed, it can be deleted, and the detail closes
    for (let left = 2; left > 0; left -= 1) {
      await page.act(() => click('Remove batch', { slot: 'foodTypeDetail' }));
      await page.act(() => click('Remove batch', { slot: 'confirm' }));
    }
    expect(textsOf('foodTypeDetail')).toContain('No batches');
    await page.act(() => click('Delete Food Type', { slot: 'foodTypeDetail' }));
    await page.act(() => click('Delete Food Type', { slot: 'confirm' }));
    expect([isShown('inventoryList'), isShown('foodTypeDetail')]).toEqual([true, false]);
    expect(textsOf('inventoryList')).not.toContain('Tomato');
    // the recipe that used it is blocked now, with the name of the Food Type it misses
    await page.act(() => click('Recipes'));
    expect(textsOf('catalog')).toEqual(expect.arrayContaining(['Blocked', 'Missing food type: Tomato']));
    expect(notices()).toEqual([]);
  });

  it('recipes: a recipe is created, edited and deleted, and a built-in recipe is deleted by the same rules', JOURNEY, async () => {
    emptyStore();
    const page = await openPage(await startServer());
    const form = { slot: 'recipeForm' } as const;
    await page.act(() => click('Recipes'));

    // a new recipe: the unit of a row starts as the unit of its Food Type
    await page.act(() => click('New recipe', { slot: 'catalog' }));
    expect(textsOf('recipeForm')).toEqual(expect.arrayContaining(['New recipe', 'Recipe name', 'Cuisine', 'Ingredients']));
    await page.act(() => typeInto('Recipe name', 'Beef Rice Bowl', form));
    await page.act(() => pick('Cuisine', 'Chinese Cuisine', form));
    await page.act(() => pick('Food Type', 'Beef', form));
    expect(pickedIn('Unit', form)).toBe('grams');
    await page.act(() => typeInto('Quantity', '200', form));
    // a second row that uses Beef again is refused by the backend
    await page.act(() => click('Add ingredient', form));
    await page.act(() => pick('Food Type', 'Beef', { ...form, nth: 1 }));
    await page.act(() => typeInto('Quantity', '150', { ...form, nth: 1 }));
    await page.act(() => click('Save', form));
    expect(notices()).toEqual([SAYS.DUP_INGREDIENT]);
    await page.act(() => pick('Food Type', 'Rice', { ...form, nth: 1 }));
    await page.act(() => click('Save', form));
    await dismissAll(page);
    expect(textsOf('recipeForm')).toEqual([]);
    const withBowl = [APPENDIX_A_RECIPES[0] ?? '', 'Beef Rice Bowl', ...APPENDIX_A_RECIPES.slice(1)];
    expect(recipesShown([...APPENDIX_A_RECIPES, 'Beef Rice Bowl'])).toEqual(withBowl);
    expect(textsOf('catalog')).toEqual(expect.arrayContaining(['Beef 200 grams', 'Rice 150 grams']));

    // it is edited: the form opens with what it holds
    await page.act(() => buttonWith('catalog', 'Beef Rice Bowl', 'Edit').click());
    expect(textsOf('recipeForm')).toContain('Edit recipe');
    expect([inputOf('Recipe name', form).value, pickedIn('Cuisine', form), inputOf('Quantity', form).value]).toEqual(['Beef Rice Bowl', 'Chinese Cuisine', '200']);
    await page.act(() => typeInto('Recipe name', 'Beef and Rice Bowl', form));
    await page.act(() => typeInto('Quantity', '250', form));
    await page.act(() => click('Save', form));
    const edited = [APPENDIX_A_RECIPES[0] ?? '', 'Beef and Rice Bowl', ...APPENDIX_A_RECIPES.slice(1)];
    expect(recipesShown([...APPENDIX_A_RECIPES, 'Beef Rice Bowl', 'Beef and Rice Bowl'])).toEqual(edited);
    expect(textsOf('catalog')).toContain('Beef 250 grams');

    // it is deleted, after a confirmation
    await page.act(() => buttonWith('catalog', 'Beef and Rice Bowl', 'Delete').click());
    expect(textsOf('confirm')).toEqual(['Delete Beef and Rice Bowl?', 'The recipe is also removed from the cook queue.', 'Delete recipe', 'Cancel']);
    await page.act(() => click('Delete recipe', { slot: 'confirm' }));
    expect(recipesShown([...APPENDIX_A_RECIPES, 'Beef and Rice Bowl'])).toEqual(APPENDIX_A_RECIPES);
    // a built-in recipe is deleted the same way
    await page.act(() => buttonWith('catalog', 'Spinach Omelette', 'Delete').click());
    await page.act(() => click('Delete recipe', { slot: 'confirm' }));
    expect(recipesShown(APPENDIX_A_RECIPES)).toEqual(APPENDIX_A_RECIPES.filter((name) => name !== 'Spinach Omelette'));
    expect(notices()).toEqual([]);
  });

  it('time and restart (row 20): as Simulated Today moves forward the statuses follow, and a new app on the same server, then the restarted server, show the same state', JOURNEY, async () => {
    emptyStore();
    const server = await startServer();
    let page = await openPage(server);
    const form = { slot: 'batchForm' } as const;

    await setToday(page, '2026-10-01');
    expect(textsOf('demo')).toEqual(['Today: 2026-10-01', 'Simulated', 'Set Simulated Today']);
    expect(textsOf('shell')).toContain('2026-10-01');
    await page.act(() => click('Add batch', { slot: 'inventoryList' }));
    await page.act(() => pick('Food Type', 'Chicken', form));
    await page.act(() => typeInto('Quantity', '300', form));
    await page.act(() => typeInto('Shelf life in days', '5', form));
    await page.act(() => click('Save', form));
    expect(inventoryRow('Chicken')).toEqual(['Chicken', 'Meat → Poultry', '300 grams', 'Fresh 300', 'Fresh']);

    // two days on, 3 days are left: Near-Expiry; on Oct 7 it expired yesterday
    await setToday(page, '2026-10-03');
    expect(inventoryRow('Chicken')).toEqual(['Chicken', 'Meat → Poultry', '300 grams', 'Near-Expiry 300', 'Near-Expiry']);
    await setToday(page, '2026-10-07');
    expect(inventoryRow('Chicken')).toEqual(['Chicken', 'Meat → Poultry', '300 grams', 'Expired 300', 'Expired']);
    await page.act(() => click('Warnings'));
    expect(textsOf('warnings')).toEqual(expect.arrayContaining(['No near-expiry items', 'Expired', '300 grams of Chicken — expired 1 day ago']));
    await page.act(() => click('Inventory'));
    const shown = [textsOf('shell'), textsOf('demo'), textsOf('inventoryList')];

    // a new app against the same server, as a reload of the page gives
    page.close();
    page = await openPage(server);
    expect([textsOf('shell'), textsOf('demo'), textsOf('inventoryList')]).toEqual(shown);

    // the server stops: the page says that it cannot reach it, and keeps what it shows
    await stopServer(server);
    await page.act(() => click('Warnings'));
    expect(notices().length).toBeGreaterThan(0);
    expect(notices().every((text) => text.startsWith(`${SAYS.NETWORK_ERROR} (NETWORK_ERROR: `))).toBe(true);
    // it starts again on the same database and port, and the same state appears
    await startServer(server.port);
    await dismissAll(page);
    await page.act(() => click('Inventory'));
    expect([textsOf('shell'), textsOf('demo'), textsOf('inventoryList')]).toEqual(shown);
    expect(notices()).toEqual([]);
  });
});
