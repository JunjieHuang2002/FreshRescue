import { describe, expect, expectTypeOf, it } from 'vitest';
import { ERROR_FAMILY_OF } from '@freshrescue/contract-errors';
import type { DomainError } from '@freshrescue/contract-errors';
import { QUERY_TYPES } from '@freshrescue/contract-messages';
import type { Query, QueryParams, QueryType } from '@freshrescue/contract-messages';
import type { Result } from '@freshrescue/contract-primitives';
import { queryParser } from './queryParser';

/** One valid params object for each query. `satisfies` makes a query without a sample a compile error. */
const VALID = {
  GetReferenceData: {},
  GetInventoryList: {},
  GetFoodTypeDetail: { foodTypeId: 10 },
  GetWarningPanel: {},
  GetRecommendations: {},
  GetCatalog: { cuisineId: 5 },
} satisfies { [T in QueryType]: QueryParams[T] };

const body = (type: string, params: unknown): string => JSON.stringify({ type, params });
const parse = (type: string, params: unknown): Result<Query, DomainError> => queryParser(body(type, params));
const codeOf = (result: Result<unknown, DomainError>): string => (result.ok ? 'ok' : result.err.code);
const detailOf = (result: Result<unknown, DomainError>): string => (result.ok ? '' : (result.err.detail ?? ''));

