import { describe, expect, expectTypeOf, it } from 'vitest';
import { ERROR_FAMILY_OF, HTTP_STATUS_BY_CODE } from '@freshrescue/contract-errors';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import { COMMAND_TYPES, QUERY_TYPES } from '@freshrescue/contract-messages';
import type { MessageData, MessageType } from '@freshrescue/contract-messages';
import type { Result } from '@freshrescue/contract-primitives';
import { apiResponseParser } from './apiResponseParser';
import { CATALOG, COOK_REPORT, DETAIL, INVENTORY, RECOMMENDATIONS, RECOMMENDATIONS_NO_RESCUE, REFERENCE, WARNINGS } from '../../testing/fixtures';

// One reply of each of the 19 messages, typed by the contract, so the compiler checks that each
// sample is the data that its message promises.
const DATA: { readonly [K in MessageType]: MessageData[K] } = {
  SaveCategory: { categoryId: 9 },
  DeleteCategory: {},
  SetCategoryThreshold: {},
  SaveFoodType: { foodTypeId: 14 },
  ChangeFoodTypeUnit: {},
  DeleteFoodType: {},
  InboundBatch: {},
  EditBatchQuantity: {},
  RemoveBatch: {},
  SaveRecipe: { recipeId: 45 },
  DeleteRecipe: {},
  CookRecipes: COOK_REPORT,
  SetSimulatedToday: {},
  GetReferenceData: REFERENCE,
  GetInventoryList: INVENTORY,
  GetFoodTypeDetail: DETAIL,
  GetWarningPanel: WARNINGS,
  GetRecommendations: RECOMMENDATIONS,
  GetCatalog: CATALOG,
};

const MESSAGES: readonly MessageType[] = [...COMMAND_TYPES, ...QUERY_TYPES];

const reply = (data: unknown, today: unknown = '2026-10-02'): string => JSON.stringify({ ok: true, data, meta: { today } });

const failureReply = (code: string, detail?: string): string =>
  JSON.stringify({
    ok: false,
    error: { family: 'rules', code, ...(detail === undefined ? {} : { detail }) },
    meta: { today: null },
  });

const parse = <K extends MessageType>(status: number, bodyText: string, kind: K): Result<MessageData[K], DomainError> =>
  apiResponseParser({ status, bodyText }, kind);

const codeOf = (result: Result<unknown, DomainError>): string => (result.ok ? 'ok' : result.err.code);

/** A copy of a sample with the field at `path` replaced. */
function replaced(value: unknown, path: readonly (string | number)[], replacement: unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return replacement;
  if (Array.isArray(value)) return value.map((item: unknown, index) => (index === head ? replaced(item, rest, replacement) : item));
  const record = value as Record<string, unknown>;
  return { ...record, [head]: replaced(record[String(head)], rest, replacement) };
}

