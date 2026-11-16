import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeMysqlPool, createMysqlPool, createStoreWriteGateway, migrate } from '@freshrescue/backend';
import { startApi } from '../src/compose';

// The exception and degradation matrix of spec v1.3, section 5 (plan, phase 10, row 2): one test for each
// row, titled with its row number, against the API as main.ts starts it, with real Express and real MySQL.
// Row 4 (the unit and category of an existing Food Type shown read-only in the inbound form) is about the
// page, so the journeys in tools/journeys.e2e.test.ts exercise it, and this file holds the other 22.
//
// Each test starts from an empty test database, so the first start seeds spec Appendix A: 8 Food Types
// with no stock and 6 recipes. A refused request must change nothing, which `everything()` checks by
// comparing every read model before and after. The words that a person reads ("Nothing available to
// deduct") are the frontend's; the backend answers with the codes, statuses and states checked here.

const DATABASE_URL = process.env.DATABASE_URL ?? expect.unreachable('DATABASE_URL is not set: run this file with npm run test:e2e');

/** The eight logical tables of the store, as the `changeset` contract names them. */
const STORE_TABLES = ['foodCategories', 'foodTypes', 'batches', 'recipeCategories', 'recipes', 'recipeIngredients', 'settings', 'counters'] as const;

// The replies and read models, as far as these tests read them. apps/api imports its own package only, so
// the shapes of the `messages` and `views` contracts are written out here.
type Status = 'fresh' | 'nearExpiry' | 'expired';
type Answer = {
  readonly status: number;
  readonly ok: boolean;
  readonly data: unknown;
  readonly error?: { readonly code: string; readonly family: string; readonly detail?: string };
  readonly meta: { readonly today: string | null };
};
type CategoryNode = {
  readonly id: number;
  readonly name: string;
  readonly isSystem: boolean;
  readonly customThresholdDays: number | null;
  readonly children: readonly CategoryNode[];
};
type Reference = {
  readonly today: string;
  readonly simulatedToday: string | null;
  readonly foodCategories: readonly CategoryNode[];
  readonly cuisines: readonly CategoryNode[];
  readonly foodTypes: readonly { readonly id: number; readonly name: string; readonly unit: string; readonly categoryId: number }[];
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
  readonly foodTypeId: number;
  readonly name: string;
  readonly categoryId: number;
  readonly categoryPath: readonly string[];
  readonly unit: string;
  readonly customThresholdDays: number | null;
  readonly threshold: { readonly days: number; readonly source: string };
  readonly total: number;
  readonly byStatus: Readonly<Record<Status, number>>;
  readonly overall: Status | null;
  readonly batches: readonly BatchView[];
  readonly referencingRecipes: readonly { readonly recipeId: number; readonly name: string }[];
};
type InventoryRow = {
  readonly foodTypeId: number;
  readonly name: string;
  readonly categoryPath: readonly string[];
  readonly unit: string;
  readonly total: number;
  readonly byStatus: Readonly<Record<Status, number>>;
  readonly overall: Status | null;
};
type Line = {
  readonly foodTypeId: number;
  readonly name: string;
  readonly requiredQuantity: number;
  readonly requiredUnit: string;
  readonly available: number | null;
  readonly state: string;
  readonly rescued: boolean;
  readonly foodTypeUnit: string | null;
};
type CatalogRow = {
  readonly recipeId: number;
  readonly name: string;
  readonly cuisineId: number;
  readonly cuisineName: string;
  readonly status: string;
  readonly availableCount: number;
  readonly totalCount: number;
  readonly ingredients: readonly Line[];
};
type Recommendations = {
  readonly tier: 'full' | 'partial' | null;
  readonly recipes: readonly { readonly recipeId: number; readonly name: string; readonly ingredients: readonly Line[] }[];
  readonly emptyState: 'noNearExpiry' | 'noRescue' | null;
};
type WarningRow = { readonly batchId: number; readonly foodTypeName: string; readonly quantity: number; readonly daysLeft: number; readonly status: Status };
type Warnings = { readonly nearExpiry: readonly WarningRow[]; readonly expired: readonly WarningRow[] };
type Deducted = { readonly foodTypeId: number; readonly name: string; readonly quantity: number; readonly unit: string };
type Missing = { readonly foodTypeId: number; readonly name: string; readonly needed: number; readonly available: number; readonly unit: string };
type CookEntry = {
  readonly recipeId: number;
  readonly recipeName: string;
  readonly outcome: 'cooked' | 'skipped';
  readonly reason: string | null;
  readonly deducted: readonly Deducted[];
  readonly missing: readonly Missing[];
};
type Expiry = { readonly days: number } | { readonly date: string };
type Row = { readonly foodTypeId: number; readonly quantity: number; readonly unit: string };

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

/** The status and the code of a reply, the two things that tell a refusal apart. */
const refusal = (answer: Answer): readonly [number, string | undefined] => [answer.status, answer.error?.code];

const reference = (): Promise<Reference> => ok<Reference>(query('GetReferenceData'));
const detailOf = (foodTypeId: number): Promise<Detail> => ok<Detail>(query('GetFoodTypeDetail', { foodTypeId }));
const inventory = async (): Promise<readonly InventoryRow[]> => (await ok<{ rows: InventoryRow[] }>(query('GetInventoryList'))).rows;
const catalog = async (cuisineId: number | null = null): Promise<readonly CatalogRow[]> =>
  (await ok<{ rows: CatalogRow[] }>(query('GetCatalog', { cuisineId }))).rows;
const warnings = (): Promise<Warnings> => ok<Warnings>(query('GetWarningPanel'));
const recommendations = (): Promise<Recommendations> => ok<Recommendations>(query('GetRecommendations'));
const cook = async (recipeIds: readonly number[]): Promise<readonly CookEntry[]> =>
  (await ok<{ reports: CookEntry[] }>(command('CookRecipes', { recipeIds }))).reports;

/** Sets Simulated Today, the demo date that replaces the device date everywhere (spec 4.3.4); null clears it. */
const setToday = (date: string | null): Promise<unknown> => ok(command('SetSimulatedToday', { date }));

/** The payload of an inbound to an existing Food Type, as the inbound form sends it once the Food Type is picked. */
const inboundOf = (foodTypeId: number, quantity: unknown, expiry: Expiry | object) => ({ foodTypeId, foodName: null, categoryId: null, unit: null, quantity, expiry });
const inbound = (foodTypeId: number, quantity: number, expiry: Expiry): Promise<unknown> => ok(command('InboundBatch', inboundOf(foodTypeId, quantity, expiry)));

/** The payload of a new recipe in the cuisine `Other`. */
const recipeOf = (name: string, rows: readonly Row[], cuisineId: number | null = null) => ({ recipeId: null, name, draft: { cuisineId, rows } });

