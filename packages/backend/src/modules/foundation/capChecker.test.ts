import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import type { QtyMilli, Result, ValidQty } from '@freshrescue/contract-primitives';
import { LIMITS } from '@freshrescue/contract-rules';
import { buildBatch, buildFoodType, buildSnapshot } from '../../testing/fixtures';
import { capChecker } from './capChecker';
import type { CapChange } from './capChecker';

const CAP = 500_000_000;
const qty = (milli: number): ValidQty => milli as ValidQty;
const codeOf = (result: Result<unknown, DomainError>): string => (result.ok ? 'ok' : result.err.code);
const totalOf = (result: Result<QtyMilli, DomainError>): number | undefined => (result.ok ? result.value : undefined);

/** Chicken (id 10) holds 300,000 + 150,000 = 450,000, and an Expired batch of 40,000 that still counts: 490,000 in all. Milk (id 11) is another Food Type. */
const snapshot = buildSnapshot({
  foodTypes: [buildFoodType({ id: 10, name: 'Chicken' }), buildFoodType({ id: 11, name: 'Milk', unit: 'ml' })],
  batches: [
    buildBatch({ id: 20, foodTypeId: 10, quantity: 300_000_000 }),
    buildBatch({ id: 21, foodTypeId: 10, quantity: 150_000_000 }),
    buildBatch({ id: 22, foodTypeId: 10, quantity: 40_000_000, expirationDate: '2026-09-01' }),
    buildBatch({ id: 23, foodTypeId: 11, quantity: 499_000_000 }),
  ],
});

