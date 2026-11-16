import { describe, expect, it } from 'vitest';
import type { ChangeSet } from '@freshrescue/contract-changeset';
import type { Batch, RecipeIngredient, Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { DateISO, Id, Result } from '@freshrescue/contract-primitives';
import type { Allocation, CookReportEntry, RecipeMatch } from '@freshrescue/contract-views';
import { buildBatch, buildFoodType, buildIngredient, buildRecipe, buildSnapshot } from '../../testing/fixtures';
import { recipeErrorEvaluator } from '../derive/recipeErrorEvaluator';
import { recipeMatchEvaluator } from '../derive/recipeMatchEvaluator';
import { stockAggregator } from '../derive/stockAggregator';
import { batchStatusClassifier } from '../foundation/batchStatusClassifier';
import { thresholdResolver } from '../foundation/thresholdResolver';
import { changeSetApplier } from '../state/changeSetApplier';
import { cookChangeSetBuilder } from './cookChangeSetBuilder';
import { cookReportBuilder } from './cookReportBuilder';
import { fefoAllocator } from './fefoAllocator';

const TODAY = '2026-10-10';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);

type Cooked = { readonly match: RecipeMatch | null; readonly allocations: Allocation[]; readonly changeSet: ChangeSet; readonly report: CookReportEntry; readonly after: Snapshot };

/**
 * One turn of the cook loop of RecipeCommandCoordinator (blueprint 4.2), for one recipe: derive, match,
 * then FEFO for each fulfilled row, the ChangeSet, the report entry, and the applied result.
 */
function cookOnce(snapshot: Snapshot, recipeId: Id, today: DateISO = TODAY): Cooked {
  const views = batchStatusClassifier(snapshot.batches, thresholdResolver(snapshot), today);
  const stock = stockAggregator(snapshot, views);
  const found = recipeMatchEvaluator(snapshot, stock, recipeErrorEvaluator(snapshot), [recipeId]);
  const match = found.ok ? (found.value[recipeId] ?? null) : null;
  if (match === null || match.status === 'blocked' || match.availableCount === 0) {
    return { match, allocations: [], changeSet: { ops: [] }, report: cookReportBuilder(recipeId, match, [], snapshot), after: snapshot };
  }
  const allocations = match.rows.filter((row) => row.fulfilled).map((row) => valueOf(fefoAllocator(row.foodTypeId, row.qReq, views)));
  const changeSet = valueOf(cookChangeSetBuilder(recipeId, allocations, snapshot));
  const report = cookReportBuilder(recipeId, match, allocations, snapshot);
  return { match, allocations, changeSet, report, after: valueOf(changeSetApplier(snapshot, changeSet)) };
}

const batch = (id: number, foodTypeId: number, quantity: number, expirationDate: DateISO, createdSeq: number): Batch =>
  buildBatch({ id, foodTypeId, quantity, inboundDate: '2026-10-01', expirationDate, createdSeq });
const row = (recipeId: number, foodTypeId: number, requiredQuantity: number): RecipeIngredient => buildIngredient({ recipeId, foodTypeId, requiredQuantity });
const quantities = (snapshot: Snapshot): [number, number][] => snapshot.batches.map((b) => [b.id, b.quantity]);

/** Beef (10) and Broccoli (11) in grams, with the given batches, and two recipes: 300 g Beef alone, and 300 g Beef with 200 g Broccoli. */
const kitchen = (batches: readonly Batch[]): Snapshot =>
  buildSnapshot({
    foodTypes: [buildFoodType({ id: 10, name: 'Beef' }), buildFoodType({ id: 11, name: 'Broccoli' })],
    batches: [...batches],
    recipes: [buildRecipe({ id: 30, name: 'Beef Stew' }), buildRecipe({ id: 31, name: 'Beef and Broccoli Stir-Fry' })],
    recipeIngredients: [row(30, 10, 300_000), row(31, 10, 300_000), row(31, 11, 200_000)],
  });

