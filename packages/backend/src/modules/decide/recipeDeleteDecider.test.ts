import { describe, expect, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { buildBatch, buildFoodType, buildIngredient, buildRecipe, buildRecipeCategory, buildSnapshot } from '../../testing/fixtures';
import { snapshotInvariantChecker } from '../engine/snapshotInvariantChecker';
import { changeSetApplier } from '../state/changeSetApplier';
import { recipeDeleteDecider } from './recipeDeleteDecider';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

const [BEEF, BROCCOLI] = [30, 31];
const [STIR_FRY, FRIED_RICE] = [50, 51];

/** Stir-Fry (50) uses Beef and Broccoli, Fried Rice (51) uses Beef; both are in Chinese Cuisine (20). Beef has a batch. */
const snapshot = buildSnapshot({
  recipeCategories: [buildRecipeCategory({ id: 20, name: 'Chinese Cuisine' })],
  foodTypes: [buildFoodType({ id: BEEF, name: 'Beef' }), buildFoodType({ id: BROCCOLI, name: 'Broccoli' })],
  batches: [buildBatch({ id: 40, foodTypeId: BEEF })],
  recipes: [
    buildRecipe({ id: STIR_FRY, name: 'Stir-Fry', recipeCategoryId: 20 }),
    buildRecipe({ id: FRIED_RICE, name: 'Fried Rice', recipeCategoryId: 20 }),
  ],
  recipeIngredients: [
    buildIngredient({ recipeId: STIR_FRY, foodTypeId: BEEF }),
    buildIngredient({ recipeId: STIR_FRY, foodTypeId: BROCCOLI }),
    buildIngredient({ recipeId: FRIED_RICE, foodTypeId: BEEF }),
  ],
});

describe('BC-34 RecipeDeleteDecider', () => {
  it('deletes the rows of the recipe and then the recipe', () => {
    expect(valueOf(recipeDeleteDecider(STIR_FRY, snapshot))).toEqual({
      ops: [{ kind: 'deleteIngredientsOfRecipe', recipeId: STIR_FRY }, { kind: 'deleteRecipe', id: STIR_FRY }],
    });
  });

  it('removes the recipe and every one of its rows, and leaves no row without a recipe', () => {
    const next = valueOf(changeSetApplier(snapshot, valueOf(recipeDeleteDecider(STIR_FRY, snapshot))));

    expect(next.recipes.map((recipe) => recipe.id)).toEqual([FRIED_RICE]);
    expect(next.recipeIngredients.map((row) => [row.recipeId, row.foodTypeId])).toEqual([[FRIED_RICE, BEEF]]);
    expect(snapshotInvariantChecker(next)).toEqual({ ok: true, value: next });
  });

  it('leaves the Food Types, the batches, the cuisines and the other recipe alone', () => {
    const next = valueOf(changeSetApplier(snapshot, valueOf(recipeDeleteDecider(STIR_FRY, snapshot))));

    expect(next.foodTypes).toEqual(snapshot.foodTypes);
    expect(next.batches).toEqual(snapshot.batches);
    expect(next.recipeCategories).toEqual(snapshot.recipeCategories);
    expect(next.recipes[0]).toEqual(snapshot.recipes[1]);
  });

  it('can delete the last recipe: a store with no recipe is a legal state', () => {
    const afterFirst = valueOf(changeSetApplier(snapshot, valueOf(recipeDeleteDecider(STIR_FRY, snapshot))));
    const afterBoth = valueOf(changeSetApplier(afterFirst, valueOf(recipeDeleteDecider(FRIED_RICE, afterFirst))));

    expect(afterBoth.recipes).toEqual([]);
    expect(afterBoth.recipeIngredients).toEqual([]);
    expect(snapshotInvariantChecker(afterBoth)).toEqual({ ok: true, value: afterBoth });
  });

  describe('RECIPE_NOT_FOUND', () => {
    it('refuses an id that is no recipe', () => {
      expect(errorOf(recipeDeleteDecider(999, snapshot)).code).toBe('RECIPE_NOT_FOUND');
    });

    it('does not take a Food Type or a cuisine for a recipe', () => {
      expect(errorOf(recipeDeleteDecider(BEEF, snapshot)).code).toBe('RECIPE_NOT_FOUND');
      expect(errorOf(recipeDeleteDecider(20, snapshot)).code).toBe('RECIPE_NOT_FOUND');
    });

    it('refuses a recipe that was deleted already', () => {
      const after = valueOf(changeSetApplier(snapshot, valueOf(recipeDeleteDecider(STIR_FRY, snapshot))));

      expect(errorOf(recipeDeleteDecider(STIR_FRY, after))).toMatchObject({ code: 'RECIPE_NOT_FOUND' });
    });
  });

  it('never edits the snapshot it is given', () => {
    const before = structuredClone(snapshot);

    recipeDeleteDecider(STIR_FRY, snapshot);
    recipeDeleteDecider(999, snapshot);

    expect(snapshot).toEqual(before);
  });
});
