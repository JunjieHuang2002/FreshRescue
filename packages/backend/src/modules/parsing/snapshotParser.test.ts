import { describe, expect, expectTypeOf, it } from 'vitest';
import { EMPTY_SNAPSHOT, SNAPSHOT_LISTS } from '@freshrescue/contract-entities';
import type { RawStore, Snapshot } from '@freshrescue/contract-entities';
import { ERROR_FAMILY_OF } from '@freshrescue/contract-errors';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import {
  buildBatch,
  buildFoodCategory,
  buildFoodType,
  buildIngredient,
  buildRecipe,
  buildRecipeCategory,
  buildSnapshot,
  rawStoreOf,
} from '../../testing/fixtures';
import { snapshotParser } from './snapshotParser';

/** Something in every list, a null in every field that may be null, and a value in every one that may have it. */
const FULL: Snapshot = buildSnapshot({
  foodCategories: [
    buildFoodCategory({ id: 3, name: 'Meat', customThresholdDays: 5 }),
    buildFoodCategory({ id: 4, name: 'Poultry', parentId: 3 }),
  ],
  foodTypes: [
    buildFoodType({ id: 10, name: 'Chicken', categoryId: 4, customThresholdDays: 2 }),
    buildFoodType({ id: 11, name: 'Milk', unit: 'ml' }),
  ],
  batches: [
    buildBatch({ id: 20, foodTypeId: 10, quantity: 300_000, inboundDate: '2026-10-01', expirationDate: '2026-10-04', createdSeq: 1 }),
    buildBatch({ id: 21, foodTypeId: 10, quantity: 150_000, inboundDate: '2026-10-02', expirationDate: '2026-10-12', createdSeq: 2 }),
  ],
  recipeCategories: [buildRecipeCategory({ id: 5, name: 'French Cuisine' })],
  recipes: [buildRecipe({ id: 30, name: 'Chicken Gratin', recipeCategoryId: 5 })],
  recipeIngredients: [
    buildIngredient({ recipeId: 30, foodTypeId: 10, requiredQuantity: 250_000 }),
    buildIngredient({ recipeId: 30, foodTypeId: 12, requiredQuantity: 100_000, deletedFoodTypeName: 'Cream' }),
  ],
  settings: { simulatedToday: '2026-10-02', bootstrapped: true },
});

const raw = (changes: Record<string, unknown> = {}): RawStore => ({ ...rawStoreOf(FULL), ...changes });
const codeOf = (result: Result<unknown, DomainError>): string => (result.ok ? 'ok' : result.err.code);
const detailOf = (result: Result<unknown, DomainError>): string => (result.ok ? '' : (result.err.detail ?? ''));

