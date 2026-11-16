import { describe, expect, expectTypeOf, it } from 'vitest';
import { ERROR_FAMILY_OF } from '@freshrescue/contract-errors';
import type { DomainError } from '@freshrescue/contract-errors';
import { COMMAND_TYPES } from '@freshrescue/contract-messages';
import type { Command, CommandPayloads, CommandType } from '@freshrescue/contract-messages';
import type { Result } from '@freshrescue/contract-primitives';
import { commandParser } from './commandParser';

/** One valid payload for each command. `satisfies` makes a command without a sample a compile error. */
const VALID = {
  SaveCategory: { scope: 'foodCategory', categoryId: null, parentId: 3, name: 'Poultry' },
  DeleteCategory: { scope: 'cuisine', categoryId: 5 },
  SetCategoryThreshold: { categoryId: 4, thresholdDays: 5 },
  SaveFoodType: { foodTypeId: null, name: 'Beef', categoryId: 4, unit: 'grams', thresholdDays: null },
  ChangeFoodTypeUnit: {
    foodTypeId: 10,
    unit: 'pieces',
    batches: [
      { batchId: 20, quantity: 500 },
      { batchId: 21, quantity: 1000 },
    ],
  },
  DeleteFoodType: { foodTypeId: 10 },
  InboundBatch: { foodTypeId: null, foodName: 'Milk', categoryId: 6, unit: 'ml', quantity: 500_000, expiry: { days: 5 } },
  EditBatchQuantity: { batchId: 20, quantity: 250_000 },
  RemoveBatch: { batchId: 20 },
  SaveRecipe: {
    recipeId: null,
    name: 'Tomato Egg Stir-Fry',
    draft: {
      cuisineId: 7,
      rows: [
        { foodTypeId: 10, quantity: 2000, unit: 'pieces' },
        { foodTypeId: 11, quantity: 3000, unit: 'pieces' },
      ],
    },
  },
  DeleteRecipe: { recipeId: 30 },
  CookRecipes: { recipeIds: [30, 31, 30] },
  SetSimulatedToday: { date: '2026-12-01' },
} satisfies { [T in CommandType]: CommandPayloads[T] };

const body = (type: string, payload: unknown): string => JSON.stringify({ type, payload });
const parse = (type: string, payload: unknown): Result<Command, DomainError> => commandParser(body(type, payload));
const codeOf = (result: Result<unknown, DomainError>): string => (result.ok ? 'ok' : result.err.code);
const detailOf = (result: Result<unknown, DomainError>): string => (result.ok ? '' : (result.err.detail ?? ''));

/** The sample payload of a command with one field replaced, or taken out when `value` is undefined. */
function altered(type: CommandType, field: string, value: unknown): Record<string, unknown> {
  const { [field]: _removed, ...rest } = VALID[type] as Record<string, unknown>;
  return value === undefined ? rest : { ...rest, [field]: value };
}

const fieldsOf = (type: CommandType): string[] => Object.keys(VALID[type]);
const everyField: [CommandType, string][] = COMMAND_TYPES.flatMap((type) => fieldsOf(type).map((field): [CommandType, string] => [type, field]));

