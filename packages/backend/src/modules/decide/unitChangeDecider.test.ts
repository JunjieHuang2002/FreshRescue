import { describe, expect, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Id, Result, ValidQty, ValidUnit } from '@freshrescue/contract-primitives';
import { buildBatch, buildFoodType, buildIngredient, buildRecipe, buildSnapshot } from '../../testing/fixtures';
import { recipeErrorEvaluator } from '../derive/recipeErrorEvaluator';
import { snapshotInvariantChecker } from '../engine/snapshotInvariantChecker';
import { changeSetApplier } from '../state/changeSetApplier';
import { unitChangeDecider } from './unitChangeDecider';

const unit = (text: string): ValidUnit => text as ValidUnit;
const row = (batchId: Id, milli: number): { readonly batchId: Id; readonly qty: ValidQty } => ({ batchId, qty: milli as ValidQty });
const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

const [CHICKEN, RICE, EGG] = [30, 31, 32];

/**
 * Spec 4.2.2: Chicken (30) is in grams with batch 40 (100 g) and batch 41 (200 g). Batch 42 is a third batch of Chicken, Expired and
 * the only one with other dates. Rice (31) has a batch (43) and Egg (32) is in pieces with no batch. Recipe 50 needs 250 grams of Chicken.
 */
const snapshot = buildSnapshot({
  foodTypes: [
    buildFoodType({ id: CHICKEN, name: 'Chicken' }),
    buildFoodType({ id: RICE, name: 'Rice' }),
    buildFoodType({ id: EGG, name: 'Egg', unit: 'pieces' }),
  ],
  batches: [
    buildBatch({ id: 40, foodTypeId: CHICKEN, quantity: 100_000, createdSeq: 1 }),
    buildBatch({ id: 41, foodTypeId: CHICKEN, quantity: 200_000, createdSeq: 2, inboundDate: '2026-10-02', expirationDate: '2026-10-12' }),
    buildBatch({ id: 43, foodTypeId: RICE, quantity: 300_000, createdSeq: 3 }),
  ],
  recipes: [buildRecipe({ id: 50, name: 'Chicken Rice' })],
  recipeIngredients: [buildIngredient({ recipeId: 50, foodTypeId: CHICKEN, requiredQuantity: 250_000, requiredUnit: 'grams' })],
});

