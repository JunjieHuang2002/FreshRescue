import { describe, expect, it } from 'vitest';
import type { Snapshot, ValidRecipeDraft } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result, ValidName, ValidQty, ValidUnit } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import { buildFoodType, buildIngredient, buildRecipe, buildRecipeCategory, buildSnapshot } from '../../testing/fixtures';
import { recipeErrorEvaluator } from '../derive/recipeErrorEvaluator';
import { snapshotInvariantChecker } from '../engine/snapshotInvariantChecker';
import { idAllocator } from '../foundation/idAllocator';
import { changeSetApplier } from '../state/changeSetApplier';
import { recipeUpsertDecider } from './recipeUpsertDecider';

const name = (text: string): ValidName => text as ValidName;
const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

const [BEEF, BROCCOLI, CHICKEN] = [30, 31, 32];
const [CHINESE, FRENCH] = [20, 21];
const [STIR_FRY, GRATIN] = [50, 51];
const GONE = 99; // the id of a Food Type that was deleted

const draftOf = (recipeCategoryId: number, ...rows: readonly [foodTypeId: number, milli: number, unit: string][]): ValidRecipeDraft => ({
  recipeCategoryId,
  rows: rows.map(([foodTypeId, milli, unit]) => ({ foodTypeId, requiredQuantity: milli as ValidQty, requiredUnit: unit as ValidUnit })),
});

/**
 * Stir-Fry (50, Chinese Cuisine) uses Beef 300 g and Broccoli 200 g. Gratin (51, French Cuisine) has one live row, Chicken 250 g,
 * and one row of a Food Type that was deleted (99, Cheese): it is blocked.
 */
const snapshot = buildSnapshot({
  recipeCategories: [buildRecipeCategory({ id: CHINESE, name: 'Chinese Cuisine' }), buildRecipeCategory({ id: FRENCH, name: 'French Cuisine' })],
  foodTypes: [buildFoodType({ id: BEEF, name: 'Beef' }), buildFoodType({ id: BROCCOLI, name: 'Broccoli' }), buildFoodType({ id: CHICKEN, name: 'Chicken' })],
  recipes: [buildRecipe({ id: STIR_FRY, name: 'Stir-Fry', recipeCategoryId: CHINESE }), buildRecipe({ id: GRATIN, name: 'Gratin', recipeCategoryId: FRENCH })],
  recipeIngredients: [
    buildIngredient({ recipeId: STIR_FRY, foodTypeId: BEEF, requiredQuantity: 300_000 }),
    buildIngredient({ recipeId: STIR_FRY, foodTypeId: BROCCOLI, requiredQuantity: 200_000 }),
    buildIngredient({ recipeId: GRATIN, foodTypeId: CHICKEN, requiredQuantity: 250_000 }),
    buildIngredient({ recipeId: GRATIN, foodTypeId: GONE, requiredQuantity: 100_000, deletedFoodTypeName: 'Cheese' }),
  ],
});

const rowsOf = (next: Snapshot, recipeId: number) =>
  next.recipeIngredients.filter((row) => row.recipeId === recipeId).map((row) => [row.foodTypeId, row.requiredQuantity, row.requiredUnit, row.deletedFoodTypeName]);

