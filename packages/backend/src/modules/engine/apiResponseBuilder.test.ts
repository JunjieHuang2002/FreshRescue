import { describe, expect, it } from 'vitest';
import { ERROR_FAMILY_OF, HTTP_STATUS_BY_CODE } from '@freshrescue/contract-errors';
import type { ErrorCode } from '@freshrescue/contract-errors';
import { apiResponseBuilder } from './apiResponseBuilder';

const CODES = Object.keys(ERROR_FAMILY_OF) as ErrorCode[];

describe('BC-44 ApiResponseBuilder', () => {
  it('answers a success with 200, the payload as data, and the date the request was derived for', () => {
    expect(apiResponseBuilder({ ok: true, value: { payload: { categoryId: 7 }, today: '2026-10-04' } })).toEqual({
      status: 200,
      response: { ok: true, data: { categoryId: 7 }, meta: { today: '2026-10-04' } },
    });
  });

  it('sends {} for a command with nothing to answer with', () => {
    expect(apiResponseBuilder({ ok: true, value: { payload: undefined, today: '2026-10-04' } }).response).toEqual({
      ok: true,
      data: {},
      meta: { today: '2026-10-04' },
    });
  });

  it('passes a read model through as it is', () => {
    const dto = { nearExpiry: [], expired: [] };

    expect(apiResponseBuilder({ ok: true, value: { payload: dto, today: '2026-10-04' } }).response).toMatchObject({ ok: true, data: dto });
  });

  describe('a failure', () => {
    it('has 58 codes to answer', () => {
      expect(CODES).toHaveLength(58);
    });

    it.each(CODES)('answers %s with the status of the errors contract, its family, and no date', (code) => {
      expect(apiResponseBuilder({ ok: false, err: { code, detail: 'why' } })).toEqual({
        status: HTTP_STATUS_BY_CODE[code],
        response: { ok: false, error: { code, detail: 'why', family: ERROR_FAMILY_OF[code] }, meta: { today: null } },
      });
    });

    it('uses the family defaults: 400 for shape, 422 for validation, 409 for rules, 503 for io', () => {
      const status = (code: ErrorCode) => apiResponseBuilder({ ok: false, err: { code } }).status;

      expect([status('BAD_ENVELOPE'), status('MISSING_FIELD'), status('DATE_INVALID')]).toEqual([400, 400, 400]);
      expect([status('NAME_EMPTY'), status('PAST_EXPIRY'), status('CAP_EXCEEDED')]).toEqual([422, 422, 422]);
      expect([status('CATEGORY_NOT_FOUND'), status('HAS_BATCHES'), status('RECIPE_NOT_FOUND')]).toEqual([409, 409, 409]);
      expect(status('STORE_UNAVAILABLE')).toBe(503);
    });

    it('answers the 13 exceptions of the table: 500 for a fault of the server, 413 for an oversized body', () => {
      const serverFaults: ErrorCode[] = [
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

      expect(serverFaults.map((code) => apiResponseBuilder({ ok: false, err: { code } }).status)).toEqual(Array(12).fill(500));
      expect(apiResponseBuilder({ ok: false, err: { code: 'PAYLOAD_TOO_LARGE' } }).status).toBe(413);
    });

    it('carries the detail when there is one, and leaves it out when there is none', () => {
      const withDetail = apiResponseBuilder({ ok: false, err: { code: 'INVARIANT_BROKEN', detail: '1 of 23 rules broken. [cap] ...' } });
      const without = apiResponseBuilder({ ok: false, err: { code: 'NAME_EMPTY' } });

      expect(withDetail.response).toMatchObject({ ok: false, error: { code: 'INVARIANT_BROKEN', family: 'rules', detail: '1 of 23 rules broken. [cap] ...' } });
      expect(without.response).toEqual({ ok: false, error: { code: 'NAME_EMPTY', family: 'validation' }, meta: { today: null } });
      expect(Object.keys(without.response.ok ? {} : without.response.error)).toEqual(['code', 'family']);
    });

    it('sets meta.today to null on every failure, because a failed result carries no date', () => {
      for (const code of CODES) {
        expect(apiResponseBuilder({ ok: false, err: { code } }).response.meta.today).toBeNull();
      }
    });
  });

  it('builds a reply that survives being sent as JSON', () => {
    const reply = apiResponseBuilder({ ok: true, value: { payload: undefined, today: '2026-10-04' } });

    expect(JSON.parse(JSON.stringify(reply.response))).toEqual({ ok: true, data: {}, meta: { today: '2026-10-04' } });
  });
});
