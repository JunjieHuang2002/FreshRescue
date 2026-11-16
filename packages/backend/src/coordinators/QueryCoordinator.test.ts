import { describe, expect, it } from 'vitest';
import { EMPTY_SNAPSHOT } from '@freshrescue/contract-entities';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import { QUERY_TYPES } from '@freshrescue/contract-messages';
import type { Query, QueryType } from '@freshrescue/contract-messages';
import type { Id, Named, Result } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS, UNIT_LIST } from '@freshrescue/contract-rules';
import type {
  CatalogDto,
  FoodTypeDetailDto,
  InventoryListDto,
  RecommendationDto,
  ReferenceDataDto,
  WarningPanelDto,
} from '@freshrescue/contract-views';
import { APPENDIX_A_SEED, buildBatch, buildFoodType, buildIngredient, buildRecipe } from '../testing/fixtures';
import { snapshotInvariantChecker } from '../modules/engine/snapshotInvariantChecker';
import { changeSetApplier } from '../modules/state/changeSetApplier';
import { createQueryCoordinator } from './QueryCoordinator';
import { createReferenceCommandCoordinator } from './ReferenceCommandCoordinator';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as object)) deepFreeze(inner);
  }
  return value;
}

const idOf = (rows: readonly Named[], name: string): Id => rows.find((row) => row.name === name)?.id ?? expect.unreachable(`there is no "${name}"`);

const coordinator = createQueryCoordinator();
const TODAY = '2026-10-01';

/** Appendix A as the first start leaves it: the system categories, 7 food categories, 3 cuisines, 8 Food Types, 6 recipes, no stock. */
const seeded: Snapshot = (() => {
  const outcome = valueOf(createReferenceCommandCoordinator().bootstrap(APPENDIX_A_SEED, EMPTY_SNAPSHOT));
  return valueOf(changeSetApplier(EMPTY_SNAPSHOT, outcome.changeSets?.[0] ?? { ops: [] }));
})();

const [BEEF, CHICKEN, EGG, MILK, RICE, TOMATO] = ['Beef', 'Chicken', 'Egg', 'Milk', 'Rice', 'Tomato'].map((name) => idOf(seeded.foodTypes, name));
const CHICKEN_NEAR = seeded.counters.nextId;

/**
 * The kitchen on 2026-10-01: Chicken 300 g that expires on Oct 3 (Near-Expiry: 2 days left against a threshold of 3) and 200 g that
 * expires on Oct 20 (Fresh); Rice 600 g and Egg 4 pieces, both Fresh; Milk 500 ml that expired on Sep 28. No Beef, no Tomato.
 */
const kitchen: Snapshot = deepFreeze({
  ...seeded,
  batches: [
    buildBatch({ id: CHICKEN_NEAR, foodTypeId: CHICKEN as Id, quantity: 300_000, inboundDate: '2026-09-28', expirationDate: '2026-10-03', createdSeq: 1 }),
    buildBatch({ id: CHICKEN_NEAR + 1, foodTypeId: CHICKEN as Id, quantity: 200_000, inboundDate: '2026-09-30', expirationDate: '2026-10-20', createdSeq: 2 }),
    buildBatch({ id: CHICKEN_NEAR + 2, foodTypeId: RICE as Id, quantity: 600_000, inboundDate: '2026-09-30', expirationDate: '2026-12-01', createdSeq: 3 }),
    buildBatch({ id: CHICKEN_NEAR + 3, foodTypeId: EGG as Id, quantity: 4_000, inboundDate: '2026-09-30', expirationDate: '2026-11-01', createdSeq: 4 }),
    buildBatch({ id: CHICKEN_NEAR + 4, foodTypeId: MILK as Id, quantity: 500_000, inboundDate: '2026-09-20', expirationDate: '2026-09-28', createdSeq: 5 }),
  ],
  counters: { nextId: CHICKEN_NEAR + 5, nextSeq: 6 },
});

const ask = (query: Query, today = TODAY, snapshot: Snapshot = kitchen) => coordinator.handle(query, snapshot, today);
const dataOf = <T>(query: Query, today = TODAY): T => valueOf(ask(query, today)).payload as T;

