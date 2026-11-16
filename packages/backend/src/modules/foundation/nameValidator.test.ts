import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result, ValidName } from '@freshrescue/contract-primitives';
import {
  buildFoodCategory,
  buildFoodType,
  buildRecipe,
  buildRecipeCategory,
  buildSnapshot,
} from '../../testing/fixtures';
import { nameValidator } from './nameValidator';

const snapshot = buildSnapshot({
  foodCategories: [
    buildFoodCategory({ id: 3, name: 'Meat' }),
    buildFoodCategory({ id: 4, name: 'Poultry', parentId: 3 }),
  ],
  foodTypes: [buildFoodType({ id: 10, name: 'Milk' }), buildFoodType({ id: 11, name: 'Chicken', categoryId: 4 })],
  recipeCategories: [buildRecipeCategory({ id: 5, name: 'French Cuisine' })],
  recipes: [buildRecipe({ id: 20, name: 'Tomato Egg Stir-Fry' })],
});

const codeOf = (result: Result<unknown, DomainError>): string => (result.ok ? 'ok' : result.err.code);
const nameOf = (result: Result<ValidName, DomainError>): string | undefined => (result.ok ? result.value : undefined);

describe('BC-03 NameValidator', () => {
  describe('a valid name', () => {
    it('comes back trimmed, with its case kept, as a ValidName', () => {
      const result = nameValidator('  Oat Milk \t', 'foodType', snapshot);

      expect(result).toEqual({ ok: true, value: 'Oat Milk' });
      expectTypeOf(nameValidator).returns.toEqualTypeOf<Result<ValidName, DomainError>>();
    });

    it('may be 1 character or exactly 200 characters long, measured after trimming', () => {
      expect(nameOf(nameValidator('A', 'foodType', snapshot))).toBe('A');
      expect(nameOf(nameValidator('x'.repeat(200), 'foodType', snapshot))).toBe('x'.repeat(200));
      expect(nameOf(nameValidator(`  ${'x'.repeat(200)}  `, 'foodType', snapshot))).toBe('x'.repeat(200));
    });
  });

  describe('NAME_EMPTY', () => {
    it('blocks an empty name and a name of whitespace only', () => {
      for (const raw of ['', ' ', '   ', '\t\n ']) {
        expect(nameValidator(raw, 'foodType', snapshot)).toMatchObject({ ok: false, err: { code: 'NAME_EMPTY' } });
      }
    });
  });

  describe('NAME_TOO_LONG', () => {
    it('blocks 201 characters, and says how many there were', () => {
      const result = nameValidator('x'.repeat(201), 'recipe', snapshot);

      expect(result).toMatchObject({ ok: false, err: { code: 'NAME_TOO_LONG' } });
      expect(result.ok ? '' : result.err.detail).toContain('201');
    });

    it('counts characters and not UTF-16 units: 200 emoji fit, and 201 do not', () => {
      expect(codeOf(nameValidator('🍎'.repeat(200), 'foodType', snapshot))).toBe('ok');
      expect(codeOf(nameValidator('🍎'.repeat(201), 'foodType', snapshot))).toBe('NAME_TOO_LONG');
    });
  });

  describe('NAME_RESERVED', () => {
    it('reserves Other in both category trees, whatever the case and the spaces', () => {
      for (const raw of ['Other', 'other', 'OTHER', '  Other  ']) {
        expect(codeOf(nameValidator(raw, 'foodCategory', snapshot))).toBe('NAME_RESERVED');
        expect(codeOf(nameValidator(raw, 'cuisine', snapshot))).toBe('NAME_RESERVED');
      }
    });

    it('answers NAME_RESERVED and not NAME_DUPLICATE, although the system category already has the name', () => {
      expect(snapshot.foodCategories.map((category) => category.name)).toContain('Other');
      expect(codeOf(nameValidator('Other', 'foodCategory', snapshot))).toBe('NAME_RESERVED');
    });

    it('keeps Other free for a Food Type and a recipe, because the scopes are independent (spec section 3)', () => {
      expect(codeOf(nameValidator('Other', 'foodType', snapshot))).toBe('ok');
      expect(codeOf(nameValidator('Other', 'recipe', snapshot))).toBe('ok');
    });

    it('blocks a rename of any category to Other (exception row 19), including the system one', () => {
      expect(codeOf(nameValidator('Other', 'foodCategory', snapshot, 3))).toBe('NAME_RESERVED');
      expect(codeOf(nameValidator('Other', 'foodCategory', snapshot, 1))).toBe('NAME_RESERVED');
    });
  });

  describe('NAME_DUPLICATE', () => {
    it('blocks a Food Type name that exists, whatever the case', () => {
      expect(codeOf(nameValidator('Milk', 'foodType', snapshot))).toBe('NAME_DUPLICATE');
      expect(codeOf(nameValidator('milk', 'foodType', snapshot))).toBe('NAME_DUPLICATE');
      expect(codeOf(nameValidator('  MILK ', 'foodType', snapshot))).toBe('NAME_DUPLICATE');
    });

    it('blocks a recipe name that exists, a cuisine name that exists, and a food category name that exists', () => {
      expect(codeOf(nameValidator('tomato egg stir-fry', 'recipe', snapshot))).toBe('NAME_DUPLICATE');
      expect(codeOf(nameValidator('FRENCH CUISINE', 'cuisine', snapshot))).toBe('NAME_DUPLICATE');
      expect(codeOf(nameValidator('meat', 'foodCategory', snapshot))).toBe('NAME_DUPLICATE');
    });

    it('treats a Parent and a Child as one scope: a Child name is taken for a new Parent, and the other way round', () => {
      expect(codeOf(nameValidator('Poultry', 'foodCategory', snapshot))).toBe('NAME_DUPLICATE');
      expect(codeOf(nameValidator('Meat', 'foodCategory', snapshot))).toBe('NAME_DUPLICATE');
    });

    it('keeps the four scopes independent: a Food Type may share its name with a category, a recipe or a cuisine', () => {
      expect(codeOf(nameValidator('Meat', 'foodType', snapshot))).toBe('ok');
      expect(codeOf(nameValidator('Milk', 'foodCategory', snapshot))).toBe('ok');
      expect(codeOf(nameValidator('Milk', 'recipe', snapshot))).toBe('ok');
      expect(codeOf(nameValidator('Tomato Egg Stir-Fry', 'foodType', snapshot))).toBe('ok');
      expect(codeOf(nameValidator('French Cuisine', 'foodCategory', snapshot))).toBe('ok');
    });

    it('compares trimmed names, so a stored name with stray spaces still collides', () => {
      const untidy = buildSnapshot({ foodTypes: [buildFoodType({ id: 10, name: ' Milk ' })] });

      expect(codeOf(nameValidator('milk', 'foodType', untidy))).toBe('NAME_DUPLICATE');
    });
  });

  describe('selfId: the record that is being renamed', () => {
    it('is left out of the duplicate check, so milk to Milk is allowed (spec section 3)', () => {
      expect(nameOf(nameValidator('milk', 'foodType', snapshot, 10))).toBe('milk');
      expect(nameOf(nameValidator('MILK', 'foodType', snapshot, 10))).toBe('MILK');
      expect(nameOf(nameValidator('Milk', 'foodType', snapshot, 10))).toBe('Milk');
    });

    it('does not excuse a name that belongs to another record', () => {
      expect(codeOf(nameValidator('Chicken', 'foodType', snapshot, 10))).toBe('NAME_DUPLICATE');
      expect(codeOf(nameValidator('Meat', 'foodCategory', snapshot, 4))).toBe('NAME_DUPLICATE');
    });

    it('is the same as no selfId when it is null or left out, as in a create', () => {
      expect(codeOf(nameValidator('Milk', 'foodType', snapshot, null))).toBe('NAME_DUPLICATE');
      expect(codeOf(nameValidator('Milk', 'foodType', snapshot, undefined))).toBe('NAME_DUPLICATE');
    });

    it('still applies the other rules to a renamed record', () => {
      expect(codeOf(nameValidator('  ', 'foodType', snapshot, 10))).toBe('NAME_EMPTY');
      expect(codeOf(nameValidator('x'.repeat(201), 'foodType', snapshot, 10))).toBe('NAME_TOO_LONG');
    });
  });

  it('checks empty, then too long, then reserved, then duplicate', () => {
    // 201 characters that are also a duplicate of nothing: too long is reported before any list is searched
    expect(codeOf(nameValidator('x'.repeat(201), 'foodCategory', snapshot))).toBe('NAME_TOO_LONG');
    expect(codeOf(nameValidator('', 'foodCategory', snapshot))).toBe('NAME_EMPTY');
  });

  it('leaves the snapshot alone and gives the same answer twice', () => {
    const before = JSON.stringify(snapshot);

    const first = nameValidator('Almond Milk', 'foodType', snapshot);
    const second = nameValidator('Almond Milk', 'foodType', snapshot);

    expect(first).toEqual(second);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
