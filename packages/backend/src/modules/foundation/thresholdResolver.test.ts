import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ThresholdMap } from '@freshrescue/contract-views';
import { buildFoodCategory, buildFoodType, buildSnapshot, OTHER_FOOD_CATEGORY } from '../../testing/fixtures';
import { thresholdResolver } from './thresholdResolver';

// Meat (3) is a Parent with the Child Poultry (4). Dairy (5) is a Parent with the Child Liquid Dairy (6).
const tree = (thresholds: { meat?: number; poultry?: number; dairy?: number; liquidDairy?: number } = {}) => [
  buildFoodCategory({ id: 3, name: 'Meat', customThresholdDays: thresholds.meat ?? null }),
  buildFoodCategory({ id: 4, name: 'Poultry', parentId: 3, customThresholdDays: thresholds.poultry ?? null }),
  buildFoodCategory({ id: 5, name: 'Dairy', customThresholdDays: thresholds.dairy ?? null }),
  buildFoodCategory({ id: 6, name: 'Liquid Dairy', parentId: 5, customThresholdDays: thresholds.liquidDairy ?? null }),
];

describe('BC-07 ThresholdResolver', () => {
  describe('the precedence of spec 4.3.1: Food Type, then Child, then Parent, then the global 3 days', () => {
    it('lets the Food Type win over every other level, and reports foodType', () => {
      const snapshot = buildSnapshot({
        foodCategories: tree({ meat: 5, poultry: 2 }),
        foodTypes: [buildFoodType({ id: 10, name: 'Chicken', categoryId: 4, customThresholdDays: 1 })],
      });

      expect(thresholdResolver(snapshot)[10]).toEqual({ days: 1, source: 'foodType' });
    });

    it('lets the Child win over the Parent when the Food Type has none, and reports child', () => {
      const snapshot = buildSnapshot({
        foodCategories: tree({ meat: 5, poultry: 2 }),
        foodTypes: [buildFoodType({ id: 10, name: 'Chicken', categoryId: 4 })],
      });

      expect(thresholdResolver(snapshot)[10]).toEqual({ days: 2, source: 'child' });
    });

    it('falls to the Parent of the assigned Child when the Child has none, and reports parent', () => {
      const snapshot = buildSnapshot({
        foodCategories: tree({ meat: 5 }),
        foodTypes: [buildFoodType({ id: 10, name: 'Chicken', categoryId: 4 })],
      });

      expect(thresholdResolver(snapshot)[10]).toEqual({ days: 5, source: 'parent' });
    });

    it('uses the Parent that the Food Type is assigned to directly, and reports parent', () => {
      const snapshot = buildSnapshot({
        foodCategories: tree({ meat: 5 }),
        foodTypes: [buildFoodType({ id: 10, name: 'Beef', categoryId: 3 })],
      });

      expect(thresholdResolver(snapshot)[10]).toEqual({ days: 5, source: 'parent' });
    });

    it('falls to the global default of 3 days when nothing is set, and reports global', () => {
      const snapshot = buildSnapshot({
        foodCategories: tree(),
        foodTypes: [
          buildFoodType({ id: 10, name: 'Chicken', categoryId: 4 }),
          buildFoodType({ id: 11, name: 'Beef', categoryId: 3 }),
          buildFoodType({ id: 12, name: 'Salt' }),
        ],
      });

      for (const id of [10, 11, 12]) expect(thresholdResolver(snapshot)[id]).toEqual({ days: 3, source: 'global' });
    });

    it('walks the whole ladder as each level is taken away', () => {
      const food = (customThresholdDays: number | null) => buildFoodType({ id: 10, name: 'Chicken', categoryId: 4, customThresholdDays });
      const ladder = [
        [tree({ meat: 7, poultry: 5 }), food(1), { days: 1, source: 'foodType' }],
        [tree({ meat: 7, poultry: 5 }), food(null), { days: 5, source: 'child' }],
        [tree({ meat: 7 }), food(null), { days: 7, source: 'parent' }],
        [tree(), food(null), { days: 3, source: 'global' }],
      ] as const;

      for (const [foodCategories, foodType, expected] of ladder) {
        expect(thresholdResolver(buildSnapshot({ foodCategories, foodTypes: [foodType] }))[10]).toEqual(expected);
      }
    });

    it('ignores the threshold of a Child that belongs to another Parent', () => {
      const snapshot = buildSnapshot({
        foodCategories: tree({ dairy: 9, liquidDairy: 8 }),
        foodTypes: [buildFoodType({ id: 10, name: 'Chicken', categoryId: 4 })],
      });

      expect(thresholdResolver(snapshot)[10]).toEqual({ days: 3, source: 'global' });
    });
  });

  describe('Other', () => {
    it('gives a Food Type in Other its own threshold or the global one, and nothing between', () => {
      const snapshot = buildSnapshot({
        foodTypes: [
          buildFoodType({ id: 10, name: 'Egg', customThresholdDays: 6 }),
          buildFoodType({ id: 11, name: 'Rice' }),
        ],
      });

      expect(thresholdResolver(snapshot)[10]).toEqual({ days: 6, source: 'foodType' });
      expect(thresholdResolver(snapshot)[11]).toEqual({ days: 3, source: 'global' });
    });

    it('never takes a threshold from Other, even if one were stored on it', () => {
      const snapshot = buildSnapshot({
        foodCategories: [],
        foodTypes: [buildFoodType({ id: 10, name: 'Rice' })],
      });
      const odd = { ...snapshot, foodCategories: [{ ...OTHER_FOOD_CATEGORY, customThresholdDays: 9 }] };

      expect(thresholdResolver(odd)[10]).toEqual({ days: 3, source: 'global' });
    });
  });

  describe('every Food Type has an entry, and nothing else does', () => {
    it('keys the map by Food Type id and keeps a Food Type that has no batches', () => {
      const snapshot = buildSnapshot({
        foodCategories: tree({ meat: 4 }),
        foodTypes: [buildFoodType({ id: 10, name: 'Beef', categoryId: 3 }), buildFoodType({ id: 11, name: 'Milk', categoryId: 6 })],
      });

      expect(Object.keys(thresholdResolver(snapshot)).sort()).toEqual(['10', '11']);
    });

    it('is empty when there is no Food Type, and a lookup of an id that is not there reads as undefined', () => {
      const map = thresholdResolver(buildSnapshot());

      expect(map).toEqual({});
      expect(map[10]).toBeUndefined();
    });

    it('gives each Food Type of one category the same level, unless it has its own', () => {
      const snapshot = buildSnapshot({
        foodCategories: tree({ poultry: 2 }),
        foodTypes: [
          buildFoodType({ id: 10, name: 'Chicken', categoryId: 4 }),
          buildFoodType({ id: 11, name: 'Duck', categoryId: 4 }),
          buildFoodType({ id: 12, name: 'Goose', categoryId: 4, customThresholdDays: 6 }),
        ],
      });
      const map = thresholdResolver(snapshot);

      expect([map[10], map[11], map[12]]).toEqual([
        { days: 2, source: 'child' },
        { days: 2, source: 'child' },
        { days: 6, source: 'foodType' },
      ]);
    });
  });

  describe('a store that is not consistent still gets an answer', () => {
    it('uses the global default for a Food Type whose category is not there', () => {
      const snapshot = buildSnapshot({ foodTypes: [buildFoodType({ id: 10, name: 'Chicken', categoryId: 404 })] });

      expect(thresholdResolver(snapshot)[10]).toEqual({ days: 3, source: 'global' });
    });

    it('keeps the threshold of a Child whose Parent is not there, and falls to global when the Child has none', () => {
      const withOwn = buildSnapshot({
        foodCategories: [buildFoodCategory({ id: 4, name: 'Poultry', parentId: 404, customThresholdDays: 2 })],
        foodTypes: [buildFoodType({ id: 10, name: 'Chicken', categoryId: 4 })],
      });
      const without = buildSnapshot({
        foodCategories: [buildFoodCategory({ id: 4, name: 'Poultry', parentId: 404 })],
        foodTypes: [buildFoodType({ id: 10, name: 'Chicken', categoryId: 4 })],
      });

      expect(thresholdResolver(withOwn)[10]).toEqual({ days: 2, source: 'child' });
      expect(thresholdResolver(without)[10]).toEqual({ days: 3, source: 'global' });
    });
  });

  it('is derived again from the snapshot each time: deleting a threshold changes the answer at once (spec 4.6)', () => {
    const food = buildFoodType({ id: 10, name: 'Chicken', categoryId: 4 });
    const before = thresholdResolver(buildSnapshot({ foodCategories: tree({ poultry: 2 }), foodTypes: [food] }));
    const after = thresholdResolver(buildSnapshot({ foodCategories: tree(), foodTypes: [food] }));

    expect(before[10]).toEqual({ days: 2, source: 'child' });
    expect(after[10]).toEqual({ days: 3, source: 'global' });
  });

  it('returns a ThresholdMap and leaves the snapshot alone', () => {
    const snapshot = buildSnapshot({ foodCategories: tree({ meat: 5 }), foodTypes: [buildFoodType({ id: 10, name: 'Beef', categoryId: 3 })] });
    const before = JSON.stringify(snapshot);

    expectTypeOf(thresholdResolver).returns.toEqualTypeOf<ThresholdMap>();
    expect(thresholdResolver(snapshot)).toEqual(thresholdResolver(snapshot));
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
