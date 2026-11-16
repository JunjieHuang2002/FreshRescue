import { describe, expect, it } from 'vitest';
import type { Batch, RecipeIngredient, Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { DateISO, Result } from '@freshrescue/contract-primitives';
import type { CatalogDto, MatchMap, RecommendationDto, StockMap } from '@freshrescue/contract-views';
import { buildBatch, buildFoodType, buildIngredient, buildRecipe, buildRecipeCategory, buildSnapshot } from '../../testing/fixtures';
import { batchStatusClassifier } from '../foundation/batchStatusClassifier';
import { thresholdResolver } from '../foundation/thresholdResolver';
import { catalogBuilder } from './catalogBuilder';
import { nameSorter } from './nameSorter';
import { recipeErrorEvaluator } from './recipeErrorEvaluator';
import { recipeMatchEvaluator } from './recipeMatchEvaluator';
import { recommendationBuilder } from './recommendationBuilder';
import { stockAggregator } from './stockAggregator';

const TODAY = '2026-10-10';
// with the default T_eff of 3 days
const NEAR = '2026-10-11';
const FRESH = '2026-10-20';
const EXPIRED = '2026-10-09';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);

/** The read side of getRecommendations and getCatalog, in the blueprint's order. */
function readModels(snapshot: Snapshot, today: DateISO = TODAY): { recommendations: RecommendationDto; catalog: CatalogDto } {
  const stock = stockAggregator(snapshot, batchStatusClassifier(snapshot.batches, thresholdResolver(snapshot), today));
  const errors = recipeErrorEvaluator(snapshot);
  const matches = valueOf(recipeMatchEvaluator(snapshot, stock, errors, null));
  const order = nameSorter(snapshot.recipes);
  return {
    recommendations: recommendationBuilder(matches, stock, snapshot, order),
    catalog: valueOf(catalogBuilder(matches, errors, snapshot, order, null)),
  };
}
const recommend = (snapshot: Snapshot): RecommendationDto => readModels(snapshot).recommendations;
const namesOf = (dto: RecommendationDto): string[] => dto.recipes.map((recipe) => recipe.name);

const batch = (id: number, foodTypeId: number, quantity: number, expirationDate: DateISO): Batch =>
  buildBatch({ id, foodTypeId, quantity, inboundDate: '2026-10-01', expirationDate });
const row = (recipeId: number, foodTypeId: number, requiredQuantity: number, requiredUnit = 'grams'): RecipeIngredient =>
  buildIngredient({ recipeId, foodTypeId, requiredQuantity, requiredUnit });

// Beef 10, Broccoli 11, Chicken 12, Rice 13 in grams and Milk 14 in ml. Chinese Cuisine is 5 and French Cuisine 6.
const RECIPES = {
  stirFry: buildRecipe({ id: 20, name: 'Beef and Broccoli Stir-Fry', recipeCategoryId: 5 }),
  friedRice: buildRecipe({ id: 21, name: 'Chicken Fried Rice', recipeCategoryId: 5 }),
  stew: buildRecipe({ id: 22, name: 'Beef Stew', recipeCategoryId: 6 }),
  tartare: buildRecipe({ id: 23, name: 'Beef Tartare', recipeCategoryId: 6 }),
};
const ROWS = {
  stirFry: [row(20, 10, 300_000), row(20, 11, 200_000)],
  friedRice: [row(21, 12, 200_000), row(21, 13, 300_000)],
  stew: [row(22, 10, 300_000)],
  // a Unit Conflict: Beef is held in grams
  tartare: [row(23, 10, 1_000, 'kg')],
};

function kitchen(recipes: readonly (keyof typeof RECIPES)[], batches: readonly Batch[]): Snapshot {
  return buildSnapshot({
    foodTypes: [
      buildFoodType({ id: 10, name: 'Beef' }),
      buildFoodType({ id: 11, name: 'Broccoli' }),
      buildFoodType({ id: 12, name: 'Chicken' }),
      buildFoodType({ id: 13, name: 'Rice' }),
      buildFoodType({ id: 14, name: 'Milk', unit: 'ml' }),
    ],
    recipeCategories: [buildRecipeCategory({ id: 5, name: 'Chinese Cuisine' }), buildRecipeCategory({ id: 6, name: 'French Cuisine' })],
    recipes: recipes.map((key) => RECIPES[key]),
    recipeIngredients: recipes.flatMap((key) => ROWS[key]),
    batches: [...batches],
  });
}