describe('BC-27 UnitChangeDecider', () => {
  describe('the worked example of spec 4.2.2: Chicken, 100 g and 200 g, to pieces with 0.5 and 1', () => {
    const changeSet = valueOf(unitChangeDecider(CHICKEN, unit('pieces'), [row(40, 500), row(41, 1000)], snapshot));

    it('is one ChangeSet that changes the unit and both quantities', () => {
      expect(changeSet).toEqual({
        ops: [
          { kind: 'putFoodType', row: { id: CHICKEN, name: 'Chicken', categoryId: 1, unit: 'pieces', customThresholdDays: null } },
          { kind: 'putBatch', row: { id: 40, foodTypeId: CHICKEN, quantity: 500, inboundDate: '2026-10-01', expirationDate: '2026-10-04', createdSeq: 1 } },
          { kind: 'putBatch', row: { id: 41, foodTypeId: CHICKEN, quantity: 1000, inboundDate: '2026-10-02', expirationDate: '2026-10-12', createdSeq: 2 } },
        ],
      });
    });

    it('leaves the expiration dates, the inbound dates and createdSeq as they were', () => {
      const next = valueOf(changeSetApplier(snapshot, changeSet));

      for (const batch of next.batches.filter((candidate) => candidate.foodTypeId === CHICKEN)) {
        const before = snapshot.batches.find((candidate) => candidate.id === batch.id);
        expect({ ...batch, quantity: 0 }).toEqual({ ...before, quantity: 0 });
      }
    });

    it('applies as a whole: the Food Type and both batches are in pieces, and the result is a legal state', () => {
      const next = valueOf(changeSetApplier(snapshot, changeSet));

      expect(next.foodTypes.find((foodType) => foodType.id === CHICKEN)?.unit).toBe('pieces');
      expect(next.batches.filter((batch) => batch.foodTypeId === CHICKEN).map((batch) => batch.quantity)).toEqual([500, 1000]);
      expect(snapshotInvariantChecker(next)).toEqual({ ok: true, value: next });
    });

    it('does not rewrite a recipe: it becomes a Unit Conflict by derivation (spec 4.2.2.4)', () => {
      const next = valueOf(changeSetApplier(snapshot, changeSet));

      expect(changeSet.ops.some((op) => op.kind === 'putRecipe' || op.kind === 'putIngredient')).toBe(false);
      expect(next.recipeIngredients).toEqual(snapshot.recipeIngredients);
      expect(recipeErrorEvaluator(snapshot)[50]).toBeUndefined();
      expect(recipeErrorEvaluator(next)[50]).toEqual([{ reason: 'unitConflict', foodTypeId: CHICKEN, requiredUnit: 'grams', foodTypeUnit: 'pieces' }]);
    });

    it('touches no batch of another Food Type', () => {
      expect(changeSet.ops.some((op) => op.kind === 'putBatch' && op.row.foodTypeId !== CHICKEN)).toBe(false);
    });
  });

  it('puts the batches in the order of the snapshot, whatever the order of the request', () => {
    const inOrder = valueOf(unitChangeDecider(CHICKEN, unit('pieces'), [row(40, 500), row(41, 1000)], snapshot));
    const reversed = valueOf(unitChangeDecider(CHICKEN, unit('pieces'), [row(41, 1000), row(40, 500)], snapshot));

    expect(reversed).toEqual(inOrder);
  });

  it('converts an Expired batch too: every batch is listed in the modal (spec 4.2.2.3)', () => {
    const withExpired = buildSnapshot({
      foodTypes: [buildFoodType({ id: CHICKEN, name: 'Chicken' })],
      batches: [
        buildBatch({ id: 40, foodTypeId: CHICKEN, quantity: 100_000, inboundDate: '2026-08-01', expirationDate: '2026-09-01', createdSeq: 1 }),
        buildBatch({ id: 41, foodTypeId: CHICKEN, quantity: 200_000, createdSeq: 2 }),
      ],
    });

    const { ops } = valueOf(unitChangeDecider(CHICKEN, unit('kg'), [row(40, 100), row(41, 200)], withExpired));

    expect(ops.flatMap((op) => (op.kind === 'putBatch' ? [[op.row.id, op.row.quantity, op.row.expirationDate]] : []))).toEqual([
      [40, 100, '2026-09-01'],
      [41, 200, '2026-10-04'],
    ]);
    expect(snapshotInvariantChecker(valueOf(changeSetApplier(withExpired, { ops }))).ok).toBe(true);
  });

  it('changes the unit at once when the Food Type has no batch, with an empty list of quantities', () => {
    expect(valueOf(unitChangeDecider(EGG, unit('cartons'), [], snapshot))).toEqual({
      ops: [{ kind: 'putFoodType', row: { id: EGG, name: 'Egg', categoryId: 1, unit: 'cartons', customThresholdDays: null } }],
    });
  });

  it('takes the new quantity of a batch as the quantity, and not as an amount to add', () => {
    const { ops } = valueOf(unitChangeDecider(CHICKEN, unit('kg'), [row(40, 7), row(41, 8)], snapshot));

    expect(ops.flatMap((op) => (op.kind === 'putBatch' ? [op.row.quantity] : []))).toEqual([7, 8]);
  });

  describe('FOOD_TYPE_NOT_FOUND', () => {
    it('refuses an id that is not a Food Type', () => {
      expect(errorOf(unitChangeDecider(999, unit('pieces'), [], snapshot)).code).toBe('FOOD_TYPE_NOT_FOUND');
    });

    it('is judged before the unit and the batches', () => {
      expect(errorOf(unitChangeDecider(999, unit('grams'), [row(1, 1)], snapshot)).code).toBe('FOOD_TYPE_NOT_FOUND');
    });
  });

  describe('UNIT_UNCHANGED', () => {
    it('refuses the unit that the Food Type already has, even with the right quantities', () => {
      const error = errorOf(unitChangeDecider(CHICKEN, unit('grams'), [row(40, 100_000), row(41, 200_000)], snapshot));

      expect(error.code).toBe('UNIT_UNCHANGED');
      expect(error.detail).toContain('grams');
    });

    it('refuses it for a Food Type with no batch as well', () => {
      expect(errorOf(unitChangeDecider(EGG, unit('pieces'), [], snapshot)).code).toBe('UNIT_UNCHANGED');
    });

    it('is judged before the batches: the same unit and a wrong list is UNIT_UNCHANGED', () => {
      expect(errorOf(unitChangeDecider(CHICKEN, unit('grams'), [row(40, 1)], snapshot)).code).toBe('UNIT_UNCHANGED');
    });
  });

  describe('BATCH_SET_MISMATCH: the quantities must name exactly the Food Type\'s batches (blueprint 3.2)', () => {
    const mismatch = (rows: readonly { readonly batchId: Id; readonly qty: ValidQty }[]): DomainError =>
      errorOf(unitChangeDecider(CHICKEN, unit('pieces'), rows, snapshot));

    it('refuses a request that leaves out a batch', () => {
      const error = mismatch([row(40, 500)]);

      expect(error.code).toBe('BATCH_SET_MISMATCH');
      expect(error.detail).toContain('40, 41');
    });

    it('refuses an empty request for a Food Type that has batches', () => {
      expect(mismatch([]).code).toBe('BATCH_SET_MISMATCH');
    });

    it('refuses a request with one batch too many: an id that is no batch', () => {
      expect(mismatch([row(40, 500), row(41, 1000), row(999, 1)]).code).toBe('BATCH_SET_MISMATCH');
    });

    it('refuses a batch of another Food Type, in place of one that was left out', () => {
      expect(mismatch([row(40, 500), row(43, 1000)]).code).toBe('BATCH_SET_MISMATCH');
    });

    it('refuses a batch that is named twice, whether or not another is left out', () => {
      expect(mismatch([row(40, 500), row(40, 600)]).code).toBe('BATCH_SET_MISMATCH');
      expect(mismatch([row(40, 500), row(41, 1000), row(41, 1000)]).code).toBe('BATCH_SET_MISMATCH');
    });

    it('refuses quantities for a Food Type that has no batch', () => {
      expect(errorOf(unitChangeDecider(EGG, unit('cartons'), [row(40, 1)], snapshot)).code).toBe('BATCH_SET_MISMATCH');
    });

    it('names the batches that were expected and the ones that were named', () => {
      expect(mismatch([row(43, 1)]).detail).toBe('the quantities must name exactly the batches of this Food Type (40, 41), and these name (43)');
      expect(errorOf(unitChangeDecider(EGG, unit('cartons'), [row(40, 1)], snapshot)).detail).toContain('(none)');
    });
  });

  it('never edits the snapshot it is given', () => {
    const before = structuredClone(snapshot);

    unitChangeDecider(CHICKEN, unit('pieces'), [row(40, 500), row(41, 1000)], snapshot);
    unitChangeDecider(CHICKEN, unit('grams'), [], snapshot);
    unitChangeDecider(CHICKEN, unit('pieces'), [row(40, 500)], snapshot);

    expect(snapshot).toEqual(before);
  });
});
