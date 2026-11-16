import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { DateISO, Id, Result } from '@freshrescue/contract-primitives';
import type { MatchMap, RecipeMatch, StockMap } from '@freshrescue/contract-views';
import { buildBatch, buildFoodType, buildIngredient, buildRecipe, buildSnapshot } from '../../testing/fixtures';
import { batchStatusClassifier } from '../foundation/batchStatusClassifier';
import { thresholdResolver } from '../foundation/thresholdResolver';
import { recipeErrorEvaluator } from './recipeErrorEvaluator';
import { recipeMatchEvaluator } from './recipeMatchEvaluator';
import { stockAggregator } from './stockAggregator';

const TODAY = '2026-10-10';
// with the default T_eff of 3 days: 1 day left is Near-Expiry, 10 days left is Fresh, and yesterday is Expired
const NEAR = '2026-10-11';
const FRESH = '2026-10-20';
const EXPIRED = '2026-10-09';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);

/** The derive chain, the errors, then the evaluator, as the query and the cook loop run them. */
function evaluate(snapshot: Snapshot, onlyIds?: readonly Id[] | null, today: DateISO = TODAY): Result<MatchMap, DomainError> {
  const stock = stockAggregator(snapshot, batchStatusClassifier(snapshot.batches, thresholdResolver(snapshot), today));
  return recipeMatchEvaluator(snapshot, stock, recipeErrorEvaluator(snapshot), onlyIds);
}
const matchOf = (snapshot: Snapshot, recipeId: Id): RecipeMatch | undefined => valueOf(evaluate(snapshot))[recipeId];

const batch = (id: number, foodTypeId: number, quantity: number, expirationDate: DateISO) =>
  buildBatch({ id, foodTypeId, quantity, inboundDate: '2026-10-01', expirationDate });

/** Beef (10) and Broccoli (11), and the recipe of spec 4.5 that needs 300 g Beef and 200 g Broccoli. */
const stirFry = (batches: ReturnType<typeof batch>[]): Snapshot =>
  buildSnapshot({
    foodTypes: [buildFoodType({ id: 10, name: 'Beef' }), buildFoodType({ id: 11, name: 'Broccoli' })],
    batches,
    recipes: [buildRecipe({ id: 20, name: 'Beef and Broccoli Stir-Fry' })],
    recipeIngredients: [
      buildIngredient({ recipeId: 20, foodTypeId: 10, requiredQuantity: 300_000 }),
      buildIngredient({ recipeId: 20, foodTypeId: 11, requiredQuantity: 200_000 }),
    ],
  });