describe('BC-14 RecommendationBuilder', () => {
  describe('Tier 1: the gated recipes that are a Full Match (spec 4.4.B)', () => {
    it('lists every recipe that rescues near-expiry stock and has all its ingredients, A to Z', () => {
      // Beef is near expiry: both recipes that use it can be cooked in full and both rescue it
      const snapshot = kitchen(['stew', 'stirFry'], [batch(30, 10, 650_000, NEAR), batch(31, 11, 250_000, FRESH)]);

      expect(recommend(snapshot)).toMatchObject({ tier: 'full', emptyState: null });
      expect(namesOf(recommend(snapshot))).toEqual(['Beef and Broccoli Stir-Fry', 'Beef Stew']);
    });

    it('describes each recipe: its cuisine, its counts, and each row with its stock and its Rescued badge', () => {
      const snapshot = kitchen(['stirFry'], [batch(30, 10, 350_000, NEAR), batch(31, 11, 250_000, FRESH)]);

      expect(recommend(snapshot).recipes).toEqual([
        {
          recipeId: 20,
          name: 'Beef and Broccoli Stir-Fry',
          cuisineName: 'Chinese Cuisine',
          availableCount: 2,
          totalCount: 2,
          ingredients: [
            { foodTypeId: 10, name: 'Beef', requiredQuantity: 300_000, requiredUnit: 'grams', available: 350_000, state: 'ok', rescued: true, foodTypeUnit: null },
            { foodTypeId: 11, name: 'Broccoli', requiredQuantity: 200_000, requiredUnit: 'grams', available: 250_000, state: 'ok', rescued: false, foodTypeUnit: null },
          ],
        },
      ]);
    });

    it('does not show Tier 2 while Tier 1 has a recipe', () => {
      // the stew is a Full Match that rescues Beef; the stir-fry rescues Beef too but is short of Broccoli
      const snapshot = kitchen(['stirFry', 'stew'], [batch(30, 10, 650_000, NEAR), batch(31, 11, 100_000, FRESH)]);

      expect(recommend(snapshot).tier).toBe('full');
      expect(namesOf(recommend(snapshot))).toEqual(['Beef Stew']);
    });
  });

  describe('Tier 2: the fallback to Partial Matches (exception row 11)', () => {
    it('degrades to the gated recipes that have a Missing Ingredient when no recipe is a Full Match', () => {
      const snapshot = kitchen(['stirFry', 'friedRice'], [batch(30, 10, 350_000, NEAR), batch(31, 11, 100_000, FRESH)]);

      expect(recommend(snapshot)).toMatchObject({ tier: 'partial', emptyState: null });
      expect(namesOf(recommend(snapshot))).toEqual(['Beef and Broccoli Stir-Fry']);
    });

    it('badges each Missing Ingredient and still shows which row is rescued', () => {
      const snapshot = kitchen(['stirFry'], [batch(30, 10, 350_000, NEAR), batch(31, 11, 100_000, FRESH)]);
      const [recipe] = recommend(snapshot).recipes;

      expect(recipe).toMatchObject({ availableCount: 1, totalCount: 2 });
      expect(recipe?.ingredients.map((line) => [line.name, line.state, line.available, line.rescued])).toEqual([
        ['Beef', 'ok', 350_000, true],
        ['Broccoli', 'missing', 100_000, false],
      ]);
    });

    it('sorts Tier 2 A to Z as well', () => {
      // both are short of something and both rescue near-expiry Beef
      const snapshot = kitchen(['stirFry', 'stew'], [batch(30, 10, 350_000, NEAR)]);
      const shortStew = { ...snapshot, recipeIngredients: [...ROWS.stirFry, row(22, 10, 300_000), row(22, 13, 50_000)] };

      expect(recommend(shortStew).tier).toBe('partial');
      expect(namesOf(recommend(shortStew))).toEqual(['Beef and Broccoli Stir-Fry', 'Beef Stew']);
    });
  });

  describe('the entry gate (spec 4.4.B)', () => {
    it('leaves out a recipe without a Rescued Ingredient, which stays in the catalog (exception row 12)', () => {
      // the fried rice is a Full Match on Fresh stock only: nothing it uses is near expiry
      const snapshot = kitchen(['stirFry', 'friedRice'], [
        batch(30, 10, 350_000, NEAR),
        batch(31, 11, 250_000, FRESH),
        batch(32, 12, 200_000, FRESH),
        batch(33, 13, 300_000, FRESH),
      ]);
      const { recommendations, catalog } = readModels(snapshot);

      expect(namesOf(recommendations)).toEqual(['Beef and Broccoli Stir-Fry']);
      expect(catalog.rows.map((r) => [r.name, r.status])).toEqual([
        ['Beef and Broccoli Stir-Fry', 'full'],
        ['Chicken Fried Rice', 'full'],
      ]);
    });

    it('leaves out a recipe whose near-expiry ingredient is itself short of stock (spec 4.4.B)', () => {
      const snapshot = kitchen(['stirFry'], [batch(30, 10, 100_000, NEAR), batch(31, 11, 250_000, FRESH)]);

      expect(recommend(snapshot)).toEqual({ tier: null, recipes: [], emptyState: 'noRescue' });
    });

    it('hides a blocked recipe even when it uses near-expiry stock (spec 4.4.A, exception row 6)', () => {
      const snapshot = kitchen(['stirFry', 'tartare'], [batch(30, 10, 350_000, NEAR), batch(31, 11, 250_000, FRESH)]);
      const { recommendations, catalog } = readModels(snapshot);

      expect(namesOf(recommendations)).toEqual(['Beef and Broccoli Stir-Fry']);
      expect(catalog.rows.find((r) => r.name === 'Beef Tartare')?.status).toBe('blocked');
    });
  });

  describe('the empty states (spec 4.6)', () => {
    it('says there are no near-expiry items when nothing is near expiry (exception row 13)', () => {
      const allFresh = kitchen(['stirFry'], [batch(30, 10, 350_000, FRESH), batch(31, 11, 250_000, FRESH)]);

      expect(recommend(allFresh)).toEqual({ tier: null, recipes: [], emptyState: 'noNearExpiry' });
      expect(recommend(kitchen(['stirFry'], []))).toEqual({ tier: null, recipes: [], emptyState: 'noNearExpiry' });
      expect(recommend(buildSnapshot())).toEqual({ tier: null, recipes: [], emptyState: 'noNearExpiry' });
    });

    it('counts Expired stock as no near-expiry item', () => {
      const expired = kitchen(['stirFry'], [batch(30, 10, 350_000, EXPIRED), batch(31, 11, 250_000, FRESH)]);

      expect(recommend(expired).emptyState).toBe('noNearExpiry');
    });

    it('says no recipe can rescue them when near-expiry items exist but no recipe uses them (exception row 17)', () => {
      // Milk is near expiry, and no recipe uses Milk
      const snapshot = kitchen(['stirFry'], [batch(30, 14, 500_000, NEAR), batch(31, 10, 350_000, FRESH), batch(32, 11, 250_000, FRESH)]);

      expect(recommend(snapshot)).toEqual({ tier: null, recipes: [], emptyState: 'noRescue' });
    });
  });

  it('applies the gate itself: a blocked match is in neither tier, whatever else it says (spec 4.4.B)', () => {
    const snapshot = kitchen(['stirFry', 'stew'], []);
    const blocked = { status: 'blocked', rows: [], availableCount: 0, hasRescued: true } as const;
    const stock: StockMap = {
      10: { total: 1, avail: 1, near: 1, byStatus: { fresh: 0, nearExpiry: 1, expired: 0 }, overall: 'nearExpiry' },
    };
    const withFull: MatchMap = { 20: blocked, 22: { status: 'full', rows: [], availableCount: 1, hasRescued: true } };
    const withPartial: MatchMap = { 20: blocked, 22: { status: 'partial', rows: [], availableCount: 1, hasRescued: true } };

    expect(recommendationBuilder(withFull, stock, snapshot, [20, 22])).toMatchObject({ tier: 'full', recipes: [{ name: 'Beef Stew' }] });
    expect(recommendationBuilder(withPartial, stock, snapshot, [20, 22])).toMatchObject({ tier: 'partial', recipes: [{ name: 'Beef Stew' }] });
    expect(recommendationBuilder({ 20: blocked }, stock, snapshot, [20])).toEqual({ tier: null, recipes: [], emptyState: 'noRescue' });
  });

  it('builds from the matches and the order it is given, and skips an id that it has no match for', () => {
    const snapshot = kitchen(['stirFry', 'stew'], []);
    const rescuing = { status: 'full', rows: [], availableCount: 1, hasRescued: true } as const;
    const matches: MatchMap = { 20: rescuing, 22: rescuing };
    const stock: StockMap = {
      10: { total: 1, avail: 1, near: 1, byStatus: { fresh: 0, nearExpiry: 1, expired: 0 }, overall: 'nearExpiry' },
    };

    expect(namesOf(recommendationBuilder(matches, stock, snapshot, [22, 404, 20]))).toEqual(['Beef Stew', 'Beef and Broccoli Stir-Fry']);
  });
});
