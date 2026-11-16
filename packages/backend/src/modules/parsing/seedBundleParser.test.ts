import { describe, expect, expectTypeOf, it } from 'vitest';
import { ERROR_FAMILY_OF } from '@freshrescue/contract-errors';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { SEED_ID_ORDER } from '@freshrescue/contract-seed';
import type { ParsedSeed, SeedBundle } from '@freshrescue/contract-seed';
import { seedBundleParser } from './seedBundleParser';

/** The sample data of spec Appendix A, as the seed file holds it: keys and no ids, quantities in thousandths. */
const APPENDIX_A = {
  foodCategories: [
    { key: 'meat', name: 'Meat', parentKey: null },
    { key: 'red-meat', name: 'Red Meat', parentKey: 'meat' },
    { key: 'poultry', name: 'Poultry', parentKey: 'meat' },
    { key: 'dairy', name: 'Dairy', parentKey: null },
    { key: 'liquid-dairy', name: 'Liquid Dairy', parentKey: 'dairy' },
    { key: 'vegetables', name: 'Vegetables', parentKey: null },
    { key: 'leafy-greens', name: 'Leafy Greens', parentKey: 'vegetables' },
  ],
  cuisines: [
    { key: 'chinese', name: 'Chinese Cuisine' },
    { key: 'vietnamese', name: 'Vietnamese Cuisine' },
    { key: 'french', name: 'French Cuisine' },
  ],
  foodTypes: [
    { key: 'beef', name: 'Beef', categoryKey: 'red-meat', unit: 'grams' },
    { key: 'broccoli', name: 'Broccoli', categoryKey: 'vegetables', unit: 'grams' },
    { key: 'chicken', name: 'Chicken', categoryKey: 'poultry', unit: 'grams' },
    { key: 'egg', name: 'Egg', categoryKey: null, unit: 'pieces' },
    { key: 'milk', name: 'Milk', categoryKey: 'liquid-dairy', unit: 'ml' },
    { key: 'rice', name: 'Rice', categoryKey: null, unit: 'grams' },
    { key: 'spinach', name: 'Spinach', categoryKey: 'leafy-greens', unit: 'grams' },
    { key: 'tomato', name: 'Tomato', categoryKey: 'vegetables', unit: 'pieces' },
  ],
  recipes: [
    {
      key: 'beef-broccoli',
      name: 'Beef and Broccoli Stir-Fry',
      cuisineKey: 'chinese',
      ingredients: [
        { foodTypeKey: 'beef', quantity: 300_000, unit: 'grams' },
        { foodTypeKey: 'broccoli', quantity: 200_000, unit: 'grams' },
      ],
    },
    {
      key: 'chicken-gratin',
      name: 'Chicken Broccoli Gratin',
      cuisineKey: 'french',
      ingredients: [
        { foodTypeKey: 'chicken', quantity: 250_000, unit: 'grams' },
        { foodTypeKey: 'broccoli', quantity: 150_000, unit: 'grams' },
        { foodTypeKey: 'milk', quantity: 100_000, unit: 'ml' },
      ],
    },
    {
      key: 'chicken-fried-rice',
      name: 'Chicken Fried Rice',
      cuisineKey: 'chinese',
      ingredients: [
        { foodTypeKey: 'chicken', quantity: 200_000, unit: 'grams' },
        { foodTypeKey: 'rice', quantity: 300_000, unit: 'grams' },
        { foodTypeKey: 'egg', quantity: 2000, unit: 'pieces' },
      ],
    },
    {
      key: 'spinach-omelette',
      name: 'Spinach Omelette',
      cuisineKey: 'french',
      ingredients: [
        { foodTypeKey: 'egg', quantity: 3000, unit: 'pieces' },
        { foodTypeKey: 'spinach', quantity: 50_000, unit: 'grams' },
        { foodTypeKey: 'milk', quantity: 50_000, unit: 'ml' },
      ],
    },
    {
      key: 'tomato-egg',
      name: 'Tomato Egg Stir-Fry',
      cuisineKey: 'chinese',
      ingredients: [
        { foodTypeKey: 'tomato', quantity: 2000, unit: 'pieces' },
        { foodTypeKey: 'egg', quantity: 3000, unit: 'pieces' },
      ],
    },
    {
      key: 'vietnamese-chicken-rice',
      name: 'Vietnamese Chicken Rice',
      cuisineKey: 'vietnamese',
      ingredients: [
        { foodTypeKey: 'chicken', quantity: 250_000, unit: 'grams' },
        { foodTypeKey: 'rice', quantity: 300_000, unit: 'grams' },
      ],
    },
  ],
} satisfies SeedBundle;