describe('FP-02 ApiResponseParser', () => {
  describe('a successful reply', () => {
    for (const kind of MESSAGES) {
      it(`gives the data of ${kind} as it came`, () => {
        expect(parse(200, reply(DATA[kind]), kind)).toEqual({ ok: true, value: DATA[kind] });
      });
    }

    it('covers all 19 messages', () => {
      expect(MESSAGES).toHaveLength(19);
      expect(Object.keys(DATA).sort()).toEqual([...MESSAGES].sort());
    });

    it('types the data by the message that was sent', () => {
      expectTypeOf(apiResponseParser({ status: 200, bodyText: '' }, 'GetCatalog')).toEqualTypeOf<Result<MessageData['GetCatalog'], DomainError>>();
      expectTypeOf(apiResponseParser({ status: 200, bodyText: '' }, 'SaveCategory')).toEqualTypeOf<Result<{ readonly categoryId: number }, DomainError>>();
    });

    it('accepts the data that a recommendation with an empty state carries', () => {
      expect(parse(200, reply(RECOMMENDATIONS_NO_RESCUE), 'GetRecommendations')).toEqual({ ok: true, value: RECOMMENDATIONS_NO_RESCUE });
    });
  });

  describe('a failure reply passes the backend DomainError through', () => {
    it('keeps the code and the detail', () => {
      expect(parse(409, failureReply('HAS_BATCHES', 'Remove all 3 batches first'), 'DeleteFoodType')).toEqual({
        ok: false,
        err: { code: 'HAS_BATCHES', detail: 'Remove all 3 batches first' },
      });
    });

    it('leaves the detail out when there is none', () => {
      expect(parse(422, failureReply('CAP_EXCEEDED'), 'InboundBatch')).toEqual({ ok: false, err: { code: 'CAP_EXCEEDED' } });
    });

    it('passes each of the 58 codes through with the status of the Phase 2 table', () => {
      const codes = Object.keys(ERROR_FAMILY_OF) as ErrorCode[];

      expect(codes).toHaveLength(58);
      for (const code of codes) {
        expect(parse(HTTP_STATUS_BY_CODE[code], failureReply(code), 'GetCatalog')).toEqual({ ok: false, err: { code } });
      }
    });

    it('does not read the detail when it is not text', () => {
      const body = JSON.stringify({ ok: false, error: { family: 'rules', code: 'HAS_BATCHES', detail: 3 }, meta: { today: null } });

      expect(parse(409, body, 'DeleteFoodType')).toEqual({ ok: false, err: { code: 'HAS_BATCHES' } });
    });
  });

  describe('BAD_JSON: a body that is not JSON', () => {
    it('is reported when the status is a success', () => {
      for (const body of ['<html>Hello</html>', '', 'undefined', '{"ok":', 'ok']) {
        expect(parse(200, body, 'GetCatalog')).toEqual({ ok: false, err: { code: 'BAD_JSON', detail: expect.any(String) } });
      }
    });
  });

  describe('BAD_RESPONSE: JSON that is not the reply of this message', () => {
    it('is reported for JSON that is not a reply at all', () => {
      for (const body of ['{}', '[]', '"hello"', 'null', '42', '{"ok":true}', '{"data":{}}', '{"ok":"yes","meta":{"today":"2026-10-02"},"data":{}}']) {
        expect(codeOf(parse(200, body, 'GetCatalog'))).toBe('BAD_RESPONSE');
      }
    });

    it('is reported when the date is missing or wrong, because a success says which day it was worked out for', () => {
      expect(codeOf(parse(200, JSON.stringify({ ok: true, data: DATA.GetCatalog }), 'GetCatalog'))).toBe('BAD_RESPONSE');
      expect(codeOf(parse(200, reply(DATA.GetCatalog, null), 'GetCatalog'))).toBe('BAD_RESPONSE');
      expect(codeOf(parse(200, reply(DATA.GetCatalog, 20261002), 'GetCatalog'))).toBe('BAD_RESPONSE');
    });

    it('is reported when the data of a reply is not what the message promises', () => {
      expect(codeOf(parse(200, reply(DATA.GetCatalog), 'GetInventoryList'))).toBe('BAD_RESPONSE');
      expect(codeOf(parse(200, reply(DATA.GetInventoryList), 'GetCatalog'))).toBe('BAD_RESPONSE');
      expect(codeOf(parse(200, reply({}), 'SaveCategory'))).toBe('BAD_RESPONSE');
      expect(codeOf(parse(200, reply(null), 'DeleteCategory'))).toBe('BAD_RESPONSE');
      expect(codeOf(parse(200, reply([]), 'DeleteCategory'))).toBe('BAD_RESPONSE');
    });

    it('is reported when any field of any read model is missing', () => {
      for (const kind of MESSAGES) {
        const sample = DATA[kind] as Record<string, unknown>;
        for (const field of Object.keys(sample)) {
          const { [field]: _dropped, ...rest } = sample;

          expect(codeOf(parse(200, reply(rest), kind))).toBe('BAD_RESPONSE');
        }
      }
    });

    it('is reported when a field deep inside has the wrong type or a value that is not one of its list', () => {
      const broken: readonly (readonly [MessageType, readonly (string | number)[], unknown])[] = [
        ['GetInventoryList', ['rows', 0, 'total'], '550'],
        ['GetInventoryList', ['rows', 0, 'total'], 1.5],
        ['GetInventoryList', ['rows', 0, 'overall'], 'rotten'],
        ['GetInventoryList', ['rows', 0, 'byStatus', 'expired'], null],
        ['GetInventoryList', ['rows', 0, 'categoryPath'], 'Meat'],
        ['GetFoodTypeDetail', ['batches', 1, 'status'], 'stale'],
        ['GetFoodTypeDetail', ['batches', 0, 'daysLeft'], '-1'],
        ['GetFoodTypeDetail', ['threshold', 'source'], 'cousin'],
        ['GetFoodTypeDetail', ['referencingRecipes', 0, 'name'], 7],
        ['GetWarningPanel', ['expired', 0, 'expirationDate'], 20261001],
        ['GetRecommendations', ['tier'], 'third'],
        ['GetRecommendations', ['recipes', 0, 'ingredients', 0, 'state'], 'fine'],
        ['GetRecommendations', ['recipes', 0, 'ingredients', 0, 'rescued'], 'yes'],
        ['GetCatalog', ['rows', 0, 'status'], 'maybe'],
        ['GetCatalog', ['rows', 3, 'ingredients', 0, 'available'], undefined],
        ['GetCatalog', ['cuisineId'], '10'],
        ['CookRecipes', ['reports', 0, 'outcome'], 'burnt'],
        ['CookRecipes', ['reports', 1, 'reason'], 'lazy'],
        ['CookRecipes', ['reports', 0, 'missing', 0, 'needed'], 'lots'],
        ['GetReferenceData', ['foodCategories', 0, 'children', 0, 'name'], 4],
        ['GetReferenceData', ['cuisines', 0, 'isSystem'], 'no'],
        ['GetReferenceData', ['foodTypes', 0, 'unit'], null],
        ['GetReferenceData', ['units'], 'grams'],
        ['GetReferenceData', ['simulatedToday'], 20261005],
      ];

      for (const [kind, path, replacement] of broken) {
        // a missing field is dropped by JSON.stringify, which is also a field that is not there
        const body = reply(replaced(DATA[kind], path, replacement));

        expect(`${kind} ${path.join('.')}: ${codeOf(parse(200, body, kind))}`).toBe(`${kind} ${path.join('.')}: BAD_RESPONSE`);
      }
    });

    it('is reported for an error whose code is not in the catalog', () => {
      expect(codeOf(parse(409, failureReply('NOT_A_CODE'), 'DeleteFoodType'))).toBe('BAD_RESPONSE');
      expect(codeOf(parse(409, JSON.stringify({ ok: false, meta: { today: null } }), 'DeleteFoodType'))).toBe('BAD_RESPONSE');
      expect(codeOf(parse(409, JSON.stringify({ ok: false, error: 'oops', meta: { today: null } }), 'DeleteFoodType'))).toBe('BAD_RESPONSE');
      expect(codeOf(parse(409, failureReply('toString'), 'DeleteFoodType'))).toBe('BAD_RESPONSE');
    });
  });

  describe('HTTP_STATUS: a status that says one thing when the body says another', () => {
    it('is reported for an error status without a reply of ours: a proxy page, an unknown URL', () => {
      expect(parse(502, '<html>Bad Gateway</html>', 'GetCatalog')).toEqual({ ok: false, err: { code: 'HTTP_STATUS', detail: expect.stringContaining('502') } });
      expect(codeOf(parse(404, '<!DOCTYPE html><title>Error</title>', 'GetCatalog'))).toBe('HTTP_STATUS');
      expect(codeOf(parse(500, 'Internal Server Error', 'GetCatalog'))).toBe('HTTP_STATUS');
      expect(codeOf(parse(500, '', 'GetCatalog'))).toBe('HTTP_STATUS');
      expect(codeOf(parse(503, '{"message":"down"}', 'GetCatalog'))).toBe('HTTP_STATUS');
      expect(codeOf(parse(301, '', 'GetCatalog'))).toBe('HTTP_STATUS');
    });

    it('is reported when an error status carries a success reply', () => {
      expect(codeOf(parse(500, reply(DATA.GetCatalog), 'GetCatalog'))).toBe('HTTP_STATUS');
    });

    it('is reported when a success status carries a failure reply', () => {
      expect(codeOf(parse(200, failureReply('CAP_EXCEEDED'), 'InboundBatch'))).toBe('HTTP_STATUS');
    });

    it('is told apart from BAD_JSON by the status: the same page is BAD_JSON under 200 and HTTP_STATUS under 502', () => {
      expect(codeOf(parse(200, '<html></html>', 'GetCatalog'))).toBe('BAD_JSON');
      expect(codeOf(parse(502, '<html></html>', 'GetCatalog'))).toBe('HTTP_STATUS');
    });
  });

  it('never throws, whatever the body is', () => {
    for (const body of ['{"ok":true,"meta":{"today":"x"},"data":', '\u0000', '{"__proto__":{"ok":true}}', '[[[[[[[[[[', '{"ok":true,"meta":{"today":"x"},"data":{"rows":[null]}}']) {
      for (const status of [200, 404, 500]) expect(() => parse(status, body, 'GetInventoryList')).not.toThrow();
    }
  });
});