describe('BC-33 RecipeUpsertDecider', () => {
  describe('a new recipe', () => {
    const draft = draftOf(CHINESE, [BEEF, 300_000, 'grams'], [BROCCOLI, 200_000, 'grams']);

    it('puts the recipe with the new id, deletes its rows (it has none), and puts the rows of the draft in order', () => {
      expect(valueOf(recipeUpsertDecider(null, name('Beef Stir-Fry'), draft, snapshot, 60))).toEqual({
        ops: [
          { kind: 'putRecipe', row: { id: 60, name: 'Beef Stir-Fry', recipeCategoryId: CHINESE } },
          { kind: 'deleteIngredientsOfRecipe', recipeId: 60 },
          { kind: 'putIngredient', row: { recipeId: 60, foodTypeId: BEEF, requiredQuantity: 300_000, requiredUnit: 'grams', deletedFoodTypeName: null } },
          { kind: 'putIngredient', row: { recipeId: 60, foodTypeId: BROCCOLI, requiredQuantity: 200_000, requiredUnit: 'grams', deletedFoodTypeName: null } },
        ],
      });
    });

    it('is a ChangeSet that the applier takes although the recipe has no rows to delete, and the result is a legal state', () => {
      const alloc = idAllocator(snapshot.counters, { ids: 1, seqs: 0 });
      const id = alloc.ids[0] ?? expect.unreachable('no id was reserved');

      const next = valueOf(
        changeSetApplier(valueOf(changeSetApplier(snapshot, alloc.counterCs)), valueOf(recipeUpsertDecider(null, name('Beef Stir-Fry'), draft, snapshot, id))),
      );

      expect(next.recipes.at(-1)).toEqual({ id, name: 'Beef Stir-Fry', recipeCategoryId: CHINESE });
      expect(rowsOf(next, id)).toEqual([[BEEF, 300_000, 'grams', null], [BROCCOLI, 200_000, 'grams', null]]);
      expect(snapshotInvariantChecker(next)).toEqual({ ok: true, value: next });
    });

    it('uses the new id and does not look for a recipe with it', () => {
      expect(valueOf(recipeUpsertDecider(null, name('X'), draft, snapshot, STIR_FRY)).ops[0]).toEqual({
        kind: 'putRecipe',
        row: { id: STIR_FRY, name: 'X', recipeCategoryId: CHINESE },
      });
    });
  });

  describe('an edit of an existing recipe', () => {
    const draft = draftOf(FRENCH, [CHICKEN, 150_000, 'grams'], [BROCCOLI, 50_000, 'grams']);

    it('keeps the id of the recipe and ignores the id that was reserved, since an edit needs none', () => {
      const { ops } = valueOf(recipeUpsertDecider(STIR_FRY, name('Stir-Fry'), draft, snapshot, 888));

      expect(ops[0]).toEqual({ kind: 'putRecipe', row: { id: STIR_FRY, name: 'Stir-Fry', recipeCategoryId: FRENCH } });
      expect(ops[1]).toEqual({ kind: 'deleteIngredientsOfRecipe', recipeId: STIR_FRY });
      expect(ops.slice(2).every((op) => op.kind === 'putIngredient' && op.row.recipeId === STIR_FRY)).toBe(true);
      expect(JSON.stringify(ops)).not.toContain('888');
    });

    it('replaces the name, the cuisine and every row, and nothing of another recipe', () => {
      const next = valueOf(changeSetApplier(snapshot, valueOf(recipeUpsertDecider(STIR_FRY, name('Chicken Stir-Fry'), draft, snapshot, 888))));

      expect(next.recipes.find((recipe) => recipe.id === STIR_FRY)).toEqual({ id: STIR_FRY, name: 'Chicken Stir-Fry', recipeCategoryId: FRENCH });
      expect(rowsOf(next, STIR_FRY)).toEqual([[CHICKEN, 150_000, 'grams', null], [BROCCOLI, 50_000, 'grams', null]]);
      expect(next.recipes.find((recipe) => recipe.id === GRATIN)).toEqual(snapshot.recipes.find((recipe) => recipe.id === GRATIN));
      expect(rowsOf(next, GRATIN)).toEqual(rowsOf(snapshot, GRATIN));
      expect(next.foodTypes).toEqual(snapshot.foodTypes);
      expect(snapshotInvariantChecker(next)).toEqual({ ok: true, value: next });
    });

    it('drops a row that is not in the draft: Beef is gone from the recipe', () => {
      const next = valueOf(changeSetApplier(snapshot, valueOf(recipeUpsertDecider(STIR_FRY, name('Stir-Fry'), draft, snapshot, 888))));

      expect(next.recipeIngredients.some((row) => row.recipeId === STIR_FRY && row.foodTypeId === BEEF)).toBe(false);
    });

    it('repairs a blocked recipe: picking another Food Type for the row of a deleted one (spec 4.2.4.4)', () => {
      const repaired = draftOf(FRENCH, [CHICKEN, 250_000, 'grams'], [BEEF, 100_000, 'grams']);
      const next = valueOf(changeSetApplier(snapshot, valueOf(recipeUpsertDecider(GRATIN, name('Gratin'), repaired, snapshot, 888))));

      expect(recipeErrorEvaluator(snapshot)[GRATIN]).toEqual([{ reason: 'missingFoodType', foodTypeId: GONE, deletedFoodTypeName: 'Cheese' }]);
      expect(recipeErrorEvaluator(next)[GRATIN]).toBeUndefined();
      expect(rowsOf(next, GRATIN)).toEqual([[CHICKEN, 250_000, 'grams', null], [BEEF, 100_000, 'grams', null]]);
      expect(snapshotInvariantChecker(next).ok).toBe(true);
    });

    it('is RECIPE_NOT_FOUND for an id that is no recipe', () => {
      expect(errorOf(recipeUpsertDecider(999, name('X'), draft, snapshot, 888)).code).toBe('RECIPE_NOT_FOUND');
      expect(errorOf(recipeUpsertDecider(BEEF, name('X'), draft, snapshot, 888)).code).toBe('RECIPE_NOT_FOUND');
    });
  });

  it('keeps a Required Unit that differs from the Food Type\'s unit as it was entered: a Unit Conflict, derived later (spec section 3)', () => {
    const draft = draftOf(CHINESE, [BEEF, 300, 'kg']);
    const next = valueOf(changeSetApplier(snapshot, valueOf(recipeUpsertDecider(STIR_FRY, name('Stir-Fry'), draft, snapshot, 888))));

    expect(rowsOf(next, STIR_FRY)).toEqual([[BEEF, 300, 'kg', null]]);
    expect(recipeErrorEvaluator(next)[STIR_FRY]).toEqual([{ reason: 'unitConflict', foodTypeId: BEEF, requiredUnit: 'kg', foodTypeUnit: 'grams' }]);
    expect(snapshotInvariantChecker(next).ok).toBe(true);
  });

  it('makes a recipe in the cuisine Other when the draft says so', () => {
    const [put] = valueOf(recipeUpsertDecider(null, name('X'), draftOf(SYSTEM_IDS.CUISINE_OTHER, [BEEF, 1_000, 'grams']), snapshot, 60)).ops;

    expect(put).toEqual({ kind: 'putRecipe', row: { id: 60, name: 'X', recipeCategoryId: SYSTEM_IDS.CUISINE_OTHER } });
  });

  it('never edits the snapshot or the draft it is given', () => {
    const before = structuredClone(snapshot);
    const draft = draftOf(FRENCH, [CHICKEN, 150_000, 'grams']);
    const draftBefore = structuredClone(draft);

    recipeUpsertDecider(STIR_FRY, name('X'), draft, snapshot, 888);
    recipeUpsertDecider(null, name('X'), draft, snapshot, 60);
    recipeUpsertDecider(999, name('X'), draft, snapshot, 888);

    expect(snapshot).toEqual(before);
    expect(draft).toEqual(draftBefore);
  });
});