const EMPTY = { foodCategories: [], cuisines: [], foodTypes: [], recipes: [] } satisfies SeedBundle;

/** A copy of the seed with changes made to it, so that each case starts from the valid one. */
const edit = (change: (seed: Record<string, unknown[]>) => void, from: object = APPENDIX_A): unknown => {
  const copy = JSON.parse(JSON.stringify(from)) as Record<string, unknown[]>;
  change(copy);
  return copy;
};
const codeOf = (result: Result<unknown, DomainError>): string => (result.ok ? 'ok' : result.err.code);
const detailOf = (result: Result<unknown, DomainError>): string => (result.ok ? '' : (result.err.detail ?? ''));
const row = (seed: Record<string, unknown[]>, list: string, index = 0): Record<string, unknown> => (seed[list]?.[index] ?? {}) as Record<string, unknown>;

const LISTS = ['foodCategories', 'cuisines', 'foodTypes', 'recipes'] as const;
const FIELDS: Record<(typeof LISTS)[number], string[]> = {
  foodCategories: ['key', 'name', 'parentKey'],
  cuisines: ['key', 'name'],
  foodTypes: ['key', 'name', 'categoryKey', 'unit'],
  recipes: ['key', 'name', 'cuisineKey', 'ingredients'],
};
const everyField = LISTS.flatMap((list) => FIELDS[list].map((field): [string, string] => [list, field]));