describe('BC-38 CookReportBuilder', () => {
  describe('the FEFO example of spec 4.5: the allocator, the ChangeSet builder and the report builder agree', () => {
    // A (100 g) expired yesterday, B (150 g) is Near-Expiry and expires tomorrow, C (200 g) is Fresh for 7 more days
    const fefo = kitchen([batch(20, 10, 100_000, '2026-10-09', 1), batch(21, 10, 150_000, '2026-10-11', 2), batch(22, 10, 200_000, '2026-10-17', 3)]);
    const cooked = cookOnce(fefo, 30);

    it('takes all of B and 150 g of C, and nothing of the Expired A', () => {
      expect(cooked.allocations).toEqual([
        {
          foodTypeId: 10,
          takes: [
            { batchId: 21, takeMilli: 150_000, emptied: true },
            { batchId: 22, takeMilli: 150_000, emptied: false },
          ],
        },
      ]);
    });

    it('removes B and leaves 50 g in C, while A stays as it was', () => {
      expect(quantities(cooked.after)).toEqual([[20, 100_000], [22, 50_000]]);
    });

    it('reports 300 g of Beef deducted and nothing missing, which is what the stock lost', () => {
      expect(cooked.report).toEqual({
        recipeId: 30,
        recipeName: 'Beef Stew',
        outcome: 'cooked',
        reason: null,
        deducted: [{ foodTypeId: 10, name: 'Beef', quantity: 300_000, unit: 'grams' }],
        missing: [],
      });
      const before = fefo.batches.reduce((sum, b) => sum + b.quantity, 0);
      const after = cooked.after.batches.reduce((sum, b) => sum + b.quantity, 0);
      expect(before - after).toBe(cooked.report.deducted[0]?.quantity);
    });
  });

  describe('the Partial example of spec 4.5: 150 g Beef and 250 g Broccoli for 300 g and 200 g', () => {
    const partial = kitchen([batch(20, 10, 150_000, '2026-10-20', 1), batch(21, 11, 250_000, '2026-10-20', 2)]);
    const cooked = cookOnce(partial, 31);

    it('cooks the Partial Match for its fulfilled row only', () => {
      expect(cooked.match?.status).toBe('partial');
      expect(cooked.allocations.map((allocation) => allocation.foodTypeId)).toEqual([11]);
    });

    it('deducts 200 g Broccoli, which leaves 50 g, and 0 g Beef, which keeps its 150 g', () => {
      expect(quantities(cooked.after)).toEqual([[20, 150_000], [21, 50_000]]);
    });

    it('reports Broccoli as deducted and Beef as missing, needed 300 and available 150', () => {
      expect(cooked.report).toEqual({
        recipeId: 31,
        recipeName: 'Beef and Broccoli Stir-Fry',
        outcome: 'cooked',
        reason: null,
        deducted: [{ foodTypeId: 11, name: 'Broccoli', quantity: 200_000, unit: 'grams' }],
        missing: [{ foodTypeId: 10, name: 'Beef', needed: 300_000, available: 150_000, unit: 'grams' }],
      });
    });
  });

  describe('a skipped recipe is a report entry, not an error, and lists nothing as deducted or missing', () => {
    it('skips a recipe with no available ingredient as nothingAvailable (exception row 16)', () => {
      const cooked = cookOnce(kitchen([batch(20, 10, 100_000, '2026-10-20', 1)]), 31);

      expect(cooked.report).toEqual({ recipeId: 31, recipeName: 'Beef and Broccoli Stir-Fry', outcome: 'skipped', reason: 'nothingAvailable', deducted: [], missing: [] });
      expect(cooked.changeSet.ops).toEqual([]);
    });

    it('skips a blocked recipe as blocked, whatever the stock (exception row 21)', () => {
      const stocked = kitchen([batch(20, 10, 900_000, '2026-10-20', 1), batch(21, 11, 900_000, '2026-10-20', 2)]);
      const conflict = { ...stocked, foodTypes: stocked.foodTypes.map((f) => (f.id === 11 ? { ...f, unit: 'pieces' } : f)) };

      expect(cookOnce(conflict, 31).report).toMatchObject({ outcome: 'skipped', reason: 'blocked', deducted: [], missing: [] });
    });

    it('skips a recipe that is gone, deleted while it was queued, as recipeNotFound', () => {
      expect(cookReportBuilder(404, null, [], kitchen([]))).toEqual({ recipeId: 404, recipeName: '', outcome: 'skipped', reason: 'recipeNotFound', deducted: [], missing: [] });
    });

    it('names a skipped recipe that is still there', () => {
      expect(cookReportBuilder(30, null, [], kitchen([])).recipeName).toBe('Beef Stew');
    });
  });

  it('sums the takes of each allocation into the quantity deducted, with the Food Type\'s unit', () => {
    const match: RecipeMatch = { status: 'full', rows: [{ foodTypeId: 10, qReq: 300_000, avail: 350_000, fulfilled: true, rescued: true }], availableCount: 1, hasRescued: true };
    const allocation: Allocation = {
      foodTypeId: 10,
      takes: [
        { batchId: 21, takeMilli: 120_000, emptied: true },
        { batchId: 22, takeMilli: 100_000, emptied: true },
        { batchId: 23, takeMilli: 80_000, emptied: false },
      ],
    };

    expect(cookReportBuilder(30, match, [allocation], kitchen([])).deducted).toEqual([{ foodTypeId: 10, name: 'Beef', quantity: 300_000, unit: 'grams' }]);
  });
});
