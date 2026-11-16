import { describe, expect, expectTypeOf, it } from 'vitest';
import { ERROR_FAMILIES, ERROR_FAMILY_OF, HTTP_STATUS_BY_CODE, HTTP_STATUS_BY_FAMILY } from './index';
import type { DomainError, ErrorCode, ErrorCodeOf, ErrorFamily } from './index';

const codes = Object.keys(ERROR_FAMILY_OF) as ErrorCode[];

/** The 13 codes whose status is not the default of their family: twelve server faults answer 500 and an oversized body answers 413. */
const SERVER_FAULTS: readonly ErrorCode[] = [
  'CORRUPT_STORE',
  'SCHEMA_MISMATCH',
  'BAD_SEED',
  'DUP_SEED_KEY',
  'SEED_BAD_CATEGORY',
  'SEED_BAD_FOODTYPE',
  'CONFLICTING_OPS',
  'UNKNOWN_TARGET',
  'INVARIANT_BROKEN',
  'INSUFFICIENT_STOCK',
  'STORE_WRITE_FAILED',
  'SEED_UNREADABLE',
];

describe('errors', () => {
  it('lists 58 codes in five families', () => {
    const countOf = (family: ErrorFamily): number => codes.filter((code) => ERROR_FAMILY_OF[code] === family).length;

    expect(codes).toHaveLength(58);
    expect(new Set(codes).size).toBe(58);
    expect(codes.every((code) => /^[A-Z]+(_[A-Z]+)*$/.test(code))).toBe(true);
    expect(ERROR_FAMILIES).toEqual(['shape', 'validation', 'rules', 'io', 'form']);
    expect({
      shape: countOf('shape'),
      validation: countOf('validation'),
      rules: countOf('rules'),
      io: countOf('io'),
      form: countOf('form'),
    }).toEqual({ shape: 13, validation: 12, rules: 17, io: 10, form: 6 });
  });

  it('derives every code type from the one table', () => {
    expectTypeOf<ErrorCode>().toEqualTypeOf<keyof typeof ERROR_FAMILY_OF>();
    expectTypeOf<ErrorFamily>().toEqualTypeOf<'shape' | 'validation' | 'rules' | 'io' | 'form'>();
    expectTypeOf<ErrorCodeOf<'form'>>().toEqualTypeOf<
      'FIELD_REQUIRED' | 'QTY_FORMAT' | 'QTY_DECIMALS' | 'INT_FORMAT' | 'DATE_FORMAT' | 'CHOICE_UNKNOWN'
    >();
    expectTypeOf<DomainError>().toEqualTypeOf<{ readonly code: ErrorCode; readonly detail?: string }>();

    const failure: DomainError = { code: 'HAS_BATCHES', detail: '3 batches' };
    expect(ERROR_FAMILY_OF[failure.code]).toBe('rules');
  });

  it('gives every code an HTTP status', () => {
    const covered = Object.keys(HTTP_STATUS_BY_CODE).sort();
    const statuses = new Set<number>(Object.values(HTTP_STATUS_BY_CODE));

    expect(covered).toEqual([...codes].sort());
    expect([...statuses].sort()).toEqual([400, 409, 413, 422, 500, 503]);
  });

  it('answers with the default of the family, except for 13 codes', () => {
    const different = codes.filter((code) => HTTP_STATUS_BY_CODE[code] !== HTTP_STATUS_BY_FAMILY[ERROR_FAMILY_OF[code]]);

    expect(different.sort()).toEqual([...SERVER_FAULTS, 'PAYLOAD_TOO_LARGE'].sort());
    expect(different).toHaveLength(13);
    for (const code of SERVER_FAULTS) expect(HTTP_STATUS_BY_CODE[code]).toBe(500);
    expect(HTTP_STATUS_BY_CODE.PAYLOAD_TOO_LARGE).toBe(413);
    // a missing record is 409, not 404: the routes are fixed RPC endpoints
    expect(HTTP_STATUS_BY_CODE.BATCH_NOT_FOUND).toBe(409);
    expect(HTTP_STATUS_BY_CODE.CAP_EXCEEDED).toBe(422);
    expect(HTTP_STATUS_BY_CODE.BAD_ENVELOPE).toBe(400);
    expect(HTTP_STATUS_BY_CODE.STORE_UNAVAILABLE).toBe(503);
  });

  it('keeps the family list and the family defaults that the phase 0 starter exported', () => {
    expect(ERROR_FAMILIES).toContain('rules');
    expect(HTTP_STATUS_BY_FAMILY).toEqual({ shape: 400, validation: 422, rules: 409, io: 503, form: 400 });
  });
});
