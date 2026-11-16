import { describe, expect, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { buildBatch, buildFoodType, buildIngredient, buildRecipe, buildSnapshot } from '../../testing/fixtures';
import { recipeErrorEvaluator } from '../derive/recipeErrorEvaluator';
import { snapshotInvariantChecker } from '../engine/snapshotInvariantChecker';
import { changeSetApplier } from '../state/changeSetApplier';
import { foodTypeDeleteDecider } from './foodTypeDeleteDecider';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

const [CHICKEN, MILK, EGG, SALT, RICE] = [30, 31, 32, 33, 34];
const [GRATIN, OMELETTE, PLAIN_RICE] = [50, 51, 52];

/**
 * Chicken has one batch, which is Expired. Egg has two batches. Milk, Salt and Rice have none.
 * Gratin (50) uses Chicken and Milk, Omelette (51) uses Egg and Milk, Plain Rice (52) uses Rice. Nothing uses Salt.
 */
const snapshot = buildSnapshot({
  foodTypes: [
    buildFoodType({ id: CHICKEN, name: 'Chicken' }),
    buildFoodType({ id: MILK, name: 'Milk', unit: 'ml', customThresholdDays: 2 }),
    buildFoodType({ id: EGG, name: 'Egg', unit: 'pieces' }),
    buildFoodType({ id: SALT, name: 'Salt' }),
    buildFoodType({ id: RICE, name: 'Rice' }),
  ],
  batches: [
    buildBatch({ id: 40, foodTypeId: CHICKEN, inboundDate: '2026-08-01', expirationDate: '2026-09-01' }),
    buildBatch({ id: 41, foodTypeId: EGG }),
    buildBatch({ id: 42, foodTypeId: EGG }),
  ],
  recipes: [
    buildRecipe({ id: GRATIN, name: 'Gratin' }),
    buildRecipe({ id: OMELETTE, name: 'Omelette' }),
    buildRecipe({ id: PLAIN_RICE, name: 'Plain Rice' }),
  ],
  recipeIngredients: [
    buildIngredient({ recipeId: GRATIN, foodTypeId: CHICKEN, requiredQuantity: 250_000 }),
    buildIngredient({ recipeId: GRATIN, foodTypeId: MILK, requiredQuantity: 100_000, requiredUnit: 'ml' }),
    buildIngredient({ recipeId: OMELETTE, foodTypeId: EGG, requiredQuantity: 3_000, requiredUnit: 'pieces' }),
    buildIngredient({ recipeId: OMELETTE, foodTypeId: MILK, requiredQuantity: 50_000, requiredUnit: 'ml' }),
    buildIngredient({ recipeId: PLAIN_RICE, foodTypeId: RICE, requiredQuantity: 300_000 }),
  ],
});

describe('BC-26 FoodTypeDeleteDecider', () => {
  describe('a Food Type with no batch that recipes use (spec exception row 7)', () => {
    const changeSet = valueOf(foodTypeDeleteDecider(MILK, snapshot));

    it('stamps its name on every recipe row that names it, then deletes it', () => {
      expect(changeSet).toEqual({
        ops: [
          { kind: 'putIngredient', row: { recipeId: GRATIN, foodTypeId: MILK, requiredQuantity: 100_000, requiredUnit: 'ml', deletedFoodTypeName: 'Milk' } },
          { kind: 'putIngredient', row: { recipeId: OMELETTE, foodTypeId: MILK, requiredQuantity: 50_000, requiredUnit: 'ml', deletedFoodTypeName: 'Milk' } },
          { kind: 'deleteFoodType', id: MILK },
        ],
      });
    });

    it('leaves the other rows of those recipes, and every other recipe, untouched', () => {
      const next = valueOf(changeSetApplier(snapshot, changeSet));

      expect(next.recipeIngredients.filter((row) => row.foodTypeId !== MILK)).toEqual(snapshot.recipeIngredients.filter((row) => row.foodTypeId !== MILK));
      expect(next.recipes).toEqual(snapshot.recipes);
    });

    it('keeps each row where it was, with its quantity and unit, so the recipe can be edited or deleted (spec 4.2.4.4)', () => {
      const next = valueOf(changeSetApplier(snapshot, changeSet));

      expect(next.recipeIngredients).toHaveLength(snapshot.recipeIngredients.length);
      expect(next.recipeIngredients.map((row) => [row.recipeId, row.foodTypeId, row.requiredQuantity, row.requiredUnit])).toEqual(
        snapshot.recipeIngredients.map((row) => [row.recipeId, row.foodTypeId, row.requiredQuantity, row.requiredUnit]),
      );
    });

    it('blocks those recipes as Missing food type: Milk, and only them (spec exception row 7)', () => {
      const errors = recipeErrorEvaluator(valueOf(changeSetApplier(snapshot, changeSet)));

      expect(errors[GRATIN]).toEqual([{ reason: 'missingFoodType', foodTypeId: MILK, deletedFoodTypeName: 'Milk' }]);
      expect(errors[OMELETTE]).toEqual([{ reason: 'missingFoodType', foodTypeId: MILK, deletedFoodTypeName: 'Milk' }]);
      expect(errors[PLAIN_RICE]).toBeUndefined();
    });

    it('deletes the Food Type and its threshold together: the threshold is a field of the record', () => {
      const next = valueOf(changeSetApplier(snapshot, changeSet));

      expect(next.foodTypes.map((foodType) => foodType.id)).toEqual([CHICKEN, EGG, SALT, RICE]);
    });

    it('leaves a state that the invariant checker accepts', () => {
      const next = valueOf(changeSetApplier(snapshot, changeSet));

      expect(snapshotInvariantChecker(next)).toEqual({ ok: true, value: next });
    });

    it('is not repaired by a new Food Type of the same name: references are by id (spec 4.2.4.4)', () => {
      const next = valueOf(changeSetApplier(snapshot, changeSet));
      const recreated = { ...next, foodTypes: [...next.foodTypes, buildFoodType({ id: 90, name: 'Milk', unit: 'ml' })] };

      expect(recipeErrorEvaluator(recreated)[GRATIN]).toEqual([{ reason: 'missingFoodType', foodTypeId: MILK, deletedFoodTypeName: 'Milk' }]);
    });
  });

  it('stamps the name exactly as the Food Type has it, case included', () => {
    const named = buildSnapshot({
      foodTypes: [buildFoodType({ id: 30, name: 'Soy MILK' })],
      recipes: [buildRecipe({ id: 50, name: 'Latte' })],
      recipeIngredients: [buildIngredient({ recipeId: 50, foodTypeId: 30 })],
    });

    expect(valueOf(foodTypeDeleteDecider(30, named)).ops[0]).toMatchObject({ kind: 'putIngredient', row: { deletedFoodTypeName: 'Soy MILK' } });
  });

  it('deletes a Food Type that no recipe uses with a single operation', () => {
    expect(valueOf(foodTypeDeleteDecider(SALT, snapshot))).toEqual({ ops: [{ kind: 'deleteFoodType', id: SALT }] });
  });

  describe('HAS_BATCHES: a Food Type with a batch cannot be deleted (spec exception row 15)', () => {
    it('refuses it and says how many batches to remove first', () => {
      const error = errorOf(foodTypeDeleteDecider(EGG, snapshot));

      expect(error.code).toBe('HAS_BATCHES');
      expect(error.detail).toBe('Remove all 2 batches first');
    });

    it('words one batch in the singular, and still counts it', () => {
      expect(errorOf(foodTypeDeleteDecider(CHICKEN, snapshot))).toEqual({ code: 'HAS_BATCHES', detail: 'Remove the 1 batch first' });
    });

    it('counts an Expired batch like any other, which is the only batch of Chicken', () => {
      expect(snapshot.batches.find((batch) => batch.foodTypeId === CHICKEN)?.expirationDate).toBe('2026-09-01');
      expect(errorOf(foodTypeDeleteDecider(CHICKEN, snapshot)).code).toBe('HAS_BATCHES');
    });

    it('allows the delete once the last batch is gone', () => {
      const drained = { ...snapshot, batches: snapshot.batches.filter((batch) => batch.foodTypeId !== EGG) };

      expect(valueOf(foodTypeDeleteDecider(EGG, drained)).ops.at(-1)).toEqual({ kind: 'deleteFoodType', id: EGG });
    });
  });

  describe('FOOD_TYPE_NOT_FOUND', () => {
    it('refuses an id that is not a Food Type', () => {
      expect(errorOf(foodTypeDeleteDecider(999, snapshot)).code).toBe('FOOD_TYPE_NOT_FOUND');
    });

    it('does not take a recipe or a batch for a Food Type', () => {
      expect(errorOf(foodTypeDeleteDecider(GRATIN, snapshot)).code).toBe('FOOD_TYPE_NOT_FOUND');
      expect(errorOf(foodTypeDeleteDecider(40, snapshot)).code).toBe('FOOD_TYPE_NOT_FOUND');
    });
  });

  it('never edits the snapshot it is given', () => {
    const before = structuredClone(snapshot);

    foodTypeDeleteDecider(MILK, snapshot);
    foodTypeDeleteDecider(EGG, snapshot);
    foodTypeDeleteDecider(999, snapshot);

    expect(snapshot).toEqual(before);
  });
});