describe('BP-01 CommandParser', () => {
  describe('a valid command', () => {
    it('has a sample here for each of the 13 commands, and no other', () => {
      expect(Object.keys(VALID).sort()).toEqual([...COMMAND_TYPES].sort());
      expect(COMMAND_TYPES).toHaveLength(13);
    });

    it.each(COMMAND_TYPES)('%s parses into the typed command', (type) => {
      expect(parse(type, VALID[type])).toEqual({ ok: true, value: { type, payload: VALID[type] } });
    });

    it('returns a Result of a Command', () => {
      expectTypeOf(commandParser).parameters.toEqualTypeOf<[string]>();
      expectTypeOf(commandParser).returns.toEqualTypeOf<Result<Command, DomainError>>();
    });

    it('lets each command take its other forms', () => {
      const forms: [CommandType, unknown][] = [
        ['SaveCategory', { scope: 'cuisine', categoryId: 5, parentId: null, name: 'Cuisine Française' }],
        ['SaveCategory', { scope: 'foodCategory', categoryId: null, parentId: null, name: 'Meat' }],
        ['SetCategoryThreshold', { categoryId: 4, thresholdDays: null }],
        ['SaveFoodType', { foodTypeId: 10, name: 'Beef', categoryId: null, unit: null, thresholdDays: 2 }],
        ['InboundBatch', { foodTypeId: 10, foodName: null, categoryId: null, unit: null, quantity: 1500, expiry: { date: '2026-10-06' } }],
        ['SaveRecipe', { recipeId: 30, name: 'Stew', draft: { cuisineId: null, rows: [{ foodTypeId: 10, quantity: 300_000, unit: 'grams' }] } }],
        ['SetSimulatedToday', { date: null }],
      ];

      for (const [type, payload] of forms) expect(parse(type, payload)).toEqual({ ok: true, value: { type, payload } });
    });

    it('accepts a list with nothing in it, which the rules of the coordinator judge: no batch, no ingredient, an empty queue', () => {
      expect(codeOf(parse('ChangeFoodTypeUnit', { foodTypeId: 10, unit: 'kg', batches: [] }))).toBe('ok');
      expect(codeOf(parse('SaveRecipe', { recipeId: null, name: 'X', draft: { cuisineId: null, rows: [] } }))).toBe('ok');
      expect(codeOf(parse('CookRecipes', { recipeIds: [] }))).toBe('ok');
    });
  });

  describe('a value that only a validator may judge', () => {
    const inbound = (fields: object) => ({ ...VALID.InboundBatch, ...fields });

    it('passes the parser, so that the validator answers with its own code: a quantity of any value', () => {
      for (const quantity of [0, -5, 1.5, 0.0005, 1, 500_000_000, 500_000_001, 1e12, 1e20]) {
        expect(codeOf(parse('InboundBatch', inbound({ quantity })))).toBe('ok');
        expect(codeOf(parse('EditBatchQuantity', { batchId: 20, quantity }))).toBe('ok');
      }
    });

    it('passes the parser: a shelf life of any number, a threshold of any number, an empty name, an unknown unit', () => {
      for (const days of [-1, 0, 2.5, 1e9]) expect(codeOf(parse('InboundBatch', inbound({ expiry: { days } })))).toBe('ok');
      for (const thresholdDays of [0, -3, 1.5, 365]) expect(codeOf(parse('SetCategoryThreshold', { categoryId: 4, thresholdDays }))).toBe('ok');
      expect(codeOf(parse('SaveCategory', { ...VALID.SaveCategory, name: '' }))).toBe('ok');
      expect(codeOf(parse('SaveCategory', { ...VALID.SaveCategory, name: '   ' }))).toBe('ok');
      expect(codeOf(parse('SaveCategory', { ...VALID.SaveCategory, name: 'x'.repeat(5000) }))).toBe('ok');
      expect(codeOf(parse('SaveFoodType', { ...VALID.SaveFoodType, unit: 'cups' }))).toBe('ok');
      expect(codeOf(parse('SaveFoodType', { ...VALID.SaveFoodType, unit: '' }))).toBe('ok');
    });

    it('passes the parser: a name for the inbound that matches no Food Type, and a date that is in the past', () => {
      expect(codeOf(parse('InboundBatch', inbound({ foodName: 'something new' })))).toBe('ok');
      expect(codeOf(parse('InboundBatch', inbound({ expiry: { date: '2001-01-01' } })))).toBe('ok');
    });
  });

  describe('BAD_ENVELOPE', () => {
    it('answers it for a body that is not JSON', () => {
      for (const text of ['', ' ', 'not json', '{', '{"type":', "{'type': 'RemoveBatch'}", '﻿{"type":"RemoveBatch","payload":{"batchId":1}}', 'undefined']) {
        expect(commandParser(text)).toMatchObject({ ok: false, err: { code: 'BAD_ENVELOPE' } });
      }
    });

    it('answers it for JSON that is not an object', () => {
      for (const text of ['[]', '[1,2]', '"RemoveBatch"', 'null', '42', 'true', '[{"type":"RemoveBatch","payload":{"batchId":1}}]']) {
        expect(commandParser(text)).toMatchObject({ ok: false, err: { code: 'BAD_ENVELOPE' } });
      }
    });

    it('answers it for an object whose type is missing or is not text', () => {
      for (const text of ['{}', '{"payload":{"batchId":1}}', '{"type":5,"payload":{}}', '{"type":null,"payload":{}}', '{"type":"","payload":{}}', '{"type":["RemoveBatch"],"payload":{}}', '{"type":{},"payload":{}}']) {
        expect(commandParser(text)).toMatchObject({ ok: false, err: { code: 'BAD_ENVELOPE' } });
      }
    });

    it('answers it for a body that is far too deep to read, as a value and not as a crash', () => {
      const deep = `${'['.repeat(200_000)}${']'.repeat(200_000)}`;

      expect(codeOf(commandParser(deep))).toBe('BAD_ENVELOPE');
    });
  });

  describe('UNKNOWN_COMMAND', () => {
    it('answers it for a type that is text but is not a command', () => {
      for (const type of ['Nope', 'saveCategory', 'SAVECATEGORY', 'SaveCategory ', ' SaveCategory', 'Save Category', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
        expect(parse(type, {})).toMatchObject({ ok: false, err: { code: 'UNKNOWN_COMMAND' } });
      }
    });

    it('answers it for a query sent to the command parser, and names the type', () => {
      const result = parse('GetCatalog', { cuisineId: null });

      expect(codeOf(result)).toBe('UNKNOWN_COMMAND');
      expect(detailOf(result)).toContain('GetCatalog');
    });

    it('names the unknown type before it looks at the payload', () => {
      expect(commandParser('{"type":"Nope"}')).toMatchObject({ ok: false, err: { code: 'UNKNOWN_COMMAND' } });
    });
  });

  describe('MISSING_FIELD', () => {
    it('answers it when the payload is not there', () => {
      expect(commandParser('{"type":"RemoveBatch"}')).toMatchObject({ ok: false, err: { code: 'MISSING_FIELD' } });
      expect(detailOf(commandParser('{"type":"RemoveBatch"}'))).toContain('payload');
    });

    it.each(everyField)('answers it for %s without its %s, and names the field', (type, field) => {
      const result = parse(type, altered(type, field, undefined));

      expect(codeOf(result)).toBe('MISSING_FIELD');
      expect(detailOf(result)).toContain(field);
    });

    it('answers it for a field missing inside a nested object: a batch of a unit change, a row of a recipe, the draft', () => {
      const cases: [CommandType, unknown, string][] = [
        ['ChangeFoodTypeUnit', { ...VALID.ChangeFoodTypeUnit, batches: [{ batchId: 20 }] }, 'quantity'],
        ['ChangeFoodTypeUnit', { ...VALID.ChangeFoodTypeUnit, batches: [{ quantity: 5 }] }, 'batchId'],
        ['SaveRecipe', { ...VALID.SaveRecipe, draft: { cuisineId: 7 } }, 'rows'],
        ['SaveRecipe', { ...VALID.SaveRecipe, draft: { rows: [] } }, 'cuisineId'],
        ['SaveRecipe', { ...VALID.SaveRecipe, draft: { cuisineId: 7, rows: [{ foodTypeId: 10, quantity: 1 }] } }, 'unit'],
        ['SaveRecipe', { ...VALID.SaveRecipe, draft: { cuisineId: 7, rows: [{ quantity: 1, unit: 'kg' }] } }, 'foodTypeId'],
      ];

      for (const [type, payload, field] of cases) {
        const result = parse(type, payload);
        expect(codeOf(result), `${type} without ${field}`).toBe('MISSING_FIELD');
        expect(detailOf(result)).toContain(field);
      }
    });

    it('treats a field that is null as present, and a field that is left out as missing: null is the one way to say none', () => {
      expect(codeOf(parse('SaveCategory', { scope: 'cuisine', categoryId: null, parentId: null, name: 'X' }))).toBe('ok');
      expect(codeOf(parse('SaveCategory', { scope: 'cuisine', categoryId: null, name: 'X' }))).toBe('MISSING_FIELD');
    });
  });

  describe('WRONG_TYPE', () => {
    it('answers it when the payload is not an object', () => {
      for (const payload of ['text', 5, true, [], [VALID.RemoveBatch], null]) {
        expect(codeOf(parse('RemoveBatch', payload)), JSON.stringify(payload)).toBe('WRONG_TYPE');
      }
    });

    it.each(everyField)('answers it for %s with its %s as something that is no kind of value for it', (type, field) => {
      for (const wrong of [true, { x: 1 }, ['a']]) {
        const result = parse(type, altered(type, field, wrong));
        // a field that holds an object or a list reads an object or a list in its own way, so only the plain wrong value is asserted for it
        if (wrong === true) expect(codeOf(result), `${type}.${field} as ${JSON.stringify(wrong)}`).toBe('WRONG_TYPE');
        else expect(result.ok, `${type}.${field} as ${JSON.stringify(wrong)}`).toBe(false);
      }
    });

    it('answers it for an id that is a text, zero, negative, fractional or not finite: there is no conversion', () => {
      for (const id of ['5', '', 0, -1, 1.5, null]) {
        expect(codeOf(parse('RemoveBatch', { batchId: id })), JSON.stringify(id)).toBe('WRONG_TYPE');
        expect(codeOf(parse('DeleteRecipe', { recipeId: id })), JSON.stringify(id)).toBe('WRONG_TYPE');
      }
    });

    it('answers it for an id beyond what a number can hold, written as JSON text, because JSON.stringify cannot write one', () => {
      for (const digits of ['1e400', '1e999', '9007199254740993', '9'.repeat(400)]) {
        expect(commandParser(`{"type":"RemoveBatch","payload":{"batchId":${digits}}}`), digits.slice(0, 20)).toMatchObject({ ok: false, err: { code: 'WRONG_TYPE' } });
      }
    });

    it('answers it for a nullable id that is not null and is not an id', () => {
      for (const id of ['5', 0, -2, 2.5]) {
        expect(codeOf(parse('SaveFoodType', { ...VALID.SaveFoodType, categoryId: id }))).toBe('WRONG_TYPE');
      }
    });

    it('answers it for a number that is text: "500" is not 500', () => {
      expect(codeOf(parse('InboundBatch', { ...VALID.InboundBatch, quantity: '500' }))).toBe('WRONG_TYPE');
      expect(codeOf(parse('InboundBatch', { ...VALID.InboundBatch, quantity: null }))).toBe('WRONG_TYPE');
      expect(codeOf(parse('InboundBatch', { ...VALID.InboundBatch, expiry: { days: '3' } }))).toBe('WRONG_TYPE');
      expect(codeOf(parse('SetCategoryThreshold', { categoryId: 4, thresholdDays: '3' }))).toBe('WRONG_TYPE');
    });

    it('answers it for text that is a number: a name, a unit', () => {
      expect(codeOf(parse('SaveCategory', { ...VALID.SaveCategory, name: 5 }))).toBe('WRONG_TYPE');
      expect(codeOf(parse('SaveFoodType', { ...VALID.SaveFoodType, unit: 5 }))).toBe('WRONG_TYPE');
    });

    it('answers it for a scope that is not one of the two trees', () => {
      for (const scope of ['recipe', 'foodType', 'Other', '', 'FOODCATEGORY', 5, null]) {
        expect(codeOf(parse('DeleteCategory', { scope, categoryId: 5 })), JSON.stringify(scope)).toBe('WRONG_TYPE');
      }
    });

    it('answers it for a list that is not a list, or whose items are not what the list holds', () => {
      expect(codeOf(parse('CookRecipes', { recipeIds: 30 }))).toBe('WRONG_TYPE');
      expect(codeOf(parse('CookRecipes', { recipeIds: ['30'] }))).toBe('WRONG_TYPE');
      expect(codeOf(parse('CookRecipes', { recipeIds: [30, 0] }))).toBe('WRONG_TYPE');
      expect(codeOf(parse('CookRecipes', { recipeIds: [30, null] }))).toBe('WRONG_TYPE');
      expect(codeOf(parse('ChangeFoodTypeUnit', { ...VALID.ChangeFoodTypeUnit, batches: {} }))).toBe('WRONG_TYPE');
      expect(codeOf(parse('ChangeFoodTypeUnit', { ...VALID.ChangeFoodTypeUnit, batches: [5] }))).toBe('WRONG_TYPE');
      expect(codeOf(parse('ChangeFoodTypeUnit', { ...VALID.ChangeFoodTypeUnit, batches: [{ batchId: '20', quantity: 5 }] }))).toBe('WRONG_TYPE');
      expect(codeOf(parse('SaveRecipe', { ...VALID.SaveRecipe, draft: 'x' }))).toBe('WRONG_TYPE');
    });

    it('names the field in the detail, with its path', () => {
      expect(detailOf(parse('SaveCategory', { ...VALID.SaveCategory, name: 5 }))).toContain('payload.name');
      expect(detailOf(parse('SaveRecipe', { ...VALID.SaveRecipe, draft: { cuisineId: 7, rows: [{ foodTypeId: 'x', quantity: 1, unit: 'kg' }] } }))).toContain('payload.draft.rows');
    });
  });

  describe('BAD_COMBINATION', () => {
    it('answers it for an inbound that names its Food Type both by id and by name', () => {
      const result = parse('InboundBatch', { ...VALID.InboundBatch, foodTypeId: 10, foodName: 'Milk' });

      expect(codeOf(result)).toBe('BAD_COMBINATION');
      expect(detailOf(result)).toContain('foodTypeId');
    });

    it('does not answer it for an inbound that names no Food Type at all: that is the form with its name left blank', () => {
      // The frontend form `batchAdd` makes foodTypeId and foodName optional, and a blank optional field is
      // sent as null. So a blank name with nothing picked arrives as exactly this body. It is an empty
      // name for NameValidator to refuse as NAME_EMPTY (spec section 3, exception row 3), and not a shape
      // error that points at no field.
      const blankForm = { foodTypeId: null, foodName: null, categoryId: null, unit: null, quantity: 500_000, expiry: { days: 3 } };

      expect(parse('InboundBatch', blankForm)).toEqual({ ok: true, value: { type: 'InboundBatch', payload: blankForm } });
    });

    it('lets each of the two ways through on its own: a picked Food Type with no name, and a typed name with no pick', () => {
      expect(codeOf(parse('InboundBatch', { ...VALID.InboundBatch, foodTypeId: 10, foodName: null }))).toBe('ok');
      expect(codeOf(parse('InboundBatch', { ...VALID.InboundBatch, foodTypeId: null, foodName: 'Milk' }))).toBe('ok');
    });

    it('does not take an empty name for no name: that is a name, and NAME_EMPTY judges it', () => {
      expect(codeOf(parse('InboundBatch', { ...VALID.InboundBatch, foodTypeId: null, foodName: '' }))).toBe('ok');
      expect(codeOf(parse('InboundBatch', { ...VALID.InboundBatch, foodTypeId: null, foodName: '   ' }))).toBe('ok');
      // an id and a text of any kind are still two names
      expect(codeOf(parse('InboundBatch', { ...VALID.InboundBatch, foodTypeId: 10, foodName: '' }))).toBe('BAD_COMBINATION');
      expect(codeOf(parse('InboundBatch', { ...VALID.InboundBatch, foodTypeId: 10, foodName: '   ' }))).toBe('BAD_COMBINATION');
    });

    it('answers it for an expiry that gives a shelf life and a date, and for one that gives neither', () => {
      expect(codeOf(parse('InboundBatch', { ...VALID.InboundBatch, expiry: { days: 3, date: '2026-10-04' } }))).toBe('BAD_COMBINATION');
      expect(codeOf(parse('InboundBatch', { ...VALID.InboundBatch, expiry: {} }))).toBe('BAD_COMBINATION');
      expect(codeOf(parse('InboundBatch', { ...VALID.InboundBatch, expiry: { other: 3 } }))).toBe('BAD_COMBINATION');
    });
  });

  describe('DATE_INVALID', () => {
    const notDates = ['tomorrow', '', ' ', '2026-1-5', '2026/10/05', '20261005', '2026-10-5', '26-10-05', ' 2026-10-05', '2026-10-05 ', '2026-10-05T00:00:00Z', '2026-02-30', '2027-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-32', '+2026-10-05', '２０２６-10-05'];

    it('answers it for an expiration date that is text but is not a calendar date', () => {
      for (const date of notDates) {
        expect(codeOf(parse('InboundBatch', { ...VALID.InboundBatch, expiry: { date } })), JSON.stringify(date)).toBe('DATE_INVALID');
      }
    });

    it('answers it for a Simulated Today that is text but is not a calendar date', () => {
      for (const date of notDates) {
        expect(codeOf(parse('SetSimulatedToday', { date })), JSON.stringify(date)).toBe('DATE_INVALID');
      }
    });

    it('accepts a real date, a leap day and the ends of the months', () => {
      for (const date of ['2026-10-05', '2028-02-29', '2000-02-29', '2026-02-28', '2026-12-31', '2026-01-31', '2026-04-30', '0001-01-01', '9999-12-31']) {
        expect(parse('SetSimulatedToday', { date })).toEqual({ ok: true, value: { type: 'SetSimulatedToday', payload: { date } } });
      }
    });

    it('answers WRONG_TYPE and not DATE_INVALID for a date that is not text at all', () => {
      for (const date of [20261005, true, {}, [], ['2026-10-05']]) {
        expect(codeOf(parse('SetSimulatedToday', { date })), JSON.stringify(date)).toBe('WRONG_TYPE');
      }
    });

    it('takes null as the way to clear Simulated Today, and a missing date as missing', () => {
      expect(codeOf(parse('SetSimulatedToday', { date: null }))).toBe('ok');
      expect(codeOf(parse('SetSimulatedToday', {}))).toBe('MISSING_FIELD');
    });

    it('names the field in the detail', () => {
      expect(detailOf(parse('SetSimulatedToday', { date: '2026-02-30' }))).toContain('payload.date');
    });
  });

  describe('a field that is not in the contract', () => {
    it('is dropped, so the command that comes out has the fields of its payload type and no more', () => {
      const text = JSON.stringify({
        type: 'InboundBatch',
        extra: 'x',
        payload: { ...VALID.InboundBatch, note: 'cold', expiry: { days: 5, nonsense: true } },
      });

      expect(commandParser(text)).toEqual({ ok: true, value: { type: 'InboundBatch', payload: VALID.InboundBatch } });
    });

    it('is dropped inside a list too, and no item of a list is dropped', () => {
      const payload = { ...VALID.ChangeFoodTypeUnit, batches: [{ batchId: 20, quantity: 500, note: 'a' }, { batchId: 21, quantity: 1000 }] };

      expect(parse('ChangeFoodTypeUnit', payload)).toEqual({ ok: true, value: { type: 'ChangeFoodTypeUnit', payload: VALID.ChangeFoodTypeUnit } });
    });

    it('does not let a key named like a property of every object through', () => {
      const text = '{"type":"RemoveBatch","payload":{"batchId":1,"__proto__":{"admin":true},"constructor":{"x":1}}}';
      const result = commandParser(text);

      expect(result).toEqual({ ok: true, value: { type: 'RemoveBatch', payload: { batchId: 1 } } });
      expect(({} as Record<string, unknown>).admin).toBeUndefined();
    });
  });

  describe('every error is a shape error from the catalog, and nothing is thrown', () => {
    const awkward: string[] = [
      '', '{', '[', 'null', '0', '"', '{"type":"SaveCategory","payload":', '{"type":"SaveCategory","payload":{"scope":"cuisine"',
      '{"type":"CookRecipes","payload":{"recipeIds":[' + '1,'.repeat(10_000) + '1]}}',
      '{"type":"SaveCategory","payload":{"scope":"cuisine","categoryId":null,"parentId":null,"name":"' + '\\u0000'.repeat(100) + '"}}',
      '{"type":"RemoveBatch","payload":{"batchId":1e999}}',
      '{"type":"RemoveBatch","payload":{"batchId":-0}}',
      '{"type":"RemoveBatch","payload":{"batchId":9007199254740993}}',
      '{"type":"RemoveBatch","payload":{"batchId":' + '9'.repeat(400) + '}}',
      '{"type":"RemoveBatch","payload":{"batchId":1},"type":"DeleteRecipe"}',
      '{"type":"😀","payload":{}}',
      '{"__proto__":{"type":"RemoveBatch"}}',
    ];

    it('gives a Result for each body: a command, or a code of the shape family', () => {
      for (const text of awkward) {
        let result: Result<Command, DomainError> | undefined;
        expect(() => {
          result = commandParser(text);
        }, text.slice(0, 60)).not.toThrow();
        if (result?.ok === false) expect(ERROR_FAMILY_OF[result.err.code]).toBe('shape');
        expect(result?.ok).not.toBeUndefined();
      }
    });

    it('gives only the codes this parser owns, whatever the fault', () => {
      const owned = new Set(['BAD_ENVELOPE', 'UNKNOWN_COMMAND', 'MISSING_FIELD', 'WRONG_TYPE', 'BAD_COMBINATION', 'DATE_INVALID']);
      const results = awkward.map((text) => commandParser(text));

      for (const result of results) if (!result.ok) expect(owned.has(result.err.code)).toBe(true);
    });

    it('gives a detail that says what is wrong', () => {
      for (const text of ['', '[]', '{"type":"Nope"}', '{"type":"RemoveBatch"}', body('RemoveBatch', { batchId: 'x' })]) {
        const result = commandParser(text);
        expect(result.ok ? 'ok' : (result.err.detail ?? '').length).toBeGreaterThan(5);
      }
    });
  });

  it('gives the same answer twice, reads the first fault of a body, and keeps no state between bodies', () => {
    const broken = body('InboundBatch', { ...VALID.InboundBatch, quantity: 'x', expiry: { date: 'tomorrow' } });

    expect(commandParser(broken)).toEqual(commandParser(broken));
    expect(codeOf(commandParser(broken))).toBe('WRONG_TYPE');
    expect(commandParser(body('RemoveBatch', VALID.RemoveBatch)).ok).toBe(true);
    expect(commandParser(broken).ok).toBe(false);
  });
});