/** The raw store with one field of the first row of a list taken out, or replaced by `value`. */
function withField(list: string, field: string, value: unknown): RawStore {
  const store = rawStoreOf(FULL) as Record<string, unknown>;
  const rows = store[list];
  const [first, ...rest] = (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
  const { [field]: _removed, ...kept } = first ?? {};
  return { ...store, [list]: [value === undefined ? kept : { ...kept, [field]: value }, ...rest] };
}

const ROW_FIELDS: Record<string, string[]> = {
  foodCategories: ['id', 'name', 'parentId', 'isSystem', 'customThresholdDays'],
  foodTypes: ['id', 'name', 'categoryId', 'unit', 'customThresholdDays'],
  batches: ['id', 'foodTypeId', 'quantity', 'inboundDate', 'expirationDate', 'createdSeq'],
  recipeCategories: ['id', 'name', 'isSystem'],
  recipes: ['id', 'name', 'recipeCategoryId'],
  recipeIngredients: ['recipeId', 'foodTypeId', 'requiredQuantity', 'requiredUnit', 'deletedFoodTypeName'],
};
const everyRowField = Object.entries(ROW_FIELDS).flatMap(([list, fields]) => fields.map((field): [string, string] => [list, field]));

describe('BP-03 SnapshotParser', () => {
  describe('an empty store', () => {
    it('reads as the empty snapshot when the gateway found nothing', () => {
      expect(snapshotParser(null)).toEqual({ ok: true, value: EMPTY_SNAPSHOT });
      expect(EMPTY_SNAPSHOT.settings.bootstrapped).toBe(false);
      expect(EMPTY_SNAPSHOT.counters).toEqual({ nextId: 3, nextSeq: 1 });
    });
  });

  describe('a valid document', () => {
    it('becomes the snapshot it was written from, in every list and in the same order', () => {
      expect(snapshotParser(rawStoreOf(FULL))).toEqual({ ok: true, value: FULL });
    });

    it('keeps creation order, which is the tie-break of the A to Z sort', () => {
      const out = snapshotParser(raw({ foodTypes: [{ ...buildFoodType({ id: 12, name: 'Zucchini' }) }, { ...buildFoodType({ id: 11, name: 'Apple' }) }] }));

      expect(out.ok ? out.value.foodTypes.map((food) => food.id) : []).toEqual([12, 11]);
    });

    it('reads a document with empty lists and a bootstrapped store', () => {
      const document = rawStoreOf(buildSnapshot({ settings: { simulatedToday: null, bootstrapped: true } }));

      expect(snapshotParser(document)).toMatchObject({ ok: true, value: { batches: [], settings: { bootstrapped: true } } });
    });

    it('takes null where an entity may have none, and a text where it may have one', () => {
      const out = snapshotParser(rawStoreOf(FULL));

      expect(out.ok ? out.value.foodCategories.map((category) => category.parentId) : []).toEqual([null, null, 3]);
      expect(out.ok ? out.value.recipeIngredients.map((row) => row.deletedFoodTypeName) : []).toEqual([null, 'Cream']);
      expect(out.ok ? out.value.settings.simulatedToday : '').toBe('2026-10-02');
    });

    it('returns a Result of a Snapshot', () => {
      expectTypeOf(snapshotParser).returns.toEqualTypeOf<Result<Snapshot, DomainError>>();
      expectTypeOf(snapshotParser).parameters.toEqualTypeOf<[RawStore | null]>();
    });

    it('drops a field that the entities do not have, in the document and in a row', () => {
      const store = rawStoreOf(FULL) as Record<string, unknown[]>;
      const document = { ...store, extra: 1, batches: store.batches?.map((row) => ({ ...(row as object), note: 'cold' })) };

      expect(snapshotParser(document)).toEqual({ ok: true, value: FULL });
    });

    it('checks the shape and nothing else: a value of the right type that is not allowed is the invariant checker\'s to refuse', () => {
      const odd = snapshotParser(
        raw({
          batches: [{ id: 1, foodTypeId: 999, quantity: 0, inboundDate: '2026-10-09', expirationDate: '2026-02-31', createdSeq: -5 }],
          foodTypes: [{ id: -3, name: '', categoryId: 404, unit: 'cups', customThresholdDays: 0 }],
        }),
      );

      expect(codeOf(odd)).toBe('ok');
    });
  });

  describe('CORRUPT_STORE', () => {
    it('answers it for a document that is not an object', () => {
      for (const document of [[], [rawStoreOf(FULL)], 'store', '', 42, 0, true, false, undefined]) {
        expect(snapshotParser(document as unknown as RawStore), JSON.stringify(document)).toMatchObject({ ok: false, err: { code: 'CORRUPT_STORE' } });
      }
    });

    it('says so in the detail', () => {
      expect(detailOf(snapshotParser([] as unknown as RawStore))).toContain('not an object');
    });
  });

  describe('SCHEMA_MISMATCH', () => {
    it('answers it for an empty object, which has no list, and for an object of other things', () => {
      expect(codeOf(snapshotParser({}))).toBe('SCHEMA_MISMATCH');
      expect(codeOf(snapshotParser({ hello: 'world' }))).toBe('SCHEMA_MISMATCH');
    });

    it.each([...SNAPSHOT_LISTS, 'settings', 'counters'])('answers it for a document without %s, and names it', (key) => {
      const { [key]: _removed, ...rest } = rawStoreOf(FULL) as Record<string, unknown>;
      const result = snapshotParser(rest);

      expect(codeOf(result)).toBe('SCHEMA_MISMATCH');
      expect(detailOf(result)).toContain(key);
    });

    it.each(SNAPSHOT_LISTS)('answers it when %s is not a list', (key) => {
      for (const wrong of [null, {}, 'rows', 5, true]) {
        expect(codeOf(snapshotParser(raw({ [key]: wrong }))), JSON.stringify(wrong)).toBe('SCHEMA_MISMATCH');
      }
    });

    it.each(SNAPSHOT_LISTS)('answers it when a row of %s is not an object', (key) => {
      for (const wrong of [null, 5, 'row', [], true]) {
        expect(codeOf(snapshotParser(raw({ [key]: [wrong] }))), JSON.stringify(wrong)).toBe('SCHEMA_MISMATCH');
      }
    });

    it.each(everyRowField)('answers it for a row of %s without its %s, and names the field', (list, field) => {
      const result = snapshotParser(withField(list, field, undefined));

      expect(codeOf(result)).toBe('SCHEMA_MISMATCH');
      expect(detailOf(result)).toContain(field);
    });

    it.each(everyRowField)('answers it for a row of %s whose %s is an object, which is no kind of value for it', (list, field) => {
      expect(codeOf(snapshotParser(withField(list, field, { x: 1 })))).toBe('SCHEMA_MISMATCH');
    });

    it('answers it for a whole number that is not whole, or is text: there is no conversion', () => {
      for (const value of [1.5, '10', '', null, true, Number.NaN]) {
        expect(codeOf(snapshotParser(withField('foodTypes', 'id', value))), JSON.stringify(value)).toBe('SCHEMA_MISMATCH');
        expect(codeOf(snapshotParser(withField('batches', 'quantity', value))), JSON.stringify(value)).toBe('SCHEMA_MISMATCH');
      }
    });

    it('answers it for a field that cannot be null and is', () => {
      for (const [list, field] of [['foodTypes', 'name'], ['foodTypes', 'unit'], ['foodTypes', 'categoryId'], ['batches', 'quantity'], ['batches', 'expirationDate'], ['foodCategories', 'isSystem'], ['recipeIngredients', 'requiredUnit']] as const) {
        expect(codeOf(snapshotParser(withField(list, field, null))), `${list}.${field}`).toBe('SCHEMA_MISMATCH');
      }
    });

    it('answers it for a boolean that is not one: the text "true" and the number 1 are not booleans', () => {
      for (const value of ['true', 1, 0, null]) {
        expect(codeOf(snapshotParser(withField('foodCategories', 'isSystem', value))), JSON.stringify(value)).toBe('SCHEMA_MISMATCH');
      }
    });

    it('answers it for a date that is not written YYYY-MM-DD', () => {
      for (const date of ['tomorrow', '', '2026-1-5', '2026/10/05', '20261005', '2026-10-05T00:00:00Z', ' 2026-10-05', 20261005, null]) {
        expect(codeOf(snapshotParser(withField('batches', 'expirationDate', date))), JSON.stringify(date)).toBe('SCHEMA_MISMATCH');
        expect(codeOf(snapshotParser(withField('batches', 'inboundDate', date))), JSON.stringify(date)).toBe('SCHEMA_MISMATCH');
      }
    });

    it('answers it for the settings and the counters that are not the right shape', () => {
      for (const settings of [null, [], 'x', {}, { simulatedToday: null }, { bootstrapped: true }, { simulatedToday: 'soon', bootstrapped: true }, { simulatedToday: null, bootstrapped: 'yes' }, { simulatedToday: 20261002, bootstrapped: true }]) {
        expect(codeOf(snapshotParser(raw({ settings }))), JSON.stringify(settings)).toBe('SCHEMA_MISMATCH');
      }
      for (const counters of [null, [], {}, { nextId: 3 }, { nextSeq: 1 }, { nextId: '3', nextSeq: 1 }, { nextId: 3.5, nextSeq: 1 }, { nextId: 3, nextSeq: null }]) {
        expect(codeOf(snapshotParser(raw({ counters }))), JSON.stringify(counters)).toBe('SCHEMA_MISMATCH');
      }
    });

    it('names the first fault, with the list, the position of the row and the field', () => {
      const [firstBatch] = rawStoreOf(FULL).batches as unknown[];
      const secondBatch = { id: 21, foodTypeId: 10, quantity: 'many', inboundDate: '2026-10-02', expirationDate: '2026-10-12', createdSeq: 2 };
      const result = snapshotParser(raw({ batches: [firstBatch, secondBatch] }));

      expect(codeOf(result)).toBe('SCHEMA_MISMATCH');
      expect(detailOf(result)).toMatch(/batches.*1.*quantity/);
    });
  });

  describe('the answer is always a value', () => {
    const awkward: unknown[] = [
      undefined, null, 0, '', [], {}, [[]], { foodCategories: 5 }, { batches: [{ id: 1 }] },
      { ...rawStoreOf(FULL), batches: [null, undefined, 5] },
      { ...rawStoreOf(FULL), settings: { simulatedToday: { toString: () => 'x' }, bootstrapped: true } },
      JSON.parse('{"__proto__": {"foodCategories": []}}'),
      Object.create(null),
    ];

    it('is a snapshot or a code of the shape family, and nothing is thrown', () => {
      for (const document of awkward) {
        let result: Result<Snapshot, DomainError> | undefined;
        expect(() => {
          result = snapshotParser(document as RawStore | null);
        }).not.toThrow();
        if (result?.ok === false) expect(ERROR_FAMILY_OF[result.err.code]).toBe('shape');
        expect(result?.ok).not.toBeUndefined();
      }
    });

    it('gives only the two codes this parser owns', () => {
      for (const document of awkward) {
        const result = snapshotParser(document as RawStore | null);
        if (!result.ok) expect(['CORRUPT_STORE', 'SCHEMA_MISMATCH']).toContain(result.err.code);
      }
    });
  });

  it('gives the same answer twice and leaves the document alone', () => {
    const document = rawStoreOf(FULL);
    const before = JSON.stringify(document);

    expect(snapshotParser(document)).toEqual(snapshotParser(document));
    expect(JSON.stringify(document)).toBe(before);
  });

  it('does not hand back the document it was given: the snapshot is a new value', () => {
    const document = rawStoreOf(FULL);
    const out = snapshotParser(document);

    expect(out.ok && out.value.batches === (document.batches as unknown)).toBe(false);
  });
});