describe('BC-06 CapChecker', () => {
  it('uses the cap of the spec: 500,000, which is 500,000,000 thousandths', () => {
    expect(LIMITS.CAP_MILLI).toBe(CAP);
  });

  describe('add: the post-change total is the existing sum plus the new quantity', () => {
    it('returns that total', () => {
      expect(capChecker(snapshot, { kind: 'add', foodTypeId: 10, qty: qty(5_000_000) })).toEqual({ ok: true, value: 495_000_000 });
    });

    it('counts Expired batches, which keep counting until they are removed (spec 4.2.3)', () => {
      // 300,000 + 150,000 is 450,000: the Expired 40,000 is what makes 490,000
      expect(totalOf(capChecker(snapshot, { kind: 'add', foodTypeId: 10, qty: qty(1) }))).toBe(490_000_001);
      expect(codeOf(capChecker(snapshot, { kind: 'add', foodTypeId: 10, qty: qty(10_000_001) }))).toBe('CAP_EXCEEDED');
    });

    it('allows a total of exactly 500,000 and never more (the spec example for the cap)', () => {
      expect(capChecker(snapshot, { kind: 'add', foodTypeId: 10, qty: qty(10_000_000) })).toEqual({ ok: true, value: CAP });
      expect(codeOf(capChecker(snapshot, { kind: 'add', foodTypeId: 10, qty: qty(10_000_001) }))).toBe('CAP_EXCEEDED');
    });

    it('answers CAP_EXCEEDED and says what the total would have been', () => {
      const result = capChecker(snapshot, { kind: 'add', foodTypeId: 10, qty: qty(20_000_000) });

      expect(result).toMatchObject({ ok: false, err: { code: 'CAP_EXCEEDED' } });
      expect(result.ok ? '' : result.err.detail).toContain('510000');
    });

    it('counts only the batches of the Food Type, not those of any other', () => {
      // Milk is already at 499,000; Chicken is unaffected by it
      expect(totalOf(capChecker(snapshot, { kind: 'add', foodTypeId: 11, qty: qty(1_000_000) }))).toBe(CAP);
      expect(codeOf(capChecker(snapshot, { kind: 'add', foodTypeId: 11, qty: qty(1_000_001) }))).toBe('CAP_EXCEEDED');
    });

    it('takes a Food Type with no batch, and one that does not exist yet (the inbound of a new Food Type), as an empty sum', () => {
      expect(capChecker(snapshot, { kind: 'add', foodTypeId: 999, qty: qty(1500) })).toEqual({ ok: true, value: 1500 });
      expect(capChecker(snapshot, { kind: 'add', foodTypeId: 999, qty: qty(CAP) })).toEqual({ ok: true, value: CAP });
      expect(codeOf(capChecker(snapshot, { kind: 'add', foodTypeId: 999, qty: qty(CAP + 1) }))).toBe('CAP_EXCEEDED');
    });

    it('counts every unit alike: the cap is on the number and there is no conversion', () => {
      // Milk is in ml and Chicken in grams; both stop at 500,000
      expect(codeOf(capChecker(snapshot, { kind: 'add', foodTypeId: 11, qty: qty(2_000_000) }))).toBe('CAP_EXCEEDED');
    });
  });

  describe('edit: existing sum, minus the edited batch\'s old quantity, plus its new quantity', () => {
    it('returns that total', () => {
      // batch 20 goes from 300,000 to 310,000: 490,000 - 300,000 + 310,000
      expect(capChecker(snapshot, { kind: 'edit', batchId: 20, qty: qty(310_000_000) })).toEqual({ ok: true, value: 500_000_000 });
    });

    it('does not count the edited batch twice: setting a quantity to what it already is changes nothing', () => {
      // "existing sum + new quantity" would be 490,000 + 300,000 = 790,000 and wrongly block it
      expect(capChecker(snapshot, { kind: 'edit', batchId: 20, qty: qty(300_000_000) })).toEqual({ ok: true, value: 490_000_000 });
    });

    it('allows an edit to a total of exactly 500,000 and blocks one thousandth more', () => {
      expect(totalOf(capChecker(snapshot, { kind: 'edit', batchId: 21, qty: qty(160_000_000) }))).toBe(CAP);
      expect(codeOf(capChecker(snapshot, { kind: 'edit', batchId: 21, qty: qty(160_000_001) }))).toBe('CAP_EXCEEDED');
    });

    it('allows a smaller quantity, which is how a partial outbound is recorded', () => {
      expect(totalOf(capChecker(snapshot, { kind: 'edit', batchId: 20, qty: qty(1) }))).toBe(190_000_001);
    });

    it('counts the batches of the same Food Type only, Expired ones included', () => {
      // editing the Expired batch 22 up to 100,000 makes 300,000 + 150,000 + 100,000 = 550,000
      expect(codeOf(capChecker(snapshot, { kind: 'edit', batchId: 22, qty: qty(100_000_000) }))).toBe('CAP_EXCEEDED');
      expect(totalOf(capChecker(snapshot, { kind: 'edit', batchId: 22, qty: qty(50_000_000) }))).toBe(500_000_000);
    });

    it('answers BATCH_NOT_FOUND for a batch that does not exist', () => {
      expect(capChecker(snapshot, { kind: 'edit', batchId: 999, qty: qty(1000) })).toMatchObject({
        ok: false,
        err: { code: 'BATCH_NOT_FOUND' },
      });
      expect(codeOf(capChecker(snapshot, { kind: 'edit', batchId: 10, qty: qty(1000) }))).toBe('BATCH_NOT_FOUND');
    });
  });

  describe('convert: the sum of the new quantities of the conversion modal', () => {
    it('returns that sum and ignores the old quantities, which are in another unit', () => {
      // Chicken goes from grams to pieces: the 490,000 grams no longer matter
      const change: CapChange = {
        kind: 'convert',
        foodTypeId: 10,
        rows: [
          { batchId: 20, qty: qty(500) },
          { batchId: 21, qty: qty(250) },
          { batchId: 22, qty: qty(80) },
        ],
      };

      expect(capChecker(snapshot, change)).toEqual({ ok: true, value: 830 });
    });

    it('gives the spec example: batches of 100 g and 200 g converted to 0.5 and 1 piece', () => {
      const small = buildSnapshot({
        foodTypes: [buildFoodType({ id: 10, name: 'Chicken' })],
        batches: [buildBatch({ id: 20, foodTypeId: 10, quantity: 100_000 }), buildBatch({ id: 21, foodTypeId: 10, quantity: 200_000 })],
      });

      expect(
        capChecker(small, { kind: 'convert', foodTypeId: 10, rows: [{ batchId: 20, qty: qty(500) }, { batchId: 21, qty: qty(1000) }] }),
      ).toEqual({ ok: true, value: 1500 });
    });

    it('allows a total of exactly 500,000 and answers CAP_EXCEEDED above it', () => {
      const rows = (second: number) => [{ batchId: 20, qty: qty(400_000_000) }, { batchId: 21, qty: qty(second) }];

      expect(totalOf(capChecker(snapshot, { kind: 'convert', foodTypeId: 10, rows: rows(100_000_000) }))).toBe(CAP);
      expect(codeOf(capChecker(snapshot, { kind: 'convert', foodTypeId: 10, rows: rows(100_000_001) }))).toBe('CAP_EXCEEDED');
    });

    it('can block a conversion even though the Food Type is well below the cap now', () => {
      const small = buildSnapshot({
        foodTypes: [buildFoodType({ id: 10, name: 'Chicken' })],
        batches: [buildBatch({ id: 20, foodTypeId: 10, quantity: 1000 })],
      });

      expect(codeOf(capChecker(small, { kind: 'convert', foodTypeId: 10, rows: [{ batchId: 20, qty: qty(CAP + 1) }] }))).toBe('CAP_EXCEEDED');
    });

    it('takes no rows as a total of 0, which is a Food Type with no batches that changes only its unit', () => {
      expect(capChecker(snapshot, { kind: 'convert', foodTypeId: 10, rows: [] })).toEqual({ ok: true, value: 0 });
    });
  });

  it('returns the typed total as a value and leaves the snapshot alone', () => {
    const before = JSON.stringify(snapshot);

    expectTypeOf(capChecker).returns.toEqualTypeOf<Result<QtyMilli, DomainError>>();
    capChecker(snapshot, { kind: 'add', foodTypeId: 10, qty: qty(1) });
    capChecker(snapshot, { kind: 'edit', batchId: 20, qty: qty(1) });

    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
