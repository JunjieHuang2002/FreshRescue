import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result, ValidQty, ValidThreshold, ValidUnit } from '@freshrescue/contract-primitives';
import { LIMITS, UNIT_LIST } from '@freshrescue/contract-rules';
import { scalarValidator } from './scalarValidator';

const codeOf = (result: Result<unknown, DomainError>): string => (result.ok ? 'ok' : result.err.code);

describe('BC-04 ScalarValidator', () => {
  it('gives each kind its own validated type', () => {
    expectTypeOf(scalarValidator('qty', 1500)).toEqualTypeOf<Result<ValidQty, DomainError>>();
    expectTypeOf(scalarValidator('unit', 'kg')).toEqualTypeOf<Result<ValidUnit, DomainError>>();
    expectTypeOf(scalarValidator('thresholdDays', 3)).toEqualTypeOf<Result<ValidThreshold, DomainError>>();
    expect(scalarValidator('qty', 1500)).toEqual({ ok: true, value: 1500 });
  });

  describe('qty', () => {
    it('accepts a whole number of thousandths from 1 (0.001) to 500,000,000 (500,000), both ends included', () => {
      for (const milli of [1, 2, 1500, 300_000, 499_999_999, 500_000_000]) {
        expect(scalarValidator('qty', milli)).toEqual({ ok: true, value: milli });
      }
      expect(LIMITS.QTY_MIN_MILLI).toBe(1);
      expect(LIMITS.QTY_MAX_MILLI).toBe(500_000_000);
    });

    it('answers QTY_NOT_INTEGER for a fraction of a thousandth, which is more than 3 decimals, and never rounds', () => {
      for (const raw of [0.5, 1.5, 1500.0001, 0.0005]) {
        expect(codeOf(scalarValidator('qty', raw))).toBe('QTY_NOT_INTEGER');
      }
    });

    it('answers QTY_NOT_INTEGER for a value that is not a number at all', () => {
      for (const raw of ['5', '1.5', '', null, undefined, true, [], {}, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(codeOf(scalarValidator('qty', raw))).toBe('QTY_NOT_INTEGER');
      }
    });

    it('answers QTY_NOT_POSITIVE for zero and for negative numbers (spec section 3: block zero and negative)', () => {
      for (const raw of [0, -0, -1, -1500, -500_000_000]) {
        expect(codeOf(scalarValidator('qty', raw))).toBe('QTY_NOT_POSITIVE');
      }
    });

    it('answers QTY_TOO_LARGE above 500,000', () => {
      for (const raw of [500_000_001, 600_000_000, 1e12, 1e20]) {
        expect(codeOf(scalarValidator('qty', raw))).toBe('QTY_TOO_LARGE');
      }
    });

    it('checks whole number, then positive, then size', () => {
      expect(codeOf(scalarValidator('qty', -0.5))).toBe('QTY_NOT_INTEGER');
      expect(codeOf(scalarValidator('qty', 500_000_000.5))).toBe('QTY_NOT_INTEGER');
    });
  });

  describe('unit', () => {
    it('accepts each of the six units', () => {
      expect([...UNIT_LIST]).toEqual(['grams', 'kg', 'ml', 'liters', 'pieces', 'cartons']);
      for (const unit of UNIT_LIST) expect(scalarValidator('unit', unit)).toEqual({ ok: true, value: unit });
    });

    it('answers UNIT_UNKNOWN for anything else: units match by exact equality (spec section 3)', () => {
      for (const raw of ['KG', 'Kg', ' kg', 'kg ', 'gram', 'cups', 'g', '', 'kg,ml']) {
        expect(codeOf(scalarValidator('unit', raw))).toBe('UNIT_UNKNOWN');
      }
    });

    it('answers UNIT_UNKNOWN for a missing unit: a new Food Type needs one, and null is not a unit', () => {
      for (const raw of [null, undefined, 5, true, {}, ['kg']]) {
        expect(codeOf(scalarValidator('unit', raw))).toBe('UNIT_UNKNOWN');
      }
    });

    it('names the units that exist, so the message can help', () => {
      const result = scalarValidator('unit', 'cups');

      expect(result.ok ? '' : result.err.detail).toContain('cartons');
    });
  });

  describe('thresholdDays', () => {
    it('accepts a whole number of days of at least 1 (spec section 3)', () => {
      for (const days of [1, 2, 3, 7, 30, 365]) expect(scalarValidator('thresholdDays', days)).toEqual({ ok: true, value: days });
    });

    it('answers THRESHOLD_INVALID for zero, negative, fractional and non-numeric values', () => {
      for (const raw of [0, -1, -3, 0.5, 1.5, 2.999, '3', '', null, undefined, true, {}, Number.NaN, Number.POSITIVE_INFINITY, 1e20]) {
        expect(codeOf(scalarValidator('thresholdDays', raw))).toBe('THRESHOLD_INVALID');
      }
    });
  });

  it('gives the same answer twice and never throws, whatever it is given', () => {
    const odd: unknown[] = [Symbol('x'), () => 1, new Date(0), BigInt(5), Object.create(null), [[]], '😀'];
    for (const kind of ['qty', 'unit', 'thresholdDays'] as const) {
      for (const raw of odd) {
        const first = scalarValidator(kind as 'qty', raw);
        expect(first.ok).toBe(false);
        expect(scalarValidator(kind as 'qty', raw)).toEqual(first);
      }
    }
  });
});