describe('BX-05 QueryCoordinator', () => {
  it('starts from a legal store with stock, whose figures the tests below work out by hand', () => {
    expect(snapshotInvariantChecker(kitchen).ok).toBe(true);
    expect(kitchen.batches).toHaveLength(5);
  });

  describe('getReferenceData', () => {
    const data = dataOf<ReferenceDataDto>({ type: 'GetReferenceData', params: {} });

    it('carries the date of the request, the global threshold, the six units and the Simulated Today setting', () => {
      expect(data).toMatchObject({ today: TODAY, simulatedToday: null, globalThresholdDays: 3, units: [...UNIT_LIST] });
    });

    it('gives the two trees with Other last, a Parent holding its Children, and the cuisines', () => {
      expect(data.foodCategories.map((node) => [node.name, node.children.map((child) => child.name)])).toEqual([
        ['Meat', ['Red Meat', 'Poultry']],
        ['Dairy', ['Liquid Dairy']],
        ['Vegetables', ['Leafy Greens']],
        ['Other', []],
      ]);
      expect(data.cuisines.map((node) => node.name)).toEqual(['Chinese Cuisine', 'Vietnamese Cuisine', 'French Cuisine', 'Other']);
    });

    it('lists the Food Types as options with their unit and category', () => {
      expect(data.foodTypes).toHaveLength(8);
      expect(data.foodTypes.find((option) => option.id === MILK)).toMatchObject({ name: 'Milk', unit: 'ml' });
    });

    it('shows the date that was resolved for the request, not the stored one: the stored Simulated Today is only reported', () => {
      const simulated = { ...kitchen, settings: { simulatedToday: '2026-10-05', bootstrapped: true } };

      const read = valueOf(ask({ type: 'GetReferenceData', params: {} }, '2026-10-05', simulated)).payload as ReferenceDataDto;

      expect(read).toMatchObject({ today: '2026-10-05', simulatedToday: '2026-10-05' });
    });
  });

  describe('getInventoryList (spec 4.7.1)', () => {
    const rows = dataOf<InventoryListDto>({ type: 'GetInventoryList', params: {} }).rows;
    const rowOf = (name: string) => rows.find((row) => row.name === name);

    it('lists every Food Type A to Z, with the ones that have no stock', () => {
      expect(rows.map((row) => row.name)).toEqual(['Beef', 'Broccoli', 'Chicken', 'Egg', 'Milk', 'Rice', 'Spinach', 'Tomato']);
    });

    it('gives a Food Type with batches in two statuses a total over all of them and a split by status, with the most urgent as its badge', () => {
      expect(rowOf('Chicken')).toMatchObject({
        categoryPath: ['Meat', 'Poultry'],
        unit: 'grams',
        total: 500_000,
        byStatus: { fresh: 200_000, nearExpiry: 300_000, expired: 0 },
        overall: 'nearExpiry',
      });
    });

    it('counts Expired stock in the total and badges it Expired (spec 4.2.3)', () => {
      expect(rowOf('Milk')).toMatchObject({ total: 500_000, byStatus: { fresh: 0, nearExpiry: 0, expired: 500_000 }, overall: 'expired' });
    });

    it('shows a Food Type with no batches as quantity 0 and no status (spec exception row 22)', () => {
      expect(rowOf('Beef')).toMatchObject({ total: 0, overall: null, byStatus: { fresh: 0, nearExpiry: 0, expired: 0 } });
    });

    it('gives the category path of a Food Type in Other, and of one assigned to a Parent', () => {
      expect(rowOf('Rice')?.categoryPath).toEqual(['Other']);
      expect(rowOf('Tomato')?.categoryPath).toEqual(['Vegetables']);
    });

    it('works out the statuses for the date of the request: two days on, the Near-Expiry batch is Expired, and the badge follows', () => {
      const later = dataOf<InventoryListDto>({ type: 'GetInventoryList', params: {} }, '2026-10-04').rows.find((row) => row.name === 'Chicken');

      expect(later).toMatchObject({ byStatus: { fresh: 200_000, nearExpiry: 0, expired: 300_000 }, overall: 'expired' });
    });
  });

  describe('getFoodTypeDetail (spec 4.7.2)', () => {
    const detail = dataOf<FoodTypeDetailDto>({ type: 'GetFoodTypeDetail', params: { foodTypeId: CHICKEN as Id } });

    it('gives the header: name, category path, unit, total, split by status, badge, and the threshold with the level that decided it', () => {
      expect(detail).toMatchObject({
        foodTypeId: CHICKEN,
        name: 'Chicken',
        categoryPath: ['Meat', 'Poultry'],
        unit: 'grams',
        customThresholdDays: null,
        threshold: { days: 3, source: 'global' },
        total: 500_000,
        overall: 'nearExpiry',
      });
    });

    it('lists the batches by expiration date with their days left and status', () => {
      expect(detail.batches.map((batch) => [batch.id, batch.expirationDate, batch.daysLeft, batch.status])).toEqual([
        [CHICKEN_NEAR, '2026-10-03', 2, 'nearExpiry'],
        [CHICKEN_NEAR + 1, '2026-10-20', 19, 'fresh'],
      ]);
    });

    it('lists the recipes that use the Food Type, which a deletion would block', () => {
      expect(detail.referencingRecipes.map((recipe) => recipe.name)).toEqual(['Chicken Broccoli Gratin', 'Chicken Fried Rice', 'Vietnamese Chicken Rice']);
    });

    it('takes the threshold of the Food Type itself when it has one, and says so', () => {
      const withOwn = { ...kitchen, foodTypes: kitchen.foodTypes.map((foodType) => (foodType.id === CHICKEN ? { ...foodType, customThresholdDays: 1 } : foodType)) };

      const read = valueOf(ask({ type: 'GetFoodTypeDetail', params: { foodTypeId: CHICKEN as Id } }, TODAY, withOwn)).payload as FoodTypeDetailDto;

      expect(read.threshold).toEqual({ days: 1, source: 'foodType' });
      expect(read.batches[0]?.status).toBe('fresh');
    });

    it('shows a Food Type with no batches with an empty list', () => {
      const read = dataOf<FoodTypeDetailDto>({ type: 'GetFoodTypeDetail', params: { foodTypeId: BEEF as Id } });

      expect(read).toMatchObject({ total: 0, overall: null, batches: [] });
    });

    it('refuses an id that is no Food Type (FOOD_TYPE_NOT_FOUND)', () => {
      expect(errorOf(ask({ type: 'GetFoodTypeDetail', params: { foodTypeId: 999 } })).code).toBe('FOOD_TYPE_NOT_FOUND');
      expect(errorOf(ask({ type: 'GetFoodTypeDetail', params: { foodTypeId: SYSTEM_IDS.FOOD_OTHER } })).code).toBe('FOOD_TYPE_NOT_FOUND');
    });
  });

  describe('getWarningPanel (spec 4.3.3)', () => {
    it('lists the Near-Expiry batch in its section and the Expired batch in the other, with the days left', () => {
      const panel = dataOf<WarningPanelDto>({ type: 'GetWarningPanel', params: {} });

      expect(panel.nearExpiry.map((row) => [row.foodTypeName, row.quantity, row.unit, row.daysLeft, row.status])).toEqual([['Chicken', 300_000, 'grams', 2, 'nearExpiry']]);
      expect(panel.expired.map((row) => [row.foodTypeName, row.quantity, row.unit, row.daysLeft, row.status])).toEqual([['Milk', 500_000, 'ml', -3, 'expired']]);
    });

    it('takes the threshold of the Food Type, or of its category, and not only the global 3 days (spec 4.3.1)', () => {
      const ownThreshold = { ...kitchen, foodTypes: kitchen.foodTypes.map((foodType) => (foodType.id === CHICKEN ? { ...foodType, customThresholdDays: 1 } : foodType)) };
      const poultry = idOf(seeded.foodCategories, 'Poultry');
      const categoryThreshold = { ...kitchen, foodCategories: kitchen.foodCategories.map((category) => (category.id === poultry ? { ...category, customThresholdDays: 20 } : category)) };

      // 2 days left against a threshold of 1 day is Fresh, so the batch is no longer in the panel
      const own = valueOf(ask({ type: 'GetWarningPanel', params: {} }, TODAY, ownThreshold)).payload as WarningPanelDto;
      // 19 days left against the 20 days of Poultry is Near-Expiry, so the second batch of Chicken joins the first
      const inherited = valueOf(ask({ type: 'GetWarningPanel', params: {} }, TODAY, categoryThreshold)).payload as WarningPanelDto;

      expect(own.nearExpiry).toEqual([]);
      expect(inherited.nearExpiry.map((row) => [row.foodTypeName, row.daysLeft])).toEqual([['Chicken', 2], ['Chicken', 19]]);
    });

    it('has both sections empty when nothing is near expiry or expired', () => {
      const panel = valueOf(ask({ type: 'GetWarningPanel', params: {} }, TODAY, seeded)).payload as WarningPanelDto;

      expect(panel).toEqual({ nearExpiry: [], expired: [] });
    });

    it('moves a batch from one section to the other as days pass, and sorts each section by days left (spec 4.3.3)', () => {
      const fourth = dataOf<WarningPanelDto>({ type: 'GetWarningPanel', params: {} }, '2026-10-04');

      expect(fourth.nearExpiry).toEqual([]);
      expect(fourth.expired.map((row) => [row.foodTypeName, row.daysLeft])).toEqual([['Milk', -6], ['Chicken', -1]]);
    });
  });

  describe('getRecommendations (spec 4.4.B)', () => {
    it('gives Tier 1: the full matches that have a Rescued Ingredient, A to Z', () => {
      const dto = dataOf<RecommendationDto>({ type: 'GetRecommendations', params: {} });

      expect(dto).toMatchObject({ tier: 'full', emptyState: null });
      expect(dto.recipes.map((recipe) => [recipe.name, recipe.availableCount, recipe.totalCount])).toEqual([
        ['Chicken Fried Rice', 3, 3],
        ['Vietnamese Chicken Rice', 2, 2],
      ]);
    });

    it('answers with the empty state of exception row 13 when there is no near-expiry stock at all', () => {
      const dto = valueOf(ask({ type: 'GetRecommendations', params: {} }, TODAY, seeded)).payload as RecommendationDto;

      expect(dto).toEqual({ tier: null, recipes: [], emptyState: 'noNearExpiry' });
    });

    it('answers with the empty state of exception row 17 when a batch is near expiry and no recipe can rescue it', () => {
      const lonely = {
        ...seeded,
        batches: [buildBatch({ id: CHICKEN_NEAR, foodTypeId: TOMATO as Id, quantity: 1_000, expirationDate: '2026-10-02' })],
        counters: { nextId: CHICKEN_NEAR + 1, nextSeq: 2 },
      };

      const dto = valueOf(ask({ type: 'GetRecommendations', params: {} }, TODAY, lonely)).payload as RecommendationDto;

      expect(dto).toEqual({ tier: null, recipes: [], emptyState: 'noRescue' });
    });

    it('hides a blocked recipe: a recipe with a Unit Conflict is not a recommendation, however much of it is in stock (spec 4.4.A)', () => {
      const blocked = {
        ...kitchen,
        recipeIngredients: kitchen.recipeIngredients.map((row) => (row.foodTypeId === RICE ? { ...row, requiredUnit: 'kg' } : row)),
      };

      const dto = valueOf(ask({ type: 'GetRecommendations', params: {} }, TODAY, blocked)).payload as RecommendationDto;

      // the two recipes that used Rice are blocked, so Tier 1 is empty and Tier 2 holds the one that is left
      expect(dto.tier).toBe('partial');
      expect(dto.recipes.map((recipe) => recipe.name)).toEqual(['Chicken Broccoli Gratin']);
    });

    it('degrades to Tier 2, the partial matches, when no recipe is a full match (spec exception row 11)', () => {
      const short = { ...kitchen, batches: kitchen.batches.filter((batch) => batch.foodTypeId !== RICE && batch.foodTypeId !== EGG) };

      const dto = valueOf(ask({ type: 'GetRecommendations', params: {} }, TODAY, short)).payload as RecommendationDto;

      expect(dto.tier).toBe('partial');
      expect(dto.recipes.map((recipe) => recipe.name)).toEqual(['Chicken Broccoli Gratin', 'Chicken Fried Rice', 'Vietnamese Chicken Rice']);
    });
  });

  describe('getCatalog (spec 4.4.C)', () => {
    it('lists all six recipes A to Z, each with its status against the stock', () => {
      const dto = dataOf<CatalogDto>({ type: 'GetCatalog', params: { cuisineId: null } });

      expect(dto.cuisineId).toBeNull();
      expect(dto.rows.map((row) => [row.name, row.status, row.availableCount, row.totalCount])).toEqual([
        ['Beef and Broccoli Stir-Fry', 'nothing', 0, 2],
        ['Chicken Broccoli Gratin', 'partial', 1, 3],
        ['Chicken Fried Rice', 'full', 3, 3],
        ['Spinach Omelette', 'partial', 1, 3],
        ['Tomato Egg Stir-Fry', 'partial', 1, 2],
        ['Vietnamese Chicken Rice', 'full', 2, 2],
      ]);
    });

    it('lists the recipes that have no Rescued Ingredient too: the catalog has all of them (spec exception row 12)', () => {
      const dto = dataOf<CatalogDto>({ type: 'GetCatalog', params: { cuisineId: null } });

      expect(dto.rows.some((row) => row.name === 'Tomato Egg Stir-Fry')).toBe(true);
    });

    it('filters to one cuisine, in the backend, and says which', () => {
      const chinese = idOf(seeded.recipeCategories, 'Chinese Cuisine');

      const dto = dataOf<CatalogDto>({ type: 'GetCatalog', params: { cuisineId: chinese } });

      expect(dto.cuisineId).toBe(chinese);
      expect(dto.rows.map((row) => row.name)).toEqual(['Beef and Broccoli Stir-Fry', 'Chicken Fried Rice', 'Tomato Egg Stir-Fry']);
    });

    it('refuses a cuisine that is not one (CATEGORY_NOT_FOUND): an id that is nothing, or the id of a food category', () => {
      expect(errorOf(ask({ type: 'GetCatalog', params: { cuisineId: 999 } })).code).toBe('CATEGORY_NOT_FOUND');
      expect(errorOf(ask({ type: 'GetCatalog', params: { cuisineId: idOf(seeded.foodCategories, 'Meat') } })).code).toBe('CATEGORY_NOT_FOUND');
    });

    it('shows a recipe red when its Food Type has been deleted or its unit conflicts, which no stock can fix (spec 4.4.A)', () => {
      const blocked = {
        ...kitchen,
        recipeIngredients: kitchen.recipeIngredients.map((row) => (row.foodTypeId === RICE ? { ...row, requiredUnit: 'kg' } : row)),
      };

      const dto = valueOf(ask({ type: 'GetCatalog', params: { cuisineId: null } }, TODAY, blocked)).payload as CatalogDto;

      expect(dto.rows.filter((row) => row.status === 'blocked').map((row) => row.name)).toEqual(['Chicken Fried Rice', 'Vietnamese Chicken Rice']);
    });
  });

  describe('A to Z is the order of the names, and not of the creation (spec 4.4.D)', () => {
    // Apple is the Food Type that was created last, with a batch that is as near to its expiry as the Chicken's,
    // and Apple Pie is the recipe that was created last: each sorts first by name, and last by creation.
    const [APPLE, APPLE_BATCH, APPLE_PIE] = [90, 91, 92];
    const withApple: Snapshot = deepFreeze({
      ...kitchen,
      foodTypes: [...kitchen.foodTypes, buildFoodType({ id: APPLE, name: 'Apple', categoryId: idOf(seeded.foodCategories, 'Vegetables') })],
      batches: [
        ...kitchen.batches,
        buildBatch({ id: APPLE_BATCH, foodTypeId: APPLE, quantity: 300_000, inboundDate: '2026-09-28', expirationDate: '2026-10-03', createdSeq: 6 }),
      ],
      recipes: [...kitchen.recipes, buildRecipe({ id: APPLE_PIE, name: 'Apple Pie', recipeCategoryId: idOf(seeded.recipeCategories, 'French Cuisine') })],
      recipeIngredients: [...kitchen.recipeIngredients, buildIngredient({ recipeId: APPLE_PIE, foodTypeId: APPLE, requiredQuantity: 100_000 })],
      counters: { nextId: 93, nextSeq: 7 },
    });
    const dataWithApple = <T>(query: Query): T => valueOf(ask(query, TODAY, withApple)).payload as T;

    it('starts from a legal store', () => {
      expect(snapshotInvariantChecker(withApple).ok).toBe(true);
    });

    it('lists the Food Types of the inventory by name: Apple is first although it is the last created', () => {
      const rows = dataWithApple<InventoryListDto>({ type: 'GetInventoryList', params: {} }).rows;

      expect(rows.map((row) => row.name)).toEqual(['Apple', 'Beef', 'Broccoli', 'Chicken', 'Egg', 'Milk', 'Rice', 'Spinach', 'Tomato']);
    });

    it('breaks a tie of days left in the Warning Panel by the name of the Food Type: Apple before Chicken, whichever was created first', () => {
      const panel = dataWithApple<WarningPanelDto>({ type: 'GetWarningPanel', params: {} });

      expect(panel.nearExpiry.map((row) => [row.foodTypeName, row.daysLeft])).toEqual([['Apple', 2], ['Chicken', 2]]);
    });

    it('lists the recommendations by the name of the recipe: Apple Pie, a full match that rescues the Apple, comes first', () => {
      const dto = dataWithApple<RecommendationDto>({ type: 'GetRecommendations', params: {} });

      expect(dto.recipes.map((recipe) => recipe.name)).toEqual(['Apple Pie', 'Chicken Fried Rice', 'Vietnamese Chicken Rice']);
    });

    it('lists the catalog by the name of the recipe, and so does a cuisine filter', () => {
      const all = dataWithApple<CatalogDto>({ type: 'GetCatalog', params: { cuisineId: null } });
      const french = dataWithApple<CatalogDto>({ type: 'GetCatalog', params: { cuisineId: idOf(seeded.recipeCategories, 'French Cuisine') } });

      expect(all.rows[0]?.name).toBe('Apple Pie');
      expect(french.rows.map((row) => row.name)).toEqual(['Apple Pie', 'Chicken Broccoli Gratin', 'Spinach Omelette']);
    });
  });

  describe('every read', () => {
    const SAMPLE: { readonly [T in QueryType]: Extract<Query, { readonly type: T }> } = {
      GetReferenceData: { type: 'GetReferenceData', params: {} },
      GetInventoryList: { type: 'GetInventoryList', params: {} },
      GetFoodTypeDetail: { type: 'GetFoodTypeDetail', params: { foodTypeId: CHICKEN as Id } },
      GetWarningPanel: { type: 'GetWarningPanel', params: {} },
      GetRecommendations: { type: 'GetRecommendations', params: {} },
      GetCatalog: { type: 'GetCatalog', params: { cuisineId: null } },
    };

    it('is covered by one sample each, for exactly the six queries of the contract', () => {
      expect(Object.keys(SAMPLE).sort()).toEqual([...QUERY_TYPES].sort());
    });

    it.each(QUERY_TYPES)('%s returns a payload and no ChangeSet, so it never reaches the persist step', (type) => {
      const outcome = valueOf(ask(SAMPLE[type]));

      expect(outcome.payload).toBeDefined();
      expect(outcome.changeSets).toBeUndefined();
    });

    it('leaves the snapshot it was given as it was (the kitchen is frozen), and answers the same twice', () => {
      const before = structuredClone(kitchen);

      for (const type of QUERY_TYPES) expect(ask(SAMPLE[type])).toEqual(ask(SAMPLE[type]));

      expect(kitchen).toEqual(before);
    });
  });
});
