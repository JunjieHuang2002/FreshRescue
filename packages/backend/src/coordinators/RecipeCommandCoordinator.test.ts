import { describe, expect, it, vi } from 'vitest';
import type { ChangeSet, Outcome } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { CommandPayloads, RecipeDraftRow } from '@freshrescue/contract-messages';
import type { Id, Result } from '@freshrescue/contract-primitives';
import type { CookReportDto } from '@freshrescue/contract-views';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import { buildBatch, buildFoodType, buildIngredient, buildRecipe, buildRecipeCategory, buildSnapshot } from '../testing/fixtures';
import { snapshotInvariantChecker } from '../modules/engine/snapshotInvariantChecker';
import { changeSetApplier } from '../modules/state/changeSetApplier';
import { createRecipeCommandCoordinator } from './RecipeCommandCoordinator';

// A test double of FefoAllocator. The match that the loop acts on and the allocator both read the same
// stock, so no snapshot can make the allocator find less than the match promised. While `control.fefoFails`
// is set, it answers INSUFFICIENT_STOCK anyway, which is what the guard of the loop is for (blueprint 2.4).
const control = vi.hoisted(() => ({ fefoFails: false }));

vi.mock('../modules/engine/fefoAllocator', async (importOriginal) => {
  const original = await importOriginal<typeof import('../modules/engine/fefoAllocator')>();
  return {
    fefoAllocator: (...args: Parameters<typeof original.fefoAllocator>) =>
      control.fefoFails ? { ok: false, err: { code: 'INSUFFICIENT_STOCK', detail: 'a test double finds no stock' } } : original.fefoAllocator(...args),
  };
});

const valueOf =<T>(result: Result<T, DomainError>): T =>
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

/** Each ChangeSet of an Outcome applied in order, as the write path does it, and every result checked. */
function settle(from: Snapshot, outcome: Outcome): Snapshot {
  let current = from;
  for (const changeSet of outcome.changeSets ?? []) {
    current = valueOf(changeSetApplier(current, changeSet));
    valueOf(snapshotInvariantChecker(current));
  }
  return current;
}

const coordinator = createRecipeCommandCoordinator();
const TODAY = '2026-10-01';

const quantitiesOf = (snapshot: Snapshot, foodTypeId: Id): number[] =>
  snapshot.batches.filter((batch) => batch.foodTypeId === foodTypeId).map((batch) => batch.quantity);