describe('BP-04 SeedBundleParser', () => {
  describe('a valid seed', () => {
    it('parses the sample data of Appendix A: 7 food categories, 3 cuisines, 8 Food Types and 6 recipes', () => {
      const result = seedBundleParser(APPENDIX_A);

      expect(result).toEqual({ ok: true, value: { ...APPENDIX_A, idDemand: 24 } });
      expect(APPENDIX_A.foodCategories).toHaveLength(7);
      expect(APPENDIX_A.cuisines).toHaveLength(3);
      expect(APPENDIX_A.foodTypes).toHaveLength(8);
      expect(APPENDIX_A.recipes).toHaveLength(6);
    });

    it('counts one id for each food category, cuisine, Food Type and recipe, and none for an ingredient row', () => {
      const result = seedBundleParser(APPENDIX_A);

      expect(result.ok ? result.value.idDemand : -1).toBe(7 + 3 + 8 + 6);
      expect(APPENDIX_A.recipes.flatMap((recipe) => recipe.ingredients)).toHaveLength(15);
    });

    it('counts the lists of SEED_ID_ORDER, which is what SeedPlanner consumes', () => {
      expect([...SEED_ID_ORDER]).toEqual(['foodCategories', 'cuisines', 'foodTypes', 'recipes']);
    });

    it('is happy with an empty seed, which needs no id', () => {
      expect(seedBundleParser(EMPTY)).toEqual({ ok: true, value: { ...EMPTY, idDemand: 0 } });
    });

    it('takes null as the key of the system category Other, for a Food Type, a recipe and a food category', () => {
      const seed: SeedBundle = {
        ...EMPTY,
        foodCategories: [{ key: 'meat', name: 'Meat', parentKey: null }],
        foodTypes: [{ key: 'salt', name: 'Salt', categoryKey: null, unit: 'grams' }],
        recipes: [{ key: 'brine', name: 'Brine', cuisineKey: null, ingredients: [{ foodTypeKey: 'salt', quantity: 1000, unit: 'grams' }] }],
      };

      expect(seedBundleParser(seed)).toEqual({ ok: true, value: { ...seed, idDemand: 3 } });
    });

    it('keeps each list in the order of the file, which is the order that ids are taken in', () => {
      const result = seedBundleParser(edit((seed) => seed.foodTypes?.reverse()));

      expect(result.ok ? result.value.foodTypes.map((food) => food.key) : []).toEqual(['tomato', 'spinach', 'rice', 'milk', 'egg', 'chicken', 'broccoli', 'beef']);
    });

    it('drops a field that the bundle does not have, in the document and in a row', () => {
      const seed = edit((s) => {
        s.$schema = ['x'];
        row(s, 'foodTypes').note = 'cold';
        row(s, 'recipes').source = 'book';
      });

      expect(seedBundleParser(seed)).toEqual({ ok: true, value: { ...APPENDIX_A, idDemand: 24 } });
    });

    it('returns a Result of a ParsedSeed', () => {
      expectTypeOf(seedBundleParser).returns.toEqualTypeOf<Result<ParsedSeed, DomainError>>();
    });
  });

  describe('BAD_SEED', () => {
    it('answers it for a document that is not an object', () => {
      for (const document of [undefined, null, 'seed', '', 5, true, [], [APPENDIX_A]]) {
        expect(seedBundleParser(document), JSON.stringify(document)).toMatchObject({ ok: false, err: { code: 'BAD_SEED' } });
      }
    });

    it('answers it for an empty object, and for an object of other things', () => {
      expect(codeOf(seedBundleParser({}))).toBe('BAD_SEED');
      expect(codeOf(seedBundleParser({ foodTypes: [] }))).toBe('BAD_SEED');
    });

    it.each(LISTS)('answers it for a seed without %s, and names it', (list) => {
      const result = seedBundleParser(edit((seed) => delete seed[list]));

      expect(codeOf(result)).toBe('BAD_SEED');
      expect(detailOf(result)).toContain(list);
    });

    it.each(LISTS)('answers it when %s is not a list', (list) => {
      for (const wrong of [null, {}, 'rows', 5, true]) {
        expect(codeOf(seedBundleParser({ ...APPENDIX_A, [list]: wrong })), JSON.stringify(wrong)).toBe('BAD_SEED');
      }
    });

    it.each(LISTS)('answers it when a row of %s is not an object', (list) => {
      for (const wrong of [null, 5, 'row', [], true]) {
        expect(codeOf(seedBundleParser({ ...APPENDIX_A, [list]: [wrong] })), JSON.stringify(wrong)).toBe('BAD_SEED');
      }
    });

    it.each(everyField)('answers it for a row of %s without its %s, and names the field', (list, field) => {
      const result = seedBundleParser(edit((seed) => delete row(seed, list)[field]));

      expect(codeOf(result)).toBe('BAD_SEED');
      expect(detailOf(result)).toContain(field);
    });

    it.each(everyField)('answers it for a row of %s whose %s is an object, which is no kind of value for it', (list, field) => {
      expect(codeOf(seedBundleParser(edit((seed) => { row(seed, list)[field] = { x: 1 }; })))).toBe('BAD_SEED');
    });

    it('answers it for a key or a name that is empty or is not text: a key must name something', () => {
      for (const value of ['', 5, null, true]) {
        expect(codeOf(seedBundleParser(edit((seed) => { row(seed, 'foodTypes').key = value; }))), JSON.stringify(value)).toBe('BAD_SEED');
        expect(codeOf(seedBundleParser(edit((seed) => { row(seed, 'recipes').name = value; }))), JSON.stringify(value)).toBe('BAD_SEED');
      }
    });

    it('answers it for a key that is empty where it names another record, which is not the same as null', () => {
      expect(codeOf(seedBundleParser(edit((seed) => { row(seed, 'foodTypes').categoryKey = ''; })))).toBe('BAD_SEED');
      expect(codeOf(seedBundleParser(edit((seed) => { row(seed, 'foodTypes').categoryKey = null; })))).toBe('ok');
    });

    it('answers it for a quantity that is not a whole number of thousandths, or is text: there is no conversion', () => {
      const quantity = (value: unknown) => edit((seed) => { ((row(seed, 'recipes').ingredients as unknown[])[0] as Record<string, unknown>).quantity = value; });

      for (const value of ['300000', 300.5, null, true, {}, Number.NaN]) {
        expect(codeOf(seedBundleParser(quantity(value))), JSON.stringify(value)).toBe('BAD_SEED');
      }
      expect(codeOf(seedBundleParser(quantity(300_000)))).toBe('ok');
    });

    it('answers it for an ingredient that lacks a field, and for ingredients that are not a list', () => {
      const ingredient = (change: (i: Record<string, unknown>) => void) => edit((seed) => change((row(seed, 'recipes').ingredients as Record<string, unknown>[])[0] ?? {}));

      expect(codeOf(seedBundleParser(ingredient((i) => delete i.foodTypeKey)))).toBe('BAD_SEED');
      expect(codeOf(seedBundleParser(ingredient((i) => delete i.quantity)))).toBe('BAD_SEED');
      expect(codeOf(seedBundleParser(ingredient((i) => delete i.unit)))).toBe('BAD_SEED');
      expect(codeOf(seedBundleParser(edit((seed) => { row(seed, 'recipes').ingredients = 'beef'; })))).toBe('BAD_SEED');
    });

    it('names the first fault, with the list, the position of the row and the field', () => {
      const result = seedBundleParser(edit((seed) => { row(seed, 'foodTypes', 2).unit = 5; }));

      expect(detailOf(result)).toMatch(/foodTypes.*2.*unit/);
    });

    it('judges the shape only: a name, a unit or a quantity that is the right type but is not allowed is left for the invariant checker', () => {
      const odd = edit((seed) => {
        row(seed, 'foodTypes').unit = 'cups';
        row(seed, 'foodTypes').name = 'x'.repeat(500);
        ((row(seed, 'recipes').ingredients as Record<string, unknown>[])[0] as Record<string, unknown>).quantity = 0;
        row(seed, 'recipes', 1).ingredients = [];
      });

      expect(codeOf(seedBundleParser(odd))).toBe('ok');
    });
  });

  describe('DUP_SEED_KEY', () => {
    it.each(LISTS)('answers it for a key that %s uses twice, and names the list and the key', (list) => {
      const result = seedBundleParser(edit((seed) => {
        const first = row(seed, list, 0);
        seed[list]?.push({ ...(row(seed, list, 1)), key: first.key });
      }));

      expect(codeOf(result)).toBe('DUP_SEED_KEY');
      expect(detailOf(result)).toContain(list);
      expect(detailOf(result)).toContain(String(row(APPENDIX_A as unknown as Record<string, unknown[]>, list).key));
    });

    it('compares keys as written: two keys that differ only in case are two keys', () => {
      const loud = edit((seed) => seed.foodTypes?.push({ key: 'BEEF', name: 'Beef Jerky', categoryKey: null, unit: 'grams' }));

      expect(codeOf(seedBundleParser(loud))).toBe('ok');
    });

    it('lets one key stand in two lists, because a key is looked up only in the list that it names', () => {
      const seed = edit((s) => {
        row(s, 'foodCategories', 3).key = 'milk';
        for (const type of s.foodTypes as Record<string, unknown>[]) if (type.categoryKey === 'dairy') type.categoryKey = 'milk';
        row(s, 'foodCategories', 4).parentKey = 'milk';
      });

      expect(codeOf(seedBundleParser(seed))).toBe('ok');
    });
  });

  describe('SEED_BAD_CATEGORY', () => {
    it('answers it for a Child that names a parent which is not there', () => {
      const result = seedBundleParser(edit((seed) => { row(seed, 'foodCategories', 1).parentKey = 'fish'; }));

      expect(codeOf(result)).toBe('SEED_BAD_CATEGORY');
      expect(detailOf(result)).toContain('red-meat');
      expect(detailOf(result)).toContain('fish');
    });

    it('answers it for a Food Type that names a category which is not there', () => {
      const result = seedBundleParser(edit((seed) => { row(seed, 'foodTypes').categoryKey = 'fish'; }));

      expect(codeOf(result)).toBe('SEED_BAD_CATEGORY');
      expect(detailOf(result)).toContain('beef');
    });

    it('answers it for a recipe that names a cuisine which is not there', () => {
      const result = seedBundleParser(edit((seed) => { row(seed, 'recipes').cuisineKey = 'italian'; }));

      expect(codeOf(result)).toBe('SEED_BAD_CATEGORY');
      expect(detailOf(result)).toContain('italian');
    });

    it('takes a key of the wrong list for no key: a Food Type cannot name a cuisine, and a recipe cannot name a food category', () => {
      expect(codeOf(seedBundleParser(edit((seed) => { row(seed, 'foodTypes').categoryKey = 'chinese'; })))).toBe('SEED_BAD_CATEGORY');
      expect(codeOf(seedBundleParser(edit((seed) => { row(seed, 'recipes').cuisineKey = 'meat'; })))).toBe('SEED_BAD_CATEGORY');
      expect(codeOf(seedBundleParser(edit((seed) => { row(seed, 'foodCategories', 1).parentKey = 'chinese'; })))).toBe('SEED_BAD_CATEGORY');
    });

    it('compares keys as written: a key that differs in case is another key', () => {
      expect(codeOf(seedBundleParser(edit((seed) => { row(seed, 'foodTypes').categoryKey = 'RED-MEAT'; })))).toBe('SEED_BAD_CATEGORY');
    });
  });

  describe('SEED_BAD_FOODTYPE', () => {
    it('answers it for an ingredient that names a Food Type which is not there, and names the recipe and the key', () => {
      const result = seedBundleParser(edit((seed) => {
        ((row(seed, 'recipes', 3).ingredients as Record<string, unknown>[])[1] as Record<string, unknown>).foodTypeKey = 'kale';
      }));

      expect(codeOf(result)).toBe('SEED_BAD_FOODTYPE');
      expect(detailOf(result)).toContain('spinach-omelette');
      expect(detailOf(result)).toContain('kale');
    });

    it('takes a key of the wrong list for no key: an ingredient cannot name a food category', () => {
      const result = seedBundleParser(edit((seed) => {
        ((row(seed, 'recipes').ingredients as Record<string, unknown>[])[0] as Record<string, unknown>).foodTypeKey = 'meat';
      }));

      expect(codeOf(result)).toBe('SEED_BAD_FOODTYPE');
    });
  });

  describe('the order of the checks', () => {
    const FAULTS = {
      shape: (seed: Record<string, unknown[]>) => delete row(seed, 'cuisines').name,
      duplicate: (seed: Record<string, unknown[]>) => seed.foodTypes?.push({ ...row(seed, 'foodTypes') }),
      category: (seed: Record<string, unknown[]>) => { row(seed, 'foodTypes', 1).categoryKey = 'fish'; },
      foodType: (seed: Record<string, unknown[]>) => { ((row(seed, 'recipes').ingredients as Record<string, unknown>[])[0] as Record<string, unknown>).foodTypeKey = 'kale'; },
    };
    const withFaults = (...names: (keyof typeof FAULTS)[]) => edit((seed) => names.forEach((name) => FAULTS[name](seed)));

    it('reads the shape first, then the duplicate keys, then the categories, then the Food Types', () => {
      expect(codeOf(seedBundleParser(withFaults('shape', 'duplicate', 'category', 'foodType')))).toBe('BAD_SEED');
      expect(codeOf(seedBundleParser(withFaults('duplicate', 'category', 'foodType')))).toBe('DUP_SEED_KEY');
      expect(codeOf(seedBundleParser(withFaults('category', 'foodType')))).toBe('SEED_BAD_CATEGORY');
      expect(codeOf(seedBundleParser(withFaults('foodType')))).toBe('SEED_BAD_FOODTYPE');
    });

    it('is the first fault that counts: each fault alone gives its own code', () => {
      expect(codeOf(seedBundleParser(withFaults('shape')))).toBe('BAD_SEED');
      expect(codeOf(seedBundleParser(withFaults('duplicate')))).toBe('DUP_SEED_KEY');
      expect(codeOf(seedBundleParser(withFaults('category')))).toBe('SEED_BAD_CATEGORY');
      expect(codeOf(seedBundleParser(withFaults()))).toBe('ok');
    });
  });

  describe('the answer is always a value', () => {
    const awkward: unknown[] = [
      undefined, null, 0, '', [], {}, [[]], { foodCategories: 5 }, { recipes: [{ ingredients: [null] }] },
      { ...APPENDIX_A, recipes: [null, undefined, 5] },
      JSON.parse('{"__proto__": {"recipes": []}}'),
      Object.create(null),
      { foodCategories: [], cuisines: [], foodTypes: [], recipes: [{ key: 'a', name: 'A', cuisineKey: null, ingredients: [{ foodTypeKey: 'constructor', quantity: 1, unit: 'g' }] }] },
    ];

    it('is a parsed seed or a code of the shape family, and nothing is thrown', () => {
      for (const document of awkward) {
        let result: Result<ParsedSeed, DomainError> | undefined;
        expect(() => {
          result = seedBundleParser(document);
        }).not.toThrow();
        if (result?.ok === false) expect(ERROR_FAMILY_OF[result.err.code]).toBe('shape');
        expect(result?.ok).not.toBeUndefined();
      }
    });

    it('gives only the four codes this parser owns', () => {
      const owned = ['BAD_SEED', 'DUP_SEED_KEY', 'SEED_BAD_CATEGORY', 'SEED_BAD_FOODTYPE'];

      for (const document of awkward) {
        const result = seedBundleParser(document);
        if (!result.ok) expect(owned).toContain(result.err.code);
      }
    });

    it('does not take the name of a property of every object for a key that exists', () => {
      expect(codeOf(seedBundleParser(awkward[awkward.length - 1]))).toBe('SEED_BAD_FOODTYPE');
    });
  });

  it('gives the same answer twice and leaves the document alone', () => {
    const document = edit(() => undefined);
    const before = JSON.stringify(document);

    expect(seedBundleParser(document)).toEqual(seedBundleParser(document));
    expect(JSON.stringify(document)).toBe(before);
  });
});