async function foodTypeIdOf(name: string): Promise<number> {
  return (await reference()).foodTypes.find((foodType) => foodType.name === name)?.id ?? expect.unreachable(`there is no Food Type ${name}`);
}

/** The food categories of both levels, Parents and Children, as one list. */
const allCategories = (nodes: readonly CategoryNode[]): readonly CategoryNode[] => nodes.flatMap((node) => [node, ...node.children]);

async function categoryOf(name: string): Promise<CategoryNode> {
  return allCategories((await reference()).foodCategories).find((node) => node.name === name) ?? expect.unreachable(`there is no food category ${name}`);
}

async function cuisineOf(name: string): Promise<CategoryNode> {
  return (await reference()).cuisines.find((node) => node.name === name) ?? expect.unreachable(`there is no cuisine ${name}`);
}

async function recipeNamed(name: string): Promise<CatalogRow> {
  return (await catalog()).find((row) => row.name === name) ?? expect.unreachable(`the catalog has no recipe ${name}`);
}

const lineOf = (row: CatalogRow, name: string): Line => row.ingredients.find((line) => line.name === name) ?? expect.unreachable(`${row.name} has no ${name}`);

/**
 * Every read model the screens are drawn from: the six queries, and the detail of every Food Type. A
 * refused request must leave all of them as they were.
 */
async function everything(): Promise<readonly Answer[]> {
  const { foodTypes } = await reference();
  return Promise.all([
    query('GetReferenceData'),
    query('GetInventoryList'),
    query('GetWarningPanel'),
    query('GetRecommendations'),
    query('GetCatalog', { cuisineId: null }),
    ...foodTypes.map((foodType) => query('GetFoodTypeDetail', { foodTypeId: foodType.id })),
  ]);
}

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

