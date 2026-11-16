import { describe, expect, it } from 'vitest';
import { EMPTY_SNAPSHOT } from '@freshrescue/contract-entities';
import type { FoodType } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { buildBatch, buildFoodCategory, buildFoodType, buildRecipe, buildSnapshot } from '../../testing/fixtures';
import { nameValidator } from '../foundation/nameValidator';
import { foodTypeResolver } from './foodTypeResolver';
import type { Resolved } from './foodTypeResolver';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

const MILK = buildFoodType({ id: 30, name: 'Milk', unit: 'ml' });
const TOMATO = buildFoodType({ id: 31, name: 'Tomato', unit: 'pieces' });
const CREME = buildFoodType({ id: 32, name: 'Crème fraîche' });

/** Three Food Types, and a category, a recipe and a batch that carry names or ids of their own. */
const snapshot = buildSnapshot({
  foodCategories: [buildFoodCategory({ id: 10, name: 'Dairy' })],
  foodTypes: [MILK, TOMATO, CREME],
  batches: [buildBatch({ id: 40, foodTypeId: 30 })],
  recipes: [buildRecipe({ id: 50, name: 'Milk Pudding' })],
});

const existing = (foodType: FoodType): Resolved => ({ kind: 'existing', foodType });

describe('BC-28 FoodTypeResolver', () => {
  describe('by id', () => {
    it('finds the Food Type, which carries its whole record', () => {
      expect(valueOf(foodTypeResolver(30, null, snapshot))).toEqual(existing(MILK));
    });

    it('is FOOD_TYPE_NOT_FOUND for an id that is not a Food Type, whatever else the id names', () => {
      for (const id of [999, 10, 40, 50]) {
        expect(errorOf(foodTypeResolver(id, null, snapshot)).code).toBe('FOOD_TYPE_NOT_FOUND');
      }
    });

    it('prefers the id when a name comes with it, although CommandParser never lets both through', () => {
      expect(valueOf(foodTypeResolver(31, 'milk', snapshot))).toEqual(existing(TOMATO));
      expect(errorOf(foodTypeResolver(999, 'Milk', snapshot)).code).toBe('FOOD_TYPE_NOT_FOUND');
    });
  });

  describe('by name: a match selects the Food Type, and is not a duplicate (spec exception row 18)', () => {
    it('finds a Food Type by its exact name', () => {
      expect(valueOf(foodTypeResolver(null, 'Milk', snapshot))).toEqual(existing(MILK));
    });

    it('ignores the case: milk, MILK and mIlK are the same Food Type', () => {
      for (const typed of ['milk', 'MILK', 'mIlK']) {
        expect(valueOf(foodTypeResolver(null, typed, snapshot))).toEqual(existing(MILK));
      }
    });

    it('ignores the spaces around the name, as NameValidator trims them', () => {
      expect(valueOf(foodTypeResolver(null, '  Milk\t', snapshot))).toEqual(existing(MILK));
      expect(valueOf(foodTypeResolver(null, '\nTOMATO ', snapshot))).toEqual(existing(TOMATO));
    });

    it('ignores the case of letters beyond ASCII too', () => {
      expect(valueOf(foodTypeResolver(null, 'CRÈME FRAÎCHE', snapshot))).toEqual(existing(CREME));
    });

    it('returns the Food Type as it is stored, with its stored spelling and its unit', () => {
      const resolved = valueOf(foodTypeResolver(null, 'tomato', snapshot));

      expect(resolved).toEqual({ kind: 'existing', foodType: { id: 31, name: 'Tomato', categoryId: 1, unit: 'pieces', customThresholdDays: null } });
    });
  });

  describe('by name: no match is a new Food Type, and nothing is matched loosely (spec exception row 18)', () => {
    it('makes a new Food Type of a name that no Food Type has, and keeps the name as it was typed', () => {
      expect(valueOf(foodTypeResolver(null, 'Mango', snapshot))).toEqual({ kind: 'new', name: 'Mango' });
      expect(valueOf(foodTypeResolver(null, '  Mango ', snapshot))).toEqual({ kind: 'new', name: '  Mango ' });
    });

    it('does not take a plural, a typo, a part of a name or a longer name for a match', () => {
      for (const typed of ['Tomatoes', 'Tomat', 'Tom', 'Mlik', 'Mil', 'ilk', 'Milk shake', 'Mi lk', 'Milk2', 'Creme fraiche']) {
        expect(valueOf(foodTypeResolver(null, typed, snapshot))).toEqual({ kind: 'new', name: typed });
      }
    });

    it('does not take the name of a category or a recipe for a Food Type: the scopes are independent (spec section 3)', () => {
      expect(valueOf(foodTypeResolver(null, 'Dairy', snapshot))).toEqual({ kind: 'new', name: 'Dairy' });
      expect(valueOf(foodTypeResolver(null, 'Milk Pudding', snapshot))).toEqual({ kind: 'new', name: 'Milk Pudding' });
    });

    it('makes a new Food Type of any name when the store has none', () => {
      expect(valueOf(foodTypeResolver(null, 'Milk', EMPTY_SNAPSHOT))).toEqual({ kind: 'new', name: 'Milk' });
    });
  });

  describe('no id and no name: an empty name (spec exception row 3)', () => {
    it('gives a new Food Type with the empty name, which is what a form with its name left blank sends', () => {
      expect(valueOf(foodTypeResolver(null, null, snapshot))).toEqual({ kind: 'new', name: '' });
    });

    it('is not an error here: NameValidator turns the empty name into NAME_EMPTY (422)', () => {
      const resolved = valueOf(foodTypeResolver(null, null, snapshot));

      expect(resolved.kind).toBe('new');
      expect(nameValidator(resolved.kind === 'new' ? resolved.name : 'unexpected', 'foodType', snapshot, null)).toMatchObject({
        ok: false,
        err: { code: 'NAME_EMPTY' },
      });
    });

    it('treats a name of blanks as a new Food Type too, and NameValidator answers NAME_EMPTY for it as well', () => {
      const resolved = valueOf(foodTypeResolver(null, '   \t', snapshot));

      expect(resolved).toEqual({ kind: 'new', name: '   \t' });
      expect(nameValidator('   \t', 'foodType', snapshot, null)).toMatchObject({ ok: false, err: { code: 'NAME_EMPTY' } });
    });

    it('gives the empty name for an empty store as well', () => {
      expect(valueOf(foodTypeResolver(null, null, EMPTY_SNAPSHOT))).toEqual({ kind: 'new', name: '' });
    });
  });

  it('never edits the snapshot it is given', () => {
    const before = structuredClone(snapshot);

    foodTypeResolver(30, null, snapshot);
    foodTypeResolver(null, 'milk', snapshot);
    foodTypeResolver(null, null, snapshot);
    foodTypeResolver(999, null, snapshot);

    expect(snapshot).toEqual(before);
  });
});