describe('BP-02 QueryParser', () => {
  describe('a valid query', () => {
    it('has a sample here for each of the 6 queries, and no other', () => {
      expect(Object.keys(VALID).sort()).toEqual([...QUERY_TYPES].sort());
      expect(QUERY_TYPES).toHaveLength(6);
    });

    it.each(QUERY_TYPES)('%s parses into the typed query', (type) => {
      expect(parse(type, VALID[type])).toEqual({ ok: true, value: { type, params: VALID[type] } });
    });

    it('returns a Result of a Query', () => {
      expectTypeOf(queryParser).parameters.toEqualTypeOf<[string]>();
      expectTypeOf(queryParser).returns.toEqualTypeOf<Result<Query, DomainError>>();
    });

    it('takes null for the cuisine of the catalog, which lists every recipe', () => {
      expect(parse('GetCatalog', { cuisineId: null })).toEqual({ ok: true, value: { type: 'GetCatalog', params: { cuisineId: null } } });
    });

    it('drops params that a query does not have, so a query with none comes out with {}', () => {
      expect(parse('GetInventoryList', { limit: 5, order: 'desc' })).toEqual({ ok: true, value: { type: 'GetInventoryList', params: {} } });
      expect(parse('GetFoodTypeDetail', { foodTypeId: 10, include: 'batches' })).toEqual({ ok: true, value: { type: 'GetFoodTypeDetail', params: { foodTypeId: 10 } } });
      expect(queryParser(JSON.stringify({ type: 'GetWarningPanel', params: {}, trace: 'x' }))).toEqual({ ok: true, value: { type: 'GetWarningPanel', params: {} } });
    });
  });

  describe('BAD_ENVELOPE', () => {
    it('answers it for a body that is not JSON', () => {
      for (const text of ['', ' ', 'not json', '{', '{"type":', "{'type': 'GetCatalog'}", 'undefined']) {
        expect(queryParser(text)).toMatchObject({ ok: false, err: { code: 'BAD_ENVELOPE' } });
      }
    });

    it('answers it for JSON that is not an object', () => {
      for (const text of ['[]', '[1]', '"GetCatalog"', 'null', '7', 'false']) {
        expect(queryParser(text)).toMatchObject({ ok: false, err: { code: 'BAD_ENVELOPE' } });
      }
    });

    it('answers it for an object whose type is missing or is not text', () => {
      for (const text of ['{}', '{"params":{}}', '{"type":5,"params":{}}', '{"type":null,"params":{}}', '{"type":"","params":{}}', '{"type":["GetCatalog"],"params":{}}']) {
        expect(queryParser(text)).toMatchObject({ ok: false, err: { code: 'BAD_ENVELOPE' } });
      }
    });

    it('names the body in the detail', () => {
      expect(detailOf(queryParser('[]'))).toContain('body');
    });
  });

  describe('UNKNOWN_QUERY', () => {
    it('answers it for a type that is text but is not a query', () => {
      for (const type of ['Nope', 'getCatalog', 'GETCATALOG', ' GetCatalog', 'GetCatalog ', 'Get Catalog', 'constructor', '__proto__', 'toString']) {
        expect(parse(type, {})).toMatchObject({ ok: false, err: { code: 'UNKNOWN_QUERY' } });
      }
    });

    it('answers it for a command sent to the query parser, and names the type', () => {
      const result = parse('RemoveBatch', { batchId: 1 });

      expect(codeOf(result)).toBe('UNKNOWN_QUERY');
      expect(detailOf(result)).toContain('RemoveBatch');
    });

    it('names the unknown type before it looks at the params', () => {
      expect(queryParser('{"type":"Nope"}')).toMatchObject({ ok: false, err: { code: 'UNKNOWN_QUERY' } });
    });
  });

  describe('MISSING_FIELD', () => {
    it('answers it for every query when the params are not there, those that take none included', () => {
      for (const type of QUERY_TYPES) {
        const result = queryParser(`{"type":"${type}"}`);
        expect(codeOf(result), type).toBe('MISSING_FIELD');
        expect(detailOf(result)).toContain('params');
      }
    });

    it('answers it for the id of a Food Type that is left out, and names it', () => {
      const result = parse('GetFoodTypeDetail', {});

      expect(codeOf(result)).toBe('MISSING_FIELD');
      expect(detailOf(result)).toContain('foodTypeId');
    });

    it('answers it for a cuisine that is left out: null is the way to say all, so the field is always present', () => {
      expect(codeOf(parse('GetCatalog', {}))).toBe('MISSING_FIELD');
      expect(detailOf(parse('GetCatalog', {}))).toContain('cuisineId');
      expect(codeOf(parse('GetCatalog', { cuisineId: null }))).toBe('ok');
    });
  });

  describe('WRONG_TYPE', () => {
    it('answers it for params that are not an object', () => {
      for (const params of ['text', 5, true, [], [{ foodTypeId: 1 }], null]) {
        for (const type of QUERY_TYPES) expect(codeOf(parse(type, params)), `${type} with ${JSON.stringify(params)}`).toBe('WRONG_TYPE');
      }
    });

    it('answers it for an id that is a text, zero, negative, fractional or not finite: there is no conversion', () => {
      for (const id of ['10', '', 0, -1, 2.5, null, true, {}, [10]]) {
        expect(codeOf(parse('GetFoodTypeDetail', { foodTypeId: id })), JSON.stringify(id)).toBe('WRONG_TYPE');
      }
    });

    it('answers it for an id beyond what a number can hold, written as JSON text, because JSON.stringify cannot write one', () => {
      for (const digits of ['1e400', '1e999', '9007199254740993', '9'.repeat(400)]) {
        expect(queryParser(`{"type":"GetFoodTypeDetail","params":{"foodTypeId":${digits}}}`), digits.slice(0, 20)).toMatchObject({ ok: false, err: { code: 'WRONG_TYPE' } });
      }
    });

    it('answers it for a cuisine that is not null and is not an id', () => {
      for (const id of ['5', '', 0, -3, 0.5, true, {}, []]) {
        expect(codeOf(parse('GetCatalog', { cuisineId: id })), JSON.stringify(id)).toBe('WRONG_TYPE');
      }
    });

    it('names the field in the detail, with its path', () => {
      expect(detailOf(parse('GetFoodTypeDetail', { foodTypeId: 'x' }))).toContain('params.foodTypeId');
    });
  });

  describe('every error is a shape error from the catalog, and nothing is thrown', () => {
    const awkward = [
      '', '{', '[', 'null', '0',
      '{"type":"GetCatalog","params":',
      '{"type":"GetFoodTypeDetail","params":{"foodTypeId":9007199254740993}}',
      '{"type":"GetFoodTypeDetail","params":{"foodTypeId":1e999}}',
      '{"type":"GetFoodTypeDetail","params":{"foodTypeId":-0}}',
      '{"type":"GetCatalog","params":{"cuisineId":1},"params":{"cuisineId":"x"}}',
      '{"__proto__":{"type":"GetCatalog"}}',
      '{"type":"GetCatalog","params":{"cuisineId":1,"__proto__":{"admin":true}}}',
      `${'['.repeat(100_000)}${']'.repeat(100_000)}`,
    ];

    it('gives a Result for each body: a query, or a code of the shape family', () => {
      for (const text of awkward) {
        let result: Result<Query, DomainError> | undefined;
        expect(() => {
          result = queryParser(text);
        }, text.slice(0, 60)).not.toThrow();
        if (result?.ok === false) expect(ERROR_FAMILY_OF[result.err.code]).toBe('shape');
        expect(result?.ok).not.toBeUndefined();
      }
    });

    it('gives only the codes this parser owns, whatever the fault', () => {
      const owned = new Set(['BAD_ENVELOPE', 'UNKNOWN_QUERY', 'MISSING_FIELD', 'WRONG_TYPE']);

      for (const text of awkward) {
        const result = queryParser(text);
        if (!result.ok) expect(owned.has(result.err.code), result.err.code).toBe(true);
      }
    });

    it('does not let a key named like a property of every object through', () => {
      const result = queryParser('{"type":"GetCatalog","params":{"cuisineId":1,"__proto__":{"admin":true}}}');

      expect(result).toEqual({ ok: true, value: { type: 'GetCatalog', params: { cuisineId: 1 } } });
      expect(({} as Record<string, unknown>).admin).toBeUndefined();
    });
  });

  it('gives the same answer twice and keeps no state between bodies', () => {
    expect(parse('GetFoodTypeDetail', { foodTypeId: 'x' })).toEqual(parse('GetFoodTypeDetail', { foodTypeId: 'x' }));
    expect(parse('GetFoodTypeDetail', { foodTypeId: 3 }).ok).toBe(true);
    expect(parse('GetFoodTypeDetail', { foodTypeId: 'x' }).ok).toBe(false);
  });
});