describe('the exception matrix of spec v1.3, section 5, over real HTTP and real MySQL', () => {
  it('row 1: an inbound whose expiration date has passed is blocked with PAST_EXPIRY, and a shelf life of 0 days or a date of today is accepted', async () => {
    await setToday('2026-10-01');
    const rice = await foodTypeIdOf('Rice');
    const before = await everything();

    const pastDate = await command('InboundBatch', inboundOf(rice, 1_000, { date: '2026-09-30' }));
    const pastDays = await command('InboundBatch', inboundOf(rice, 1_000, { days: -1 }));
    // the expiry is a shelf life or a date: both at once is not a request the form can send
    const both = await command('InboundBatch', inboundOf(rice, 1_000, { days: 3, date: '2026-10-04' }));

    expect(refusal(pastDate)).toEqual([422, 'PAST_EXPIRY']);
    expect(refusal(pastDays)).toEqual([422, 'DAYS_INVALID']);
    expect(refusal(both)).toEqual([400, 'BAD_COMBINATION']);
    expect(await everything()).toEqual(before);
    // the boundary: S = 0 means "expires today", and a date of today is on or after today
    await inbound(rice, 1_000, { days: 0 });
    await inbound(rice, 2_000, { date: '2026-10-01' });
    expect((await detailOf(rice)).batches.map((batch) => [batch.quantity, batch.inboundDate, batch.expirationDate, batch.daysLeft])).toEqual([
      [1_000, '2026-10-01', '2026-10-01', 0],
      [2_000, '2026-10-01', '2026-10-01', 0],
    ]);
  });

  it('row 2: an inbound, a batch edit or a unit change whose post-change total would exceed 500,000 is blocked with CAP_EXCEEDED, Expired stock counting, and exactly 500,000 is allowed', async () => {
    await setToday('2026-10-01');
    const rice = await foodTypeIdOf('Rice');
    await inbound(rice, 300_000_000, { days: 1 });
    await inbound(rice, 200_000_000, { days: 30 }); // the total is exactly 500,000
    const [first, second] = (await detailOf(rice)).batches;
    if (first === undefined || second === undefined) expect.unreachable('Rice has two batches');
    const before = await everything();

    // inbound: existing sum + new quantity
    const addOne = await command('InboundBatch', inboundOf(rice, 1, { days: 30 }));
    // batch edit: existing sum - the edited batch's old quantity + its new quantity
    const editUp = await command('EditBatchQuantity', { batchId: second.id, quantity: 200_000_001 });
    // unit change: the sum of the new quantities entered in the conversion modal
    const convert = await command('ChangeFoodTypeUnit', {
      foodTypeId: rice,
      unit: 'kg',
      batches: [
        { batchId: first.id, quantity: 300_000_000 },
        { batchId: second.id, quantity: 200_000_001 },
      ],
    });
    // one quantity above 500,000 is too large on its own, before any sum is made
    const tooLarge = await command('InboundBatch', inboundOf(await foodTypeIdOf('Beef'), 500_000_001, { days: 3 }));

    expect([refusal(addOne), refusal(editUp), refusal(convert)]).toEqual([
      [422, 'CAP_EXCEEDED'],
      [422, 'CAP_EXCEEDED'],
      [422, 'CAP_EXCEEDED'],
    ]);
    expect(refusal(tooLarge)).toEqual([422, 'QTY_TOO_LARGE']);
    expect(await everything()).toEqual(before);

    // an Expired batch counts toward the cap until it is removed
    await setToday('2026-10-03');
    expect((await detailOf(rice)).batches.map((batch) => batch.status)).toEqual(['expired', 'fresh']);
    expect(refusal(await command('InboundBatch', inboundOf(rice, 1, { days: 30 })))).toEqual([422, 'CAP_EXCEEDED']);
    // what keeps the total within 500,000 goes through: an edit down, an inbound back up to exactly the cap, a unit change at the cap
    await ok(command('EditBatchQuantity', { batchId: second.id, quantity: 150_000_000 }));
    await inbound(rice, 50_000_000, { days: 30 });
    const batches = (await detailOf(rice)).batches;
    await ok(command('ChangeFoodTypeUnit', { foodTypeId: rice, unit: 'kg', batches: batches.map((batch) => ({ batchId: batch.id, quantity: batch.quantity })) }));
    expect(await detailOf(rice)).toMatchObject({ unit: 'kg', total: 500_000_000 });
  });

  it('row 3: a name that is empty, longer than 200 characters or a duplicate in its scope, and a quantity of 0 or less, not a number or with more than 3 decimals, are refused, and nothing is written', async () => {
    const rice = await foodTypeIdOf('Rice');
    const before = await everything();
    const foodTypeNamed = (name: string) => ({ foodTypeId: null, name, categoryId: null, unit: 'grams', thresholdDays: null });

    const blank = await command('SaveFoodType', foodTypeNamed('   '));
    const nameless = await command('InboundBatch', { foodTypeId: null, foodName: null, categoryId: null, unit: 'grams', quantity: 1_000, expiry: { days: 3 } });
    const tooLong = await command('SaveFoodType', foodTypeNamed('x'.repeat(201)));
    // names are trimmed and compared without case: "  rICE " is the seeded Rice
    const duplicate = await command('SaveFoodType', foodTypeNamed('  rICE '));
    const duplicateRecipe = await command('SaveRecipe', recipeOf('tomato egg stir-fry', [{ foodTypeId: rice, quantity: 1_000, unit: 'grams' }]));
    const zero = await command('InboundBatch', inboundOf(rice, 0, { days: 3 }));
    const negative = await command('InboundBatch', inboundOf(rice, -1_000, { days: 3 }));
    // 0.0015 is 1.5 thousandths: more than 3 decimals, never rounded
    const fourDecimals = await command('InboundBatch', inboundOf(rice, 1.5, { days: 3 }));
    // on the wire a quantity is a number of thousandths, so text is the wrong type; the page refuses the text "1,000" itself (the journeys)
    const notANumber = await command('InboundBatch', inboundOf(rice, '1,000', { days: 3 }));
    // the same quantity rule applies to a recipe's Q_req, and a recipe needs at least one ingredient row, with each Food Type in one row only
    const recipeZero = await command('SaveRecipe', recipeOf('Rice Bowl', [{ foodTypeId: rice, quantity: 0, unit: 'grams' }]));
    const noIngredient = await command('SaveRecipe', recipeOf('Rice Bowl', []));
    const twice = await command('SaveRecipe', recipeOf('Rice Bowl', [{ foodTypeId: rice, quantity: 1_000, unit: 'grams' }, { foodTypeId: rice, quantity: 2_000, unit: 'grams' }]));

    expect([refusal(blank), refusal(nameless), refusal(tooLong), refusal(duplicate), refusal(duplicateRecipe)]).toEqual([
      [422, 'NAME_EMPTY'],
      [422, 'NAME_EMPTY'],
      [422, 'NAME_TOO_LONG'],
      [422, 'NAME_DUPLICATE'],
      [422, 'NAME_DUPLICATE'],
    ]);
    expect([refusal(zero), refusal(negative), refusal(fourDecimals), refusal(notANumber), refusal(recipeZero)]).toEqual([
      [422, 'QTY_NOT_POSITIVE'],
      [422, 'QTY_NOT_POSITIVE'],
      [422, 'QTY_NOT_INTEGER'],
      [400, 'WRONG_TYPE'],
      [422, 'QTY_NOT_POSITIVE'],
    ]);
    expect([refusal(noIngredient), refusal(twice)]).toEqual([
      [409, 'NO_INGREDIENTS'],
      [409, 'DUP_INGREDIENT'],
    ]);
    expect(await everything()).toEqual(before);
    // the boundaries are allowed: 200 characters, the smallest quantity 0.001, a rename of a record to itself in
    // another case (milk -> Milk), and a name that another scope uses (a Food Type may share a category's name)
    await ok(command('SaveFoodType', foodTypeNamed('y'.repeat(200))));
    await inbound(rice, 1, { days: 3 });
    await ok(command('SaveFoodType', { foodTypeId: rice, name: 'RICE', categoryId: null, unit: null, thresholdDays: null }));
    await ok(command('SaveFoodType', foodTypeNamed('Dairy')));
    expect((await inventory()).map((row) => row.name)).toEqual(expect.arrayContaining(['y'.repeat(200), 'RICE', 'Dairy']));
    expect((await detailOf(rice)).batches.map((batch) => batch.quantity)).toEqual([1]);
  });

  it('row 5: changing the unit of a Food Type that has batches needs a new quantity for every batch, Expired ones included, and converts all of them at once or none', async () => {
    await setToday('2026-10-01');
    const chicken = await foodTypeIdOf('Chicken');
    await inbound(chicken, 100_000, { days: 0 });
    await inbound(chicken, 200_000, { days: 10 });
    await setToday('2026-10-02');
    const [expired, fresh] = (await detailOf(chicken)).batches;
    if (expired === undefined || fresh === undefined) expect.unreachable('Chicken has two batches');
    const bothBatches = [
      { batchId: expired.id, quantity: 500 },
      { batchId: fresh.id, quantity: 1_000 },
    ];
    const before = await everything();

    const leftOut = await command('ChangeFoodTypeUnit', { foodTypeId: chicken, unit: 'pieces', batches: [{ batchId: fresh.id, quantity: 1_000 }] });
    const oneInvalid = await command('ChangeFoodTypeUnit', { foodTypeId: chicken, unit: 'pieces', batches: [{ batchId: expired.id, quantity: 0 }, { batchId: fresh.id, quantity: 1_000 }] });
    const sameUnit = await command('ChangeFoodTypeUnit', { foodTypeId: chicken, unit: 'grams', batches: bothBatches });
    const notAUnit = await command('ChangeFoodTypeUnit', { foodTypeId: chicken, unit: 'cups', batches: bothBatches });

    expect([expired.status, fresh.status]).toEqual(['expired', 'fresh']);
    expect([refusal(leftOut), refusal(oneInvalid), refusal(sameUnit), refusal(notAUnit)]).toEqual([
      [409, 'BATCH_SET_MISMATCH'],
      [422, 'QTY_NOT_POSITIVE'],
      [409, 'UNIT_UNCHANGED'],
      [422, 'UNIT_UNKNOWN'],
    ]);
    expect(await everything()).toEqual(before);
    // with every batch given a valid quantity, the unit and all the quantities change in one commit;
    // expiration dates and createdSeq are untouched
    await ok(command('ChangeFoodTypeUnit', { foodTypeId: chicken, unit: 'pieces', batches: bothBatches }));
    const after = await detailOf(chicken);
    expect(after.unit).toBe('pieces');
    expect(after.batches.map((batch) => [batch.id, batch.quantity, batch.expirationDate, batch.createdSeq, batch.status])).toEqual([
      [expired.id, 500, expired.expirationDate, expired.createdSeq, 'expired'],
      [fresh.id, 1_000, fresh.expirationDate, fresh.createdSeq, 'fresh'],
    ]);
    // with no batch, the unit changes at once
    const egg = await foodTypeIdOf('Egg');
    await ok(command('ChangeFoodTypeUnit', { foodTypeId: egg, unit: 'cartons', batches: [] }));
    expect((await detailOf(egg)).unit).toBe('cartons');
  });

  it('row 6: a recipe whose Required Unit differs from the unit of its Food Type is a Unit Conflict: blocked in the catalog, hidden from the recommendations, and skipped when cooked', async () => {
    const chicken = await foodTypeIdOf('Chicken');
    // a Required Unit that differs is allowed when the recipe is saved: it only makes the recipe blocked
    const { recipeId } = await ok<{ recipeId: number }>(command('SaveRecipe', recipeOf('Chicken Bites', [{ foodTypeId: chicken, quantity: 4_000, unit: 'pieces' }])));
    // Chicken is near-expiry and plentiful, so without the conflict the recipe would rescue it
    await inbound(chicken, 500_000, { days: 2 });

    const row = await recipeNamed('Chicken Bites');
    const recommended = await recommendations();
    const [report] = await cook([recipeId]);

    expect(row.status).toBe('blocked');
    expect(row.ingredients).toEqual([expect.objectContaining({ name: 'Chicken', state: 'unitConflict', requiredUnit: 'pieces', foodTypeUnit: 'grams', available: null })]);
    expect(recommended.recipes.map((recipe) => recipe.name)).not.toContain('Chicken Bites');
    expect(report).toEqual({ recipeId, recipeName: 'Chicken Bites', outcome: 'skipped', reason: 'blocked', deducted: [], missing: [] });
    expect((await detailOf(chicken)).total).toBe(500_000);
    // fixing the recipe (or the Food Type's unit) clears the conflict: now it is a full match that rescues Chicken
    await ok(command('SaveRecipe', { recipeId, name: 'Chicken Bites', draft: { cuisineId: null, rows: [{ foodTypeId: chicken, quantity: 400_000, unit: 'grams' }] } }));
    expect((await recipeNamed('Chicken Bites')).status).toBe('full');
    expect(await recommendations()).toMatchObject({ tier: 'full', recipes: [expect.objectContaining({ recipeId, name: 'Chicken Bites' })] });
  });

  it('row 7: deleting a Food Type that recipes use (allowed only with no batch) keeps each recipe in the catalog, blocked with the missing Food Type named, hidden from the recommendations, and editable or deletable', async () => {
    const egg = await foodTypeIdOf('Egg');
    const tomato = await foodTypeIdOf('Tomato');
    // the detail lists the recipes that will become blocked, for the confirmation
    expect((await detailOf(egg)).referencingRecipes.map((recipe) => recipe.name)).toEqual(['Chicken Fried Rice', 'Spinach Omelette', 'Tomato Egg Stir-Fry']);

    await ok(command('DeleteFoodType', { foodTypeId: egg }));
    // a near-expiry Tomato would make Tomato Egg Stir-Fry a rescue, if it were not blocked
    await inbound(tomato, 2_000, { days: 1 });

    expect(refusal(await query('GetFoodTypeDetail', { foodTypeId: egg }))).toEqual([409, 'FOOD_TYPE_NOT_FOUND']);
    for (const name of ['Chicken Fried Rice', 'Spinach Omelette', 'Tomato Egg Stir-Fry']) {
      const row = await recipeNamed(name);
      expect(row.status, name).toBe('blocked');
      // the row keeps the deleted name, which the frontend shows as "Missing food type: Egg"
      expect(lineOf(row, 'Egg'), name).toMatchObject({ foodTypeId: egg, state: 'missingFoodType' });
    }
    expect(await recommendations()).toEqual({ tier: null, recipes: [], emptyState: 'noRescue' });
    expect((await cook([(await recipeNamed('Tomato Egg Stir-Fry')).recipeId])).map((entry) => [entry.outcome, entry.reason])).toEqual([['skipped', 'blocked']]);

    // references are by id: a new Food Type named Egg does not repair the recipes
    const { foodTypeId: newEgg } = await ok<{ foodTypeId: number }>(command('SaveFoodType', { foodTypeId: null, name: 'Egg', categoryId: null, unit: 'pieces', thresholdDays: null }));
    const stirFry = await recipeNamed('Tomato Egg Stir-Fry');
    expect(stirFry.status).toBe('blocked');
    // the person edits the recipe: saved as it is, it still names the deleted Food Type; with the new Egg it is repaired
    const rowsWith = (foodTypeId: number): Row[] =>
      stirFry.ingredients.map((line) => ({ foodTypeId: line.foodTypeId === egg ? foodTypeId : line.foodTypeId, quantity: line.requiredQuantity, unit: line.requiredUnit }));
    const asItWas = await command('SaveRecipe', { recipeId: stirFry.recipeId, name: stirFry.name, draft: { cuisineId: stirFry.cuisineId, rows: rowsWith(egg) } });
    expect(refusal(asItWas)).toEqual([409, 'UNKNOWN_FOOD_TYPE']);
    await ok(command('SaveRecipe', { recipeId: stirFry.recipeId, name: stirFry.name, draft: { cuisineId: stirFry.cuisineId, rows: rowsWith(newEgg) } }));
    expect((await recipeNamed('Tomato Egg Stir-Fry')).status).toBe('partial');
    // or deletes it: it is gone, and a second delete finds nothing to delete
    const omelette = await recipeNamed('Spinach Omelette');
    await ok(command('DeleteRecipe', { recipeId: omelette.recipeId }));
    expect(refusal(await command('DeleteRecipe', { recipeId: omelette.recipeId }))).toEqual([409, 'RECIPE_NOT_FOUND']);
    expect((await catalog()).map((row) => row.name)).not.toContain('Spinach Omelette');
  });

  it('row 8: renaming a food category or a cuisine changes its name in place, and every Food Type, batch and recipe stays bound to it; Other cannot be renamed', async () => {
    const beef = await foodTypeIdOf('Beef');
    const meat = await categoryOf('Meat');
    const chinese = await cuisineOf('Chinese Cuisine');
    await inbound(beef, 300_000, { days: 10 });
    const beefBefore = await detailOf(beef);
    const chineseBefore = await catalog(chinese.id);

    await ok(command('SaveCategory', { scope: 'foodCategory', categoryId: meat.id, parentId: null, name: 'Meats' }));
    await ok(command('SaveCategory', { scope: 'cuisine', categoryId: chinese.id, parentId: null, name: 'Cantonese' }));

    expect(await detailOf(beef)).toEqual({ ...beefBefore, categoryPath: ['Meats', 'Red Meat'] });
    expect(await catalog(chinese.id)).toEqual(chineseBefore.map((row) => ({ ...row, cuisineName: 'Cantonese' })));
    expect(chineseBefore.map((row) => row.name)).toEqual(['Beef and Broccoli Stir-Fry', 'Chicken Fried Rice', 'Tomato Egg Stir-Fry']);
    // a rename that differs only in case is the category itself, not a duplicate
    await ok(command('SaveCategory', { scope: 'foodCategory', categoryId: meat.id, parentId: null, name: 'MEATS' }));
    expect((await detailOf(beef)).categoryPath).toEqual(['MEATS', 'Red Meat']);
    // the system Other of either tree keeps its name
    const otherFood = (await reference()).foodCategories.find((node) => node.isSystem) ?? expect.unreachable('no food Other');
    const otherCuisine = (await reference()).cuisines.find((node) => node.isSystem) ?? expect.unreachable('no cuisine Other');
    expect(refusal(await command('SaveCategory', { scope: 'foodCategory', categoryId: otherFood.id, parentId: null, name: 'Misc' }))).toEqual([409, 'SYSTEM_PROTECTED']);
    expect(refusal(await command('SaveCategory', { scope: 'cuisine', categoryId: otherCuisine.id, parentId: null, name: 'Misc' }))).toEqual([409, 'SYSTEM_PROTECTED']);
  });

  it('row 9: deleting a category moves its Food Types (those of its Children too) or its recipes to Other, and deletes its thresholds, so the Food Types re-derive T_eff', async () => {
    await setToday('2026-10-01');
    const beef = await foodTypeIdOf('Beef');
    const chicken = await foodTypeIdOf('Chicken');
    const meat = await categoryOf('Meat');
    const redMeat = await categoryOf('Red Meat');
    const otherFood = (await reference()).foodCategories.find((node) => node.isSystem) ?? expect.unreachable('no food Other');
    const french = await cuisineOf('French Cuisine');
    // the thresholds come first (spec 4.1.5): a whole number of days, at least 1, and never on Other or on a cuisine
    expect(refusal(await command('SetCategoryThreshold', { categoryId: meat.id, thresholdDays: 0 }))).toEqual([422, 'THRESHOLD_INVALID']);
    expect(refusal(await command('SetCategoryThreshold', { categoryId: otherFood.id, thresholdDays: 5 }))).toEqual([409, 'THRESHOLD_FORBIDDEN']);
    expect(refusal(await command('SetCategoryThreshold', { categoryId: french.id, thresholdDays: 5 }))).toEqual([409, 'THRESHOLD_FORBIDDEN']);
    await ok(command('SetCategoryThreshold', { categoryId: meat.id, thresholdDays: 6 }));
    await ok(command('SetCategoryThreshold', { categoryId: redMeat.id, thresholdDays: 5 }));
    await inbound(beef, 100_000, { days: 5 }); // Near-Expiry under Red Meat's 5 days
    await inbound(chicken, 100_000, { days: 6 }); // Near-Expiry under Meat's 6 days, which Poultry inherits
    const before = await Promise.all([detailOf(beef), detailOf(chicken)]);

    await ok(command('DeleteCategory', { scope: 'foodCategory', categoryId: meat.id }));
    await ok(command('DeleteCategory', { scope: 'cuisine', categoryId: french.id }));
    const after = await Promise.all([detailOf(beef), detailOf(chicken)]);

    expect(before.map((detail) => [detail.categoryPath, detail.threshold, detail.batches[0]?.status])).toEqual([
      [['Meat', 'Red Meat'], { days: 5, source: 'child' }, 'nearExpiry'],
      [['Meat', 'Poultry'], { days: 6, source: 'parent' }, 'nearExpiry'],
    ]);
    // Meat and its two Children are gone with their thresholds; the Food Types are in Other and fall back to the global 3 days
    expect(after.map((detail) => [detail.categoryId, detail.categoryPath, detail.threshold, detail.batches[0]?.status])).toEqual([
      [otherFood.id, ['Other'], { days: 3, source: 'global' }, 'fresh'],
      [otherFood.id, ['Other'], { days: 3, source: 'global' }, 'fresh'],
    ]);
    expect(allCategories((await reference()).foodCategories).map((node) => node.name)).toEqual(['Dairy', 'Liquid Dairy', 'Vegetables', 'Leafy Greens', 'Other']);
    // the recipes of French Cuisine are now in the cuisine Other
    const otherCuisine = (await reference()).cuisines.find((node) => node.isSystem) ?? expect.unreachable('no cuisine Other');
    expect((await catalog(otherCuisine.id)).map((row) => [row.name, row.cuisineName])).toEqual([
      ['Chicken Broccoli Gratin', 'Other'],
      ['Spinach Omelette', 'Other'],
    ]);
    // Other itself cannot be deleted
    expect(refusal(await command('DeleteCategory', { scope: 'foodCategory', categoryId: otherFood.id }))).toEqual([409, 'SYSTEM_PROTECTED']);
  });

  it('row 10: an ingredient with 0 <= Q_avail < Q_req is badged Missing, and cooking deducts none of it while it deducts the ingredients that are there in full', async () => {
    const chicken = await foodTypeIdOf('Chicken');
    const rice = await foodTypeIdOf('Rice');
    const egg = await foodTypeIdOf('Egg');
    // Chicken Fried Rice needs Chicken 200 g, Rice 300 g and Egg 2 pieces; there is no Egg at all
    await inbound(chicken, 100_000, { days: 10 });
    await inbound(rice, 300_000, { days: 10 });
    const row = await recipeNamed('Chicken Fried Rice');

    const [report] = await cook([row.recipeId]);

    expect([row.status, row.availableCount, row.totalCount]).toEqual(['partial', 1, 3]);
    expect(row.ingredients.map((line) => [line.name, line.available, line.state])).toEqual([
      ['Chicken', 100_000, 'missing'],
      ['Rice', 300_000, 'ok'],
      ['Egg', 0, 'missing'],
    ]);
    expect(report).toMatchObject({
      outcome: 'cooked',
      deducted: [{ foodTypeId: rice, name: 'Rice', quantity: 300_000, unit: 'grams' }],
      missing: [
        { foodTypeId: chicken, name: 'Chicken', needed: 200_000, available: 100_000, unit: 'grams' },
        { foodTypeId: egg, name: 'Egg', needed: 2_000, available: 0, unit: 'pieces' },
      ],
    });
    // the Chicken stock is left untouched, and the Rice is used up
    expect((await detailOf(chicken)).batches.map((batch) => batch.quantity)).toEqual([100_000]);
    expect((await detailOf(rice)).batches).toEqual([]);
  });

  it('row 11: with no full match, the recommendations degrade to Partial Matches, the gated recipes with at least one Missing ingredient, A to Z', async () => {
    const chicken = await foodTypeIdOf('Chicken');
    const rice = await foodTypeIdOf('Rice');
    await inbound(chicken, 250_000, { days: 2 }); // Near-Expiry, and enough for every Chicken recipe

    const partial = await recommendations();

    expect([partial.tier, partial.emptyState]).toEqual(['partial', null]);
    expect(partial.recipes.map((recipe) => recipe.name)).toEqual(['Chicken Broccoli Gratin', 'Chicken Fried Rice', 'Vietnamese Chicken Rice']);
    for (const recipe of partial.recipes) {
      // the Rescued Ingredient, and a badge on each Missing one
      expect(recipe.ingredients.filter((line) => line.rescued).map((line) => line.name), recipe.name).toEqual(['Chicken']);
      expect(recipe.ingredients.filter((line) => line.name !== 'Chicken').every((line) => line.state === 'missing'), recipe.name).toBe(true);
    }
    // a full match takes tier 1 back, and tier 2 is not shown then
    await inbound(rice, 300_000, { days: 10 });
    const full = await recommendations();
    expect([full.tier, full.recipes.map((recipe) => recipe.name)]).toEqual(['full', ['Vietnamese Chicken Rice']]);
  });

  it('row 12: a recipe without a Rescued Ingredient is left out of the recommendations, even as a full match, but stays in the catalog, where it can be cooked', async () => {
    const tomato = await foodTypeIdOf('Tomato');
    const egg = await foodTypeIdOf('Egg');
    const beef = await foodTypeIdOf('Beef');
    const broccoli = await foodTypeIdOf('Broccoli');
    const chicken = await foodTypeIdOf('Chicken');
    // Tomato Egg Stir-Fry is a full match on Fresh stock only
    await inbound(tomato, 2_000, { days: 10 });
    await inbound(egg, 3_000, { days: 10 });
    // Beef is near-expiry but short of the 300 g that the Stir-Fry needs, so it rescues nothing
    await inbound(beef, 100_000, { days: 1 });
    await inbound(broccoli, 200_000, { days: 10 });
    // Chicken is near-expiry and enough, so the Chicken recipes are rescues
    await inbound(chicken, 250_000, { days: 1 });

    const recommended = await recommendations();
    const tomatoEgg = await recipeNamed('Tomato Egg Stir-Fry');
    const stirFry = await recipeNamed('Beef and Broccoli Stir-Fry');

    expect(recommended.tier).toBe('partial');
    expect(recommended.recipes.map((recipe) => recipe.name)).toEqual(['Chicken Broccoli Gratin', 'Chicken Fried Rice', 'Vietnamese Chicken Rice']);
    expect([tomatoEgg.status, stirFry.status]).toEqual(['full', 'partial']);
    expect(lineOf(stirFry, 'Beef')).toMatchObject({ available: 100_000, state: 'missing', rescued: false });
    const [report] = await cook([tomatoEgg.recipeId]);
    expect(report).toMatchObject({ outcome: 'cooked', deducted: [{ name: 'Tomato', quantity: 2_000 }, { name: 'Egg', quantity: 3_000 }], missing: [] });
  });

  it('row 13: with no Near-Expiry batch in the refrigerator, the Warning Panel has no near-expiry item, the recommendations give the "no rescue recipes are needed" empty state, and the catalog cooks as usual', async () => {
    await setToday('2026-10-01');
    const beef = await foodTypeIdOf('Beef');
    const broccoli = await foodTypeIdOf('Broccoli');
    const milk = await foodTypeIdOf('Milk');
    await inbound(beef, 300_000, { days: 10 });
    await inbound(broccoli, 200_000, { days: 10 });
    await inbound(milk, 100_000, { days: 0 });
    await setToday('2026-10-02'); // the Milk is now Expired, which is not Near-Expiry

    const panel = await warnings();
    const recommended = await recommendations();
    const stirFry = await recipeNamed('Beef and Broccoli Stir-Fry');

    // the Expired section is there only because an Expired batch exists
    expect(panel.nearExpiry).toEqual([]);
    expect(panel.expired.map((row) => [row.foodTypeName, row.quantity, row.daysLeft])).toEqual([['Milk', 100_000, -1]]);
    expect(recommended).toEqual({ tier: null, recipes: [], emptyState: 'noNearExpiry' });
    expect(stirFry.status).toBe('full');
    expect((await cook([stirFry.recipeId])).map((entry) => entry.outcome)).toEqual(['cooked']);
  });

  it('row 14: in a queue, the first recipe uses up a shared ingredient, and the next one finds it Missing, deducts none of it, and deducts its other ingredients as usual', async () => {
    const chicken = await foodTypeIdOf('Chicken');
    const broccoli = await foodTypeIdOf('Broccoli');
    const milk = await foodTypeIdOf('Milk');
    const rice = await foodTypeIdOf('Rice');
    await inbound(chicken, 250_000, { days: 10 });
    await inbound(broccoli, 150_000, { days: 10 });
    await inbound(milk, 100_000, { days: 10 });
    await inbound(rice, 600_000, { days: 10 });
    const gratin = await recipeNamed('Chicken Broccoli Gratin');
    const chickenRice = await recipeNamed('Vietnamese Chicken Rice');

    const reports = await cook([gratin.recipeId, chickenRice.recipeId]);

    expect(reports).toEqual([
      {
        recipeId: gratin.recipeId,
        recipeName: 'Chicken Broccoli Gratin',
        outcome: 'cooked',
        reason: null,
        deducted: [
          { foodTypeId: chicken, name: 'Chicken', quantity: 250_000, unit: 'grams' },
          { foodTypeId: broccoli, name: 'Broccoli', quantity: 150_000, unit: 'grams' },
          { foodTypeId: milk, name: 'Milk', quantity: 100_000, unit: 'ml' },
        ],
        missing: [],
      },
      {
        recipeId: chickenRice.recipeId,
        recipeName: 'Vietnamese Chicken Rice',
        outcome: 'cooked',
        reason: null,
        deducted: [{ foodTypeId: rice, name: 'Rice', quantity: 300_000, unit: 'grams' }],
        missing: [{ foodTypeId: chicken, name: 'Chicken', needed: 250_000, available: 0, unit: 'grams' }],
      },
    ]);
    expect((await detailOf(chicken)).total).toBe(0);
    expect((await detailOf(rice)).batches.map((batch) => batch.quantity)).toEqual([300_000]);
  });

  it('row 15: deleting a Food Type that still has batches, Expired ones included, is blocked with "Remove all N batches first"', async () => {
    await setToday('2026-10-01');
    const beef = await foodTypeIdOf('Beef');
    await inbound(beef, 100_000, { days: 0 });
    await inbound(beef, 200_000, { days: 10 });
    await setToday('2026-10-02');
    const [expired, fresh] = (await detailOf(beef)).batches;
    if (expired === undefined || fresh === undefined) expect.unreachable('Beef has two batches');
    const before = await everything();

    const twoLeft = await command('DeleteFoodType', { foodTypeId: beef });

    expect([expired.status, fresh.status]).toEqual(['expired', 'fresh']);
    expect([...refusal(twoLeft), twoLeft.error?.detail]).toEqual([409, 'HAS_BATCHES', 'Remove all 2 batches first']);
    expect(await everything()).toEqual(before);
    await ok(command('RemoveBatch', { batchId: fresh.id }));
    const oneLeft = await command('DeleteFoodType', { foodTypeId: beef });
    expect([...refusal(oneLeft), oneLeft.error?.detail]).toEqual([409, 'HAS_BATCHES', 'Remove the 1 batch first']);
    // once the Expired batch is removed too, the Food Type can be deleted
    await ok(command('RemoveBatch', { batchId: expired.id }));
    await ok(command('DeleteFoodType', { foodTypeId: beef }));
    expect((await inventory()).map((row) => row.name)).not.toContain('Beef');
  });

  it('row 16: a recipe with no available ingredient cannot be cooked (nothing available to deduct), and in a queue it is skipped while the queue goes on', async () => {
    // with no stock at all, no recipe has an ingredient available
    const before = await catalog();
    const tomato = await foodTypeIdOf('Tomato');
    const egg = await foodTypeIdOf('Egg');
    await inbound(tomato, 2_000, { days: 10 });
    await inbound(egg, 3_000, { days: 10 });
    const stirFry = await recipeNamed('Beef and Broccoli Stir-Fry');
    const tomatoEgg = await recipeNamed('Tomato Egg Stir-Fry');

    const reports = await cook([stirFry.recipeId, tomatoEgg.recipeId]);

    expect(before.map((row) => [row.status, row.availableCount])).toEqual(before.map(() => ['nothing', 0]));
    expect(before).toHaveLength(6);
    expect([stirFry.status, stirFry.availableCount]).toEqual(['nothing', 0]);
    expect(reports.map((entry) => [entry.recipeName, entry.outcome, entry.reason, entry.deducted.length, entry.missing.length])).toEqual([
      ['Beef and Broccoli Stir-Fry', 'skipped', 'nothingAvailable', 0, 0],
      ['Tomato Egg Stir-Fry', 'cooked', null, 2, 0],
    ]);
  });

  it('row 17: Near-Expiry items that no recipe can rescue give the "No recipe can rescue your near-expiry items yet" empty state, while the Warning Panel and the catalog work as usual', async () => {
    // a new Food Type that no recipe uses, near-expiry at once
    await ok(command('InboundBatch', { foodTypeId: null, foodName: 'Yogurt', categoryId: null, unit: 'cartons', quantity: 2_000, expiry: { days: 1 } }));

    const recommended = await recommendations();
    const panel = await warnings();
    const rows = await catalog();

    expect(recommended).toEqual({ tier: null, recipes: [], emptyState: 'noRescue' });
    expect(panel.nearExpiry.map((row) => [row.foodTypeName, row.quantity, row.daysLeft, row.status])).toEqual([['Yogurt', 2_000, 1, 'nearExpiry']]);
    expect(rows.map((row) => row.name)).toHaveLength(6);
  });

  it('row 18: an inbound name that matches an existing Food Type, ignoring case and outer spaces, adds the batch to it instead of being a duplicate, with the Food Type’s own unit and category', async () => {
    const beef = await foodTypeIdOf('Beef');
    const otherFood = (await reference()).foodCategories.find((node) => node.isSystem) ?? expect.unreachable('no food Other');

    // the form would show the unit and category read-only; whatever else is sent for them is not used
    await ok(command('InboundBatch', { foodTypeId: null, foodName: '  bEEF ', categoryId: otherFood.id, unit: 'kg', quantity: 150_000, expiry: { days: 5 } }));

    expect(await detailOf(beef)).toMatchObject({ name: 'Beef', unit: 'grams', categoryPath: ['Meat', 'Red Meat'], total: 150_000 });
    expect(await inventory()).toHaveLength(8);
    // nothing is matched loosely: another name is a new Food Type
    await ok(command('InboundBatch', { foodTypeId: null, foodName: 'Beefsteak', categoryId: null, unit: 'grams', quantity: 1_000, expiry: { days: 5 } }));
    expect((await inventory()).map((row) => [row.name, row.categoryPath])).toContainEqual(['Beefsteak', ['Other']]);
    // a Food Type is named by its id or by its name, never by both
    const both = await command('InboundBatch', { foodTypeId: beef, foodName: 'Beef', categoryId: null, unit: null, quantity: 1_000, expiry: { days: 5 } });
    expect(refusal(both)).toEqual([400, 'BAD_COMBINATION']);
  });

  it('row 19: a category named Other, a child under Other and a child under a child are refused, and nothing is created', async () => {
    const otherFood = (await reference()).foodCategories.find((node) => node.isSystem) ?? expect.unreachable('no food Other');
    const redMeat = await categoryOf('Red Meat');
    const meat = await categoryOf('Meat');
    const before = await everything();

    const namedOther = await command('SaveCategory', { scope: 'foodCategory', categoryId: null, parentId: null, name: 'Other' });
    // also as a Child, and in another case with outer spaces: names are trimmed and compared without case
    const namedOtherLoosely = await command('SaveCategory', { scope: 'foodCategory', categoryId: null, parentId: meat.id, name: '  other ' });
    const cuisineNamedOther = await command('SaveCategory', { scope: 'cuisine', categoryId: null, parentId: null, name: 'OTHER' });
    const underOther = await command('SaveCategory', { scope: 'foodCategory', categoryId: null, parentId: otherFood.id, name: 'Leftovers' });
    const underChild = await command('SaveCategory', { scope: 'foodCategory', categoryId: null, parentId: redMeat.id, name: 'Steak' });

    expect([refusal(namedOther), refusal(namedOtherLoosely), refusal(cuisineNamedOther)]).toEqual([
      [422, 'NAME_RESERVED'],
      [422, 'NAME_RESERVED'],
      [422, 'NAME_RESERVED'],
    ]);
    expect([refusal(underOther), refusal(underChild)]).toEqual([
      [409, 'PARENT_INVALID'],
      [409, 'PARENT_INVALID'],
    ]);
    expect(await everything()).toEqual(before);
    // a Child under a Parent is fine
    await ok(command('SaveCategory', { scope: 'foodCategory', categoryId: null, parentId: meat.id, name: 'Game' }));
    expect((await categoryOf('Meat')).children.map((child) => child.name)).toEqual(['Red Meat', 'Poultry', 'Game']);
  });

  it('row 20: a change of Simulated Today re-derives every freshness state and every view that depends on it at once, and clearing it returns to the device date', async () => {
    const deviceToday = (await reference()).today;
    const chicken = await foodTypeIdOf('Chicken');
    await setToday('2026-10-01');
    await inbound(chicken, 250_000, { days: 5 }); // expires Oct 6
    const seen: unknown[] = [];

    for (const date of ['2026-10-01', '2026-10-03', '2026-10-07']) {
      await setToday(date);
      const [batch] = (await detailOf(chicken)).batches;
      const panel = await warnings();
      const recommended = await recommendations();
      const available = lineOf(await recipeNamed('Vietnamese Chicken Rice'), 'Chicken').available;
      seen.push([date, batch?.status, panel.nearExpiry.length, panel.expired.length, recommended.tier ?? recommended.emptyState, available]);
    }
    await setToday(null);

    expect(seen).toEqual([
      ['2026-10-01', 'fresh', 0, 0, 'noNearExpiry', 250_000],
      ['2026-10-03', 'nearExpiry', 1, 0, 'partial', 250_000],
      ['2026-10-07', 'expired', 0, 1, 'noNearExpiry', 0],
    ]);
    // the reply of each request carries the date it was worked out for; with Simulated Today cleared it is the device date again
    expect(await reference()).toMatchObject({ today: deviceToday, simulatedToday: null });
    expect((await query('GetInventoryList')).meta.today).toBe(deviceToday);
  });

  it('row 21: the same recipe queued twice runs twice, each run on its own, and a recipe that is blocked at its turn, or no longer exists, is skipped while the queue goes on', async () => {
    const tomato = await foodTypeIdOf('Tomato');
    const egg = await foodTypeIdOf('Egg');
    await inbound(tomato, 4_000, { days: 10 });
    await inbound(egg, 6_000, { days: 10 });
    const tomatoEgg = await recipeNamed('Tomato Egg Stir-Fry');
    // a Unit Conflict makes this one blocked
    const { recipeId: blocked } = await ok<{ recipeId: number }>(command('SaveRecipe', recipeOf('Egg Cups', [{ foodTypeId: egg, quantity: 1_000, unit: 'cartons' }])));
    // and this one is deleted while it is still in the queue of the page
    const { recipeId: gone } = await ok<{ recipeId: number }>(command('SaveRecipe', recipeOf('Tomato Salad', [{ foodTypeId: tomato, quantity: 1_000, unit: 'pieces' }])));
    await ok(command('DeleteRecipe', { recipeId: gone }));

    const reports = await cook([tomatoEgg.recipeId, blocked, gone, tomatoEgg.recipeId]);

    expect(reports.map((entry) => [entry.recipeId, entry.outcome, entry.reason, entry.deducted.map((line) => [line.name, line.quantity])])).toEqual([
      [tomatoEgg.recipeId, 'cooked', null, [['Tomato', 2_000], ['Egg', 3_000]]],
      [blocked, 'skipped', 'blocked', []],
      [gone, 'skipped', 'recipeNotFound', []],
      [tomatoEgg.recipeId, 'cooked', null, [['Tomato', 2_000], ['Egg', 3_000]]],
    ]);
    // both runs took their own share: nothing is left
    expect([(await detailOf(tomato)).total, (await detailOf(egg)).total]).toEqual([0, 0]);
  });

  it('row 22: a Food Type with no batches is listed with quantity 0 and no status, and can still be opened, given a batch, edited and deleted', async () => {
    const dairy = await categoryOf('Dairy');
    const seeded = await inventory();
    // Add Food Type: a Food Type with no stock yet
    const { foodTypeId: yogurt } = await ok<{ foodTypeId: number }>(command('SaveFoodType', { foodTypeId: null, name: 'Yogurt', categoryId: dairy.id, unit: 'cartons', thresholdDays: null }));
    const noStock = { total: 0, byStatus: { fresh: 0, nearExpiry: 0, expired: 0 }, overall: null };

    expect(seeded.map((row) => [row.total, row.overall])).toEqual(seeded.map(() => [0, null]));
    expect((await inventory()).find((row) => row.foodTypeId === yogurt)).toMatchObject({ name: 'Yogurt', unit: 'cartons', categoryPath: ['Dairy'], ...noStock });
    expect(await detailOf(yogurt)).toMatchObject({ batches: [], ...noStock });
    // a batch is added and removed: the Food Type stays registered with its unit and category
    await inbound(yogurt, 1_000, { days: 3 });
    const [batch] = (await detailOf(yogurt)).batches;
    if (batch === undefined) expect.unreachable('Yogurt has a batch');
    await ok(command('RemoveBatch', { batchId: batch.id }));
    expect(refusal(await command('RemoveBatch', { batchId: batch.id }))).toEqual([409, 'BATCH_NOT_FOUND']);
    expect((await inventory()).find((row) => row.foodTypeId === yogurt)).toMatchObject({ unit: 'cartons', categoryPath: ['Dairy'], ...noStock });
    // it is edited (name and threshold), and then deleted
    await ok(command('SaveFoodType', { foodTypeId: yogurt, name: 'Greek Yogurt', categoryId: dairy.id, unit: null, thresholdDays: 2 }));
    expect(await detailOf(yogurt)).toMatchObject({ name: 'Greek Yogurt', unit: 'cartons', customThresholdDays: 2, threshold: { days: 2, source: 'foodType' } });
    await ok(command('DeleteFoodType', { foodTypeId: yogurt }));
    expect((await inventory()).map((row) => row.name)).toEqual(seeded.map((row) => row.name));
  });

  it('row 23: a Food Type with batches in several statuses totals all of them, breaks the total down by status, and takes its overall status from the most urgent one present', async () => {
    await setToday('2026-10-01');
    const beef = await foodTypeIdOf('Beef');
    await inbound(beef, 100_000, { days: 0 });
    await setToday('2026-10-02');
    await inbound(beef, 150_000, { days: 1 });
    await inbound(beef, 300_000, { days: 10 });
    const statusOf = async (): Promise<unknown> => {
      const row = (await inventory()).find((each) => each.foodTypeId === beef);
      return [row?.total, row?.byStatus, row?.overall];
    };
    const [expired, near] = (await detailOf(beef)).batches;
    if (expired === undefined || near === undefined) expect.unreachable('Beef has three batches');

    const all = await statusOf();
    await ok(command('RemoveBatch', { batchId: expired.id }));
    const noExpired = await statusOf();
    await ok(command('RemoveBatch', { batchId: near.id }));
    const freshOnly = await statusOf();

    expect(all).toEqual([550_000, { fresh: 300_000, nearExpiry: 150_000, expired: 100_000 }, 'expired']);
    expect(noExpired).toEqual([450_000, { fresh: 300_000, nearExpiry: 150_000, expired: 0 }, 'nearExpiry']);
    expect(freshOnly).toEqual([300_000, { fresh: 300_000, nearExpiry: 0, expired: 0 }, 'fresh']);
    expect(await detailOf(beef)).toMatchObject({ total: 300_000, overall: 'fresh' });
  });
});