describe('BC-13 RecipeMatchEvaluator', () => {
  it('finds the Partial Match of spec 4.5: 150 g Beef against 300 needed, 250 g Broccoli against 200', () => {
    const snapshot = stirFry([batch(30, 10, 150_000, FRESH), batch(31, 11, 250_000, FRESH)]);

    expect(matchOf(snapshot, 20)).toEqual({
      status: 'partial',
      rows: [
        { foodTypeId: 10, qReq: 300_000, avail: 150_000, fulfilled: false, rescued: false },
        { foodTypeId: 11, qReq: 200_000, avail: 250_000, fulfilled: true, rescued: false },
      ],
      availableCount: 1,
      hasRescued: false,
    });
  });

  it('is a Full Match when every row has Q_avail >= Q_req, and Q_avail equal to Q_req is enough', () => {
    const snapshot = stirFry([batch(30, 10, 300_000, FRESH), batch(31, 11, 250_000, FRESH)]);

    expect(matchOf(snapshot, 20)).toMatchObject({ status: 'full', availableCount: 2 });
    expect(matchOf(snapshot, 20)?.rows.map((row) => row.fulfilled)).toEqual([true, true]);
  });

  it('is nothing available when every row is Missing, Q_avail = 0 included (exception row 16)', () => {
    const snapshot = stirFry([batch(30, 10, 100_000, FRESH)]);

    expect(matchOf(snapshot, 20)).toEqual({
      status: 'nothing',
      rows: [
        { foodTypeId: 10, qReq: 300_000, avail: 100_000, fulfilled: false, rescued: false },
        { foodTypeId: 11, qReq: 200_000, avail: 0, fulfilled: false, rescued: false },
      ],
      availableCount: 0,
      hasRescued: false,
    });
  });

  it('marks a recipe with an error row blocked, with no rows and nothing available, whatever the stock (spec 4.4.A)', () => {
    const conflicting = stirFry([batch(30, 10, 900_000, NEAR), batch(31, 11, 900_000, NEAR)]);
    const blocked = { ...conflicting, foodTypes: conflicting.foodTypes.map((f) => (f.id === 11 ? { ...f, unit: 'pieces' } : f)) };

    expect(matchOf(blocked, 20)).toEqual({ status: 'blocked', rows: [], availableCount: 0, hasRescued: false });
  });

  describe('the Rescued Ingredient (spec 1.2): Q_near_expiry > 0 and Q_avail >= Q_req', () => {
    it('rescues a fulfilled row that has Near-Expiry stock', () => {
      const snapshot = stirFry([batch(30, 10, 350_000, NEAR), batch(31, 11, 250_000, FRESH)]);

      expect(matchOf(snapshot, 20)?.rows.map((row) => row.rescued)).toEqual([true, false]);
      expect(matchOf(snapshot, 20)?.hasRescued).toBe(true);
    });

    it('rescues nothing when the near-expiry ingredient is itself short of stock (spec 4.4.B)', () => {
      const snapshot = stirFry([batch(30, 10, 100_000, NEAR), batch(31, 11, 250_000, FRESH)]);

      expect(matchOf(snapshot, 20)).toMatchObject({ status: 'partial', hasRescued: false });
      expect(matchOf(snapshot, 20)?.rows[0]).toMatchObject({ avail: 100_000, fulfilled: false, rescued: false });
    });

    it('counts Fresh and Near-Expiry batches together toward Q_avail, and still rescues the row', () => {
      // 100 g near expiry and 250 g fresh: 350 g available, of which some is near expiry
      const snapshot = stirFry([batch(30, 10, 100_000, NEAR), batch(31, 10, 250_000, FRESH), batch(32, 11, 250_000, FRESH)]);

      expect(matchOf(snapshot, 20)?.rows[0]).toEqual({ foodTypeId: 10, qReq: 300_000, avail: 350_000, fulfilled: true, rescued: true });
    });

    it('rescues nothing with Fresh stock alone', () => {
      const snapshot = stirFry([batch(30, 10, 300_000, FRESH), batch(31, 11, 200_000, FRESH)]);

      expect(matchOf(snapshot, 20)).toMatchObject({ status: 'full', hasRescued: false });
    });
  });

  it('never counts Expired stock: the spec FEFO stock has Q_avail 350 g for 300 g needed (spec 4.5)', () => {
    const fefo = stirFry([batch(30, 10, 100_000, EXPIRED), batch(31, 10, 150_000, NEAR), batch(32, 10, 200_000, '2026-10-17'), batch(33, 11, 200_000, FRESH)]);
    const onlyExpired = stirFry([batch(30, 10, 900_000, EXPIRED), batch(33, 11, 200_000, FRESH)]);

    expect(matchOf(fefo, 20)?.rows[0]).toEqual({ foodTypeId: 10, qReq: 300_000, avail: 350_000, fulfilled: true, rescued: true });
    expect(matchOf(onlyExpired, 20)?.rows[0]).toMatchObject({ avail: 0, fulfilled: false });
  });

  describe('onlyIds', () => {
    const two = {
      ...stirFry([batch(30, 10, 300_000, FRESH)]),
      recipes: [buildRecipe({ id: 20, name: 'Beef and Broccoli Stir-Fry' }), buildRecipe({ id: 21, name: 'Steak' })],
      recipeIngredients: [
        buildIngredient({ recipeId: 20, foodTypeId: 10, requiredQuantity: 300_000 }),
        buildIngredient({ recipeId: 20, foodTypeId: 11, requiredQuantity: 200_000 }),
        buildIngredient({ recipeId: 21, foodTypeId: 10, requiredQuantity: 200_000 }),
      ],
    };

    it('evaluates every recipe when it is null or left out', () => {
      expect(Object.keys(valueOf(evaluate(two, null))).map(Number)).toEqual([20, 21]);
      expect(Object.keys(valueOf(evaluate(two))).map(Number)).toEqual([20, 21]);
    });

    it('evaluates only the recipes it names, which is how the cook loop takes one recipe at a time', () => {
      expect(valueOf(evaluate(two, [21]))).toEqual({
        21: { status: 'full', rows: [{ foodTypeId: 10, qReq: 200_000, avail: 300_000, fulfilled: true, rescued: false }], availableCount: 1, hasRescued: false },
      });
      expect(valueOf(evaluate(two, []))).toEqual({});
    });

    it('answers RECIPE_NOT_FOUND for an id that names no recipe, such as one deleted while it was queued', () => {
      const result = evaluate(two, [21, 404]);

      expect(result).toMatchObject({ ok: false, err: { code: 'RECIPE_NOT_FOUND' } });
      expect(result.ok ? '' : result.err.detail).toContain('404');
      expect(evaluate(two, [404])).toMatchObject({ ok: false, err: { code: 'RECIPE_NOT_FOUND' } });
    });
  });

  it('keeps the rows in the order of the recipe', () => {
    const reversed = { ...stirFry([]), recipeIngredients: [...stirFry([]).recipeIngredients].reverse() };

    expect(matchOf(reversed, 20)?.rows.map((row) => row.foodTypeId)).toEqual([11, 10]);
  });

  it('works from the stock it is given, without a date of its own', () => {
    const snapshot = stirFry([]);
    const stock: StockMap = {
      10: { total: 400_000, avail: 300_000, near: 300_000, byStatus: { fresh: 0, nearExpiry: 300_000, expired: 100_000 }, overall: 'expired' },
      11: { total: 200_000, avail: 200_000, near: 0, byStatus: { fresh: 200_000, nearExpiry: 0, expired: 0 }, overall: 'fresh' },
    };

    expect(valueOf(recipeMatchEvaluator(snapshot, stock, {}, null))[20]).toMatchObject({ status: 'full', availableCount: 2, hasRescued: true });
  });
});