describe('BX-04 RecipeCommandCoordinator', () => {
  describe('saveRecipe', () => {
    const [BEEF, BROCCOLI, EGG, CHINESE, STIR_FRY] = [30, 31, 32, 20, 50];

    /** Beef and Broccoli are in grams and Egg is in pieces. Beef Stir-Fry (50) is a Chinese Cuisine (20) recipe with a row for each of Beef and Broccoli. Counters at 51 and 1. */
    const snapshot: Snapshot = deepFreeze(
      buildSnapshot({
        recipeCategories: [buildRecipeCategory({ id: CHINESE, name: 'Chinese Cuisine' })],
        foodTypes: [buildFoodType({ id: BEEF, name: 'Beef' }), buildFoodType({ id: BROCCOLI, name: 'Broccoli' }), buildFoodType({ id: EGG, name: 'Egg', unit: 'pieces' })],
        recipes: [buildRecipe({ id: STIR_FRY, name: 'Beef Stir-Fry', recipeCategoryId: CHINESE })],
        recipeIngredients: [
          buildIngredient({ recipeId: STIR_FRY, foodTypeId: BEEF, requiredQuantity: 300_000 }),
          buildIngredient({ recipeId: STIR_FRY, foodTypeId: BROCCOLI, requiredQuantity: 200_000 }),
        ],
      }),
    );
    const NEXT_ID = snapshot.counters.nextId;

    const row = (foodTypeId: Id, quantity: number, unit = 'grams'): RecipeDraftRow => ({ foodTypeId, quantity, unit });
    const save = (recipeId: Id | null, name: string, rows: readonly RecipeDraftRow[], cuisineId: Id | null = null) =>
      coordinator.handle({ type: 'SaveRecipe', payload: { recipeId, name, draft: { cuisineId, rows } } satisfies CommandPayloads['SaveRecipe'] }, snapshot, TODAY);

    it('creates a recipe: the next id, the counters bumped, the rows replaced (it has none), and the id in the answer', () => {
      const outcome = valueOf(save(null, 'Egg Fry', [row(EGG, 2_000, 'pieces')], CHINESE));

      expect(outcome.payload).toEqual({ recipeId: NEXT_ID });
      expect(outcome.changeSets).toEqual([
        {
          ops: [
            { kind: 'putCounters', row: { nextId: NEXT_ID + 1, nextSeq: snapshot.counters.nextSeq } },
            { kind: 'putRecipe', row: { id: NEXT_ID, name: 'Egg Fry', recipeCategoryId: CHINESE } },
            { kind: 'deleteIngredientsOfRecipe', recipeId: NEXT_ID },
            { kind: 'putIngredient', row: { recipeId: NEXT_ID, foodTypeId: EGG, requiredQuantity: 2_000, requiredUnit: 'pieces', deletedFoodTypeName: null } },
          ],
        },
      ]);
      expect(settle(snapshot, outcome).recipes.at(-1)).toEqual({ id: NEXT_ID, name: 'Egg Fry', recipeCategoryId: CHINESE });
    });

    it('puts a recipe with no cuisine in the cuisine Other, which is the default', () => {
      expect(settle(snapshot, valueOf(save(null, 'Egg Fry', [row(EGG, 2_000, 'pieces')]))).recipes.at(-1)?.recipeCategoryId).toBe(SYSTEM_IDS.CUISINE_OTHER);
    });

    it('edits a recipe: no id is reserved, the answer is the id it was given, and all its rows are replaced, in the order of the draft', () => {
      const outcome = valueOf(save(STIR_FRY, 'Egg Stir-Fry', [row(EGG, 3_000, 'pieces'), row(BEEF, 100_000)]));
      const after = settle(snapshot, outcome);

      expect(outcome.payload).toEqual({ recipeId: STIR_FRY });
      expect(outcome.changeSets?.[0]?.ops.some((op) => op.kind === 'putCounters')).toBe(false);
      expect(after.recipes[0]).toEqual({ id: STIR_FRY, name: 'Egg Stir-Fry', recipeCategoryId: SYSTEM_IDS.CUISINE_OTHER });
      expect(after.recipeIngredients.map((r) => [r.recipeId, r.foodTypeId, r.requiredQuantity])).toEqual([
        [STIR_FRY, EGG, 3_000],
        [STIR_FRY, BEEF, 100_000],
      ]);
    });

    it('lets a recipe keep its own name in another case when it is edited (the record itself is left out of the duplicate check)', () => {
      expect(save(STIR_FRY, 'BEEF STIR-FRY', [row(BEEF, 1_000)]).ok).toBe(true);
    });

    it('lets a Required Unit differ from the Food Type\'s unit, which makes the recipe a Unit Conflict later (spec section 3)', () => {
      const after = settle(snapshot, valueOf(save(null, 'Beef Soup', [row(BEEF, 300, 'kg')])));

      expect(after.recipeIngredients.at(-1)).toMatchObject({ foodTypeId: BEEF, requiredUnit: 'kg' });
    });

    it('refuses a bad name with its code (NAME_EMPTY, NAME_TOO_LONG, NAME_DUPLICATE, across cuisines and whatever the case)', () => {
      const code = (name: string) => errorOf(save(null, name, [row(BEEF, 1_000)])).code;

      expect(code('')).toBe('NAME_EMPTY');
      expect(code('x'.repeat(201))).toBe('NAME_TOO_LONG');
      expect(code(' beef stir-fry ')).toBe('NAME_DUPLICATE');
      expect(errorOf(save(STIR_FRY, 'Egg Fry', [row(BEEF, 1_000)]).ok ? save(null, 'beef stir-fry', []) : save(null, 'x', [])).code).toBe('NAME_DUPLICATE');
    });

    it('refuses a draft that breaks the rules of a recipe, with the code of the rule', () => {
      const code = (rows: readonly RecipeDraftRow[], cuisineId: Id | null = null) => errorOf(save(null, 'New Recipe', rows, cuisineId)).code;

      expect(code([])).toBe('NO_INGREDIENTS');
      expect(code([row(BEEF, 1_000), row(BEEF, 2_000)])).toBe('DUP_INGREDIENT');
      expect(code([row(999, 1_000)])).toBe('UNKNOWN_FOOD_TYPE');
      expect(code([row(BEEF, 0)])).toBe('QTY_NOT_POSITIVE');
      expect(code([row(BEEF, 1.5)])).toBe('QTY_NOT_INTEGER');
      expect(code([row(BEEF, 500_000_001)])).toBe('QTY_TOO_LARGE');
      expect(code([row(BEEF, 1_000, 'tbsp')])).toBe('UNIT_UNKNOWN');
      expect(code([row(BEEF, 1_000)], 999)).toBe('CATEGORY_NOT_FOUND');
    });

    it('refuses to edit a recipe that is not there (RECIPE_NOT_FOUND), after the name and the draft have been judged', () => {
      expect(errorOf(save(999, 'Ghost', [row(BEEF, 1_000)])).code).toBe('RECIPE_NOT_FOUND');
      expect(errorOf(save(999, '', [row(BEEF, 1_000)])).code).toBe('NAME_EMPTY');
      expect(errorOf(save(999, 'Ghost', [])).code).toBe('NO_INGREDIENTS');
    });

    it('judges the name before the draft: a taken name with an empty draft is NAME_DUPLICATE', () => {
      expect(errorOf(save(null, 'Beef Stir-Fry', [])).code).toBe('NAME_DUPLICATE');
    });
  });

  describe('deleteRecipe', () => {
    const snapshot: Snapshot = deepFreeze(
      buildSnapshot({
        foodTypes: [buildFoodType({ id: 30, name: 'Beef' })],
        recipes: [buildRecipe({ id: 50, name: 'Beef Plate' }), buildRecipe({ id: 51, name: 'Beef Soup' })],
        recipeIngredients: [buildIngredient({ recipeId: 50, foodTypeId: 30 }), buildIngredient({ recipeId: 51, foodTypeId: 30 })],
      }),
    );
    const remove = (recipeId: Id) => coordinator.handle({ type: 'DeleteRecipe', payload: { recipeId } }, snapshot, TODAY);

    it('deletes the recipe with its rows, and has no payload and no counter', () => {
      const outcome = valueOf(remove(50));
      const after = settle(snapshot, outcome);

      expect(outcome.payload).toBeUndefined();
      expect(outcome.changeSets).toEqual([{ ops: [{ kind: 'deleteIngredientsOfRecipe', recipeId: 50 }, { kind: 'deleteRecipe', id: 50 }] }]);
      expect(after.recipes.map((recipe) => recipe.id)).toEqual([51]);
      expect(after.recipeIngredients.map((r) => r.recipeId)).toEqual([51]);
    });

    it('refuses a recipe that is not there (RECIPE_NOT_FOUND)', () => {
      expect(errorOf(remove(999)).code).toBe('RECIPE_NOT_FOUND');
    });
  });

  describe('cookRecipes', () => {
    const cook = (snapshot: Snapshot, recipeIds: readonly Id[], today = TODAY) =>
      coordinator.handle({ type: 'CookRecipes', payload: { recipeIds } }, snapshot, today);
    const reportsOf = (outcome: Outcome): CookReportDto['reports'] => (outcome.payload as CookReportDto).reports;
    const FRESH = { inboundDate: '2026-10-01', expirationDate: '2026-12-01' };

    const [BEEF, BROCCOLI, CHICKEN, RICE, EGG, TOMATO] = [30, 31, 32, 33, 34, 35];
    const foodTypes = [
      buildFoodType({ id: BEEF, name: 'Beef' }),
      buildFoodType({ id: BROCCOLI, name: 'Broccoli' }),
      buildFoodType({ id: CHICKEN, name: 'Chicken' }),
      buildFoodType({ id: RICE, name: 'Rice' }),
      buildFoodType({ id: EGG, name: 'Egg', unit: 'pieces' }),
      buildFoodType({ id: TOMATO, name: 'Tomato', unit: 'pieces' }),
    ];

    describe('a Partial Match (spec 4.5): 300 g Beef and 200 g Broccoli, with 150 g Beef and 250 g Broccoli in stock', () => {
      const snapshot = deepFreeze(
        buildSnapshot({
          foodTypes,
          batches: [
            buildBatch({ id: 60, foodTypeId: BEEF, quantity: 150_000, ...FRESH }),
            buildBatch({ id: 61, foodTypeId: BROCCOLI, quantity: 250_000, ...FRESH }),
          ],
          recipes: [buildRecipe({ id: 50, name: 'Beef and Broccoli Stir-Fry' })],
          recipeIngredients: [
            buildIngredient({ recipeId: 50, foodTypeId: BEEF, requiredQuantity: 300_000 }),
            buildIngredient({ recipeId: 50, foodTypeId: BROCCOLI, requiredQuantity: 200_000 }),
          ],
        }),
      );
      const outcome = valueOf(cook(snapshot, [50]));

      it('deducts 200 g of Broccoli, leaving 50 g, and 0 g of Beef', () => {
        const after = settle(snapshot, outcome);

        expect(quantitiesOf(after, BROCCOLI)).toEqual([50_000]);
        expect(quantitiesOf(after, BEEF)).toEqual([150_000]);
      });

      it('writes one ChangeSet for the recipe, and the Beef batch is not in it', () => {
        expect(outcome.changeSets).toHaveLength(1);
        expect(JSON.stringify(outcome.changeSets)).not.toContain('"id":60');
      });

      it('reports Broccoli as deducted, and Beef as missing: needed 300, available 150', () => {
        expect(reportsOf(outcome)).toEqual([
          {
            recipeId: 50,
            recipeName: 'Beef and Broccoli Stir-Fry',
            outcome: 'cooked',
            reason: null,
            deducted: [{ foodTypeId: BROCCOLI, name: 'Broccoli', quantity: 200_000, unit: 'grams' }],
            missing: [{ foodTypeId: BEEF, name: 'Beef', needed: 300_000, available: 150_000, unit: 'grams' }],
          },
        ]);
      });
    });

    describe('FEFO (spec 4.5): 300 g of Beef, with batch A of 100 g Expired, B of 150 g Near-Expiry and C of 200 g Fresh', () => {
      const snapshot = deepFreeze(
        buildSnapshot({
          foodTypes,
          batches: [
            buildBatch({ id: 60, foodTypeId: BEEF, quantity: 100_000, inboundDate: '2026-09-20', expirationDate: '2026-09-30', createdSeq: 1 }),
            buildBatch({ id: 61, foodTypeId: BEEF, quantity: 150_000, inboundDate: '2026-09-25', expirationDate: '2026-10-02', createdSeq: 2 }),
            buildBatch({ id: 62, foodTypeId: BEEF, quantity: 200_000, inboundDate: '2026-09-28', expirationDate: '2026-10-08', createdSeq: 3 }),
          ],
          recipes: [buildRecipe({ id: 50, name: 'Beef Plate' })],
          recipeIngredients: [buildIngredient({ recipeId: 50, foodTypeId: BEEF, requiredQuantity: 300_000 })],
        }),
      );
      const outcome = valueOf(cook(snapshot, [50]));

      it('uses up B, takes 150 g from C, which leaves 50 g, and leaves the expired A alone', () => {
        const after = settle(snapshot, outcome);

        expect(after.batches.map((batch) => [batch.id, batch.quantity])).toEqual([[60, 100_000], [62, 50_000]]);
      });

      it('agrees across the allocator, the ChangeSet and the report: 300 g deducted in all', () => {
        expect(outcome.changeSets?.[0]?.ops).toEqual([
          { kind: 'deleteBatch', id: 61 },
          { kind: 'putBatch', row: { ...snapshot.batches[2], quantity: 50_000 } },
        ]);
        expect(reportsOf(outcome)[0]?.deducted).toEqual([{ foodTypeId: BEEF, name: 'Beef', quantity: 300_000, unit: 'grams' }]);
        expect(reportsOf(outcome)[0]?.missing).toEqual([]);
      });

      it('evaluates the freshness at the date of the request: a day later B is Expired too, only 200 g is usable, and the one ingredient is short, so the recipe is skipped', () => {
        const later = valueOf(cook(snapshot, [50], '2026-10-03'));

        expect(reportsOf(later)[0]).toMatchObject({ outcome: 'skipped', reason: 'nothingAvailable', deducted: [], missing: [] });
        expect(later.changeSets).toEqual([]);
      });
    });

    describe('a queue where two recipes share an ingredient (spec exception row 14)', () => {
      /** Chicken Fried Rice needs Chicken 200 g, Rice 300 g and 2 Egg; Vietnamese Chicken Rice needs Chicken 250 g and Rice 300 g. In stock: Chicken 300 g, Rice 600 g, no Egg. */
      const snapshot = deepFreeze(
        buildSnapshot({
          foodTypes,
          batches: [
            buildBatch({ id: 60, foodTypeId: CHICKEN, quantity: 300_000, ...FRESH }),
            buildBatch({ id: 61, foodTypeId: RICE, quantity: 600_000, ...FRESH }),
          ],
          recipes: [buildRecipe({ id: 50, name: 'Chicken Fried Rice' }), buildRecipe({ id: 51, name: 'Vietnamese Chicken Rice' })],
          recipeIngredients: [
            buildIngredient({ recipeId: 50, foodTypeId: CHICKEN, requiredQuantity: 200_000 }),
            buildIngredient({ recipeId: 50, foodTypeId: RICE, requiredQuantity: 300_000 }),
            buildIngredient({ recipeId: 50, foodTypeId: EGG, requiredQuantity: 2_000, requiredUnit: 'pieces' }),
            buildIngredient({ recipeId: 51, foodTypeId: CHICKEN, requiredQuantity: 250_000 }),
            buildIngredient({ recipeId: 51, foodTypeId: RICE, requiredQuantity: 300_000 }),
          ],
        }),
      );
      const outcome = valueOf(cook(snapshot, [50, 51]));

      it('lets the first recipe deduct the shared ingredient, and the second find it depleted and deduct none of it', () => {
        const [first, second] = reportsOf(outcome);

        expect(first?.deducted).toEqual([
          { foodTypeId: CHICKEN, name: 'Chicken', quantity: 200_000, unit: 'grams' },
          { foodTypeId: RICE, name: 'Rice', quantity: 300_000, unit: 'grams' },
        ]);
        expect(first?.missing).toEqual([{ foodTypeId: EGG, name: 'Egg', needed: 2_000, available: 0, unit: 'pieces' }]);
        expect(second?.deducted).toEqual([{ foodTypeId: RICE, name: 'Rice', quantity: 300_000, unit: 'grams' }]);
        expect(second?.missing).toEqual([{ foodTypeId: CHICKEN, name: 'Chicken', needed: 250_000, available: 100_000, unit: 'grams' }]);
      });

      it('commits each recipe as a ChangeSet of its own, in queue order, and the queue goes on', () => {
        expect(outcome.changeSets).toHaveLength(2);
        expect(reportsOf(outcome).map((report) => [report.recipeName, report.outcome])).toEqual([
          ['Chicken Fried Rice', 'cooked'],
          ['Vietnamese Chicken Rice', 'cooked'],
        ]);
      });

      it('leaves what the two ChangeSets leave, applied one after the other: 100 g of Chicken, and no Rice batch', () => {
        const after = settle(snapshot, outcome);

        expect(quantitiesOf(after, CHICKEN)).toEqual([100_000]);
        expect(quantitiesOf(after, RICE)).toEqual([]);
      });

      it('runs the same two recipes in the other order to a different result: the queue order decides who gets the Chicken', () => {
        const swapped = valueOf(cook(snapshot, [51, 50]));

        expect(reportsOf(swapped).map((report) => report.recipeName)).toEqual(['Vietnamese Chicken Rice', 'Chicken Fried Rice']);
        expect(reportsOf(swapped)[0]?.missing).toEqual([]);
        expect(reportsOf(swapped)[1]?.missing.map((line) => line.foodTypeId)).toEqual([CHICKEN, EGG]);
      });
    });

    describe('the same recipe queued twice (spec exception row 21)', () => {
      const snapshot = deepFreeze(
        buildSnapshot({
          foodTypes,
          batches: [
            buildBatch({ id: 60, foodTypeId: TOMATO, quantity: 4_000, ...FRESH }),
            buildBatch({ id: 61, foodTypeId: EGG, quantity: 6_000, ...FRESH }),
          ],
          recipes: [buildRecipe({ id: 50, name: 'Tomato Egg Stir-Fry' })],
          recipeIngredients: [
            buildIngredient({ recipeId: 50, foodTypeId: TOMATO, requiredQuantity: 2_000, requiredUnit: 'pieces' }),
            buildIngredient({ recipeId: 50, foodTypeId: EGG, requiredQuantity: 3_000, requiredUnit: 'pieces' }),
          ],
        }),
      );

      it('runs twice, each run on what the last one left', () => {
        const outcome = valueOf(cook(snapshot, [50, 50]));

        expect(reportsOf(outcome).map((report) => report.outcome)).toEqual(['cooked', 'cooked']);
        expect(outcome.changeSets).toHaveLength(2);
        expect(settle(snapshot, outcome).batches).toEqual([]);
      });

      it('skips a third run, which finds nothing left (spec exception row 16), and the queue goes on to the end', () => {
        const outcome = valueOf(cook(snapshot, [50, 50, 50]));

        expect(reportsOf(outcome).map((report) => [report.outcome, report.reason])).toEqual([
          ['cooked', null],
          ['cooked', null],
          ['skipped', 'nothingAvailable'],
        ]);
        expect(outcome.changeSets).toHaveLength(2);
      });
    });

    describe('a recipe that cannot be cooked at its turn is skipped with its reason, and the queue continues (spec exception rows 16 and 21)', () => {
      /** Plain Rice can be cooked. Beef Kilo is a Unit Conflict (kg against grams). Cheese Plate lost its Food Type. Egg Dish has no Egg in stock. */
      const snapshot = deepFreeze(
        buildSnapshot({
          foodTypes,
          batches: [buildBatch({ id: 60, foodTypeId: RICE, quantity: 500_000, ...FRESH }), buildBatch({ id: 61, foodTypeId: BEEF, quantity: 500_000, ...FRESH })],
          recipes: [
            buildRecipe({ id: 50, name: 'Plain Rice' }),
            buildRecipe({ id: 51, name: 'Beef Kilo' }),
            buildRecipe({ id: 52, name: 'Cheese Plate' }),
            buildRecipe({ id: 53, name: 'Egg Dish' }),
          ],
          recipeIngredients: [
            buildIngredient({ recipeId: 50, foodTypeId: RICE, requiredQuantity: 100_000 }),
            buildIngredient({ recipeId: 51, foodTypeId: BEEF, requiredQuantity: 1_000, requiredUnit: 'kg' }),
            buildIngredient({ recipeId: 52, foodTypeId: 99, requiredQuantity: 100_000, deletedFoodTypeName: 'Cheese' }),
            buildIngredient({ recipeId: 53, foodTypeId: EGG, requiredQuantity: 2_000, requiredUnit: 'pieces' }),
          ],
        }),
      );

      it('skips a blocked recipe, whether the cause is a Unit Conflict or a deleted Food Type, and cooks the one after it', () => {
        const outcome = valueOf(cook(snapshot, [51, 52, 50]));

        expect(reportsOf(outcome).map((report) => [report.recipeName, report.outcome, report.reason])).toEqual([
          ['Beef Kilo', 'skipped', 'blocked'],
          ['Cheese Plate', 'skipped', 'blocked'],
          ['Plain Rice', 'cooked', null],
        ]);
        expect(outcome.changeSets).toHaveLength(1);
      });

      it('skips a recipe with no ingredient available, and lists nothing as deducted or missing', () => {
        const [report] = reportsOf(valueOf(cook(snapshot, [53])));

        expect(report).toEqual({ recipeId: 53, recipeName: 'Egg Dish', outcome: 'skipped', reason: 'nothingAvailable', deducted: [], missing: [] });
      });

      it('skips a recipe that is no longer there, with no name: a stale id in the queue is a report entry and not an error', () => {
        const outcome = valueOf(cook(snapshot, [999, 50]));

        expect(reportsOf(outcome)[0]).toEqual({ recipeId: 999, recipeName: '', outcome: 'skipped', reason: 'recipeNotFound', deducted: [], missing: [] });
        expect(reportsOf(outcome)[1]?.outcome).toBe('cooked');
      });

      it('writes nothing for a skipped recipe: a queue of skipped recipes has no ChangeSet at all', () => {
        const outcome = valueOf(cook(snapshot, [51, 52, 53, 999]));

        expect(outcome.changeSets).toEqual([]);
        expect(settle(snapshot, outcome)).toEqual(snapshot);
      });
    });

    it('answers an empty queue with an empty report and no ChangeSet', () => {
      expect(valueOf(cook(deepFreeze(buildSnapshot({ foodTypes })), []))).toEqual({ changeSets: [], payload: { reports: [] } });
    });

    it('never takes from an Expired batch, and a Food Type with only Expired stock is Missing (spec 4.2.3)', () => {
      const snapshot = deepFreeze(
        buildSnapshot({
          foodTypes,
          batches: [buildBatch({ id: 60, foodTypeId: BEEF, quantity: 500_000, inboundDate: '2026-09-01', expirationDate: '2026-09-20' }), buildBatch({ id: 61, foodTypeId: RICE, quantity: 500_000, ...FRESH })],
          recipes: [buildRecipe({ id: 50, name: 'Beef Rice' })],
          recipeIngredients: [buildIngredient({ recipeId: 50, foodTypeId: BEEF, requiredQuantity: 100_000 }), buildIngredient({ recipeId: 50, foodTypeId: RICE, requiredQuantity: 100_000 })],
        }),
      );

      const outcome = valueOf(cook(snapshot, [50]));

      expect(reportsOf(outcome)[0]?.missing).toEqual([{ foodTypeId: BEEF, name: 'Beef', needed: 100_000, available: 0, unit: 'grams' }]);
      expect(quantitiesOf(settle(snapshot, outcome), BEEF)).toEqual([500_000]);
    });

    it('is refused as a whole, with the code of the guard, when the snapshot is inconsistent: the first error ends the command', () => {
      // two batches that carry the same id: the two takes of a recipe reach the applier as two operations on one record
      const corrupt = deepFreeze(
        buildSnapshot({
          foodTypes,
          batches: [
            buildBatch({ id: 60, foodTypeId: BEEF, quantity: 100_000, createdSeq: 1, ...FRESH }),
            buildBatch({ id: 60, foodTypeId: BEEF, quantity: 100_000, createdSeq: 2, ...FRESH }),
          ],
          recipes: [buildRecipe({ id: 50, name: 'Beef Plate' }), buildRecipe({ id: 51, name: 'Tiny Beef' })],
          recipeIngredients: [buildIngredient({ recipeId: 50, foodTypeId: BEEF, requiredQuantity: 150_000 }), buildIngredient({ recipeId: 51, foodTypeId: BEEF, requiredQuantity: 10_000 })],
        }),
      );

      expect(errorOf(cook(corrupt, [50])).code).toBe('CONFLICTING_OPS');
      expect(errorOf(cook(corrupt, [51, 50])).code).toBe('CONFLICTING_OPS');
    });

    it('is refused with BATCH_NOT_FOUND when a take names a batch that is another Food Type\'s: the guard of the ChangeSet builder', () => {
      // two batches carry the id 60, one of Beef and one of Rice, so the take of 60 from Beef finds the batch of Rice
      const corrupt = deepFreeze(
        buildSnapshot({
          foodTypes,
          batches: [
            buildBatch({ id: 60, foodTypeId: BEEF, quantity: 100_000, createdSeq: 1, ...FRESH }),
            buildBatch({ id: 60, foodTypeId: RICE, quantity: 100_000, createdSeq: 2, ...FRESH }),
          ],
          recipes: [buildRecipe({ id: 50, name: 'Tiny Beef' })],
          recipeIngredients: [buildIngredient({ recipeId: 50, foodTypeId: BEEF, requiredQuantity: 50_000 })],
        }),
      );

      expect(errorOf(cook(corrupt, [50])).code).toBe('BATCH_NOT_FOUND');
    });

    it('is refused with INSUFFICIENT_STOCK when FEFO finds less than the match promised (a test double): the guard of the allocator, and no ChangeSet is returned', () => {
      const snapshot = deepFreeze(
        buildSnapshot({
          foodTypes,
          batches: [buildBatch({ id: 60, foodTypeId: BEEF, quantity: 100_000, ...FRESH })],
          recipes: [buildRecipe({ id: 50, name: 'Tiny Beef' })],
          recipeIngredients: [buildIngredient({ recipeId: 50, foodTypeId: BEEF, requiredQuantity: 50_000 })],
        }),
      );

      control.fefoFails = true;
      const refused = (() => {
        try {
          return cook(snapshot, [50, 50]);
        } finally {
          control.fefoFails = false;
        }
      })();

      expect(errorOf(refused).code).toBe('INSUFFICIENT_STOCK');
      expect(valueOf(cook(snapshot, [50, 50])).changeSets).toHaveLength(2);
    });

    it('returns ChangeSets that can be written one at a time, each a legal state of its own', () => {
      const snapshot = deepFreeze(
        buildSnapshot({
          foodTypes,
          batches: [buildBatch({ id: 60, foodTypeId: TOMATO, quantity: 4_000, ...FRESH }), buildBatch({ id: 61, foodTypeId: EGG, quantity: 6_000, ...FRESH })],
          recipes: [buildRecipe({ id: 50, name: 'Tomato Egg Stir-Fry' })],
          recipeIngredients: [
            buildIngredient({ recipeId: 50, foodTypeId: TOMATO, requiredQuantity: 2_000, requiredUnit: 'pieces' }),
            buildIngredient({ recipeId: 50, foodTypeId: EGG, requiredQuantity: 3_000, requiredUnit: 'pieces' }),
          ],
        }),
      );
      const changeSets: readonly ChangeSet[] = valueOf(cook(snapshot, [50, 50])).changeSets ?? [];

      const afterFirst = valueOf(changeSetApplier(snapshot, changeSets[0] ?? { ops: [] }));

      expect(snapshotInvariantChecker(afterFirst).ok).toBe(true);
      expect(quantitiesOf(afterFirst, TOMATO)).toEqual([2_000]);
    });
  });

  it('handles each of its three commands, and leaves the snapshot it was given as it was', () => {
    const snapshot = deepFreeze(
      buildSnapshot({
        foodTypes: [buildFoodType({ id: 30, name: 'Beef' })],
        recipes: [buildRecipe({ id: 50, name: 'Beef Plate' })],
        recipeIngredients: [buildIngredient({ recipeId: 50, foodTypeId: 30 })],
      }),
    );
    const before = structuredClone(snapshot);

    for (const command of [
      { type: 'SaveRecipe', payload: { recipeId: null, name: 'Beef Soup', draft: { cuisineId: null, rows: [{ foodTypeId: 30, quantity: 1_000, unit: 'grams' }] } } },
      { type: 'DeleteRecipe', payload: { recipeId: 50 } },
      { type: 'CookRecipes', payload: { recipeIds: [50] } },
    ] as const) {
      expect(coordinator.handle(command, snapshot, TODAY).ok, command.type).toBe(true);
    }

    expect(snapshot).toEqual(before);
  });
});
