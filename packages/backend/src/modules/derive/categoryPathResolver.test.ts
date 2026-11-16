import { describe, expect, it } from 'vitest';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import { buildFoodCategory, buildFoodType, buildSnapshot } from '../../testing/fixtures';
import { categoryPathResolver } from './categoryPathResolver';

// Meat (3) is a Parent with the Child Poultry (4). Vegetables (5) is a Parent without a Child that is used here.
// Dairy (6) is a Parent with the Child Liquid Dairy (7).
const categories = [
  buildFoodCategory({ id: 3, name: 'Meat' }),
  buildFoodCategory({ id: 4, name: 'Poultry', parentId: 3 }),
  buildFoodCategory({ id: 5, name: 'Vegetables' }),
  buildFoodCategory({ id: 6, name: 'Dairy' }),
  buildFoodCategory({ id: 7, name: 'Liquid Dairy', parentId: 6 }),
];
const snapshot = buildSnapshot({
  foodCategories: categories,
  foodTypes: [
    buildFoodType({ id: 10, name: 'Chicken', categoryId: 4 }),
    buildFoodType({ id: 11, name: 'Broccoli', categoryId: 5 }),
    buildFoodType({ id: 12, name: 'Egg', unit: 'pieces' }),
    buildFoodType({ id: 13, name: 'Milk', categoryId: 7, unit: 'ml' }),
  ],
});

describe('BC-10 CategoryPathResolver', () => {
  it('reads a Food Type in a Child as its Parent and then the Child: Meat → Poultry (spec 4.7.1)', () => {
    expect(categoryPathResolver(snapshot)[10]).toEqual({ categoryId: 4, names: ['Meat', 'Poultry'] });
  });

  it('reads a Food Type assigned to a Parent directly as that one name (Appendix A: Broccoli under Vegetables)', () => {
    expect(categoryPathResolver(snapshot)[11]).toEqual({ categoryId: 5, names: ['Vegetables'] });
  });

  it('reads a Food Type in the system category as Other', () => {
    expect(categoryPathResolver(snapshot)[12]).toEqual({ categoryId: SYSTEM_IDS.FOOD_OTHER, names: ['Other'] });
  });

  it('gives Milk the path of the spec example, Dairy → Liquid Dairy (spec 4.2.1)', () => {
    expect(categoryPathResolver(snapshot)[13]?.names.join(' → ')).toBe('Dairy → Liquid Dairy');
  });

  it('has one entry for each Food Type, keyed by its id', () => {
    expect(Object.keys(categoryPathResolver(snapshot)).map(Number)).toEqual([10, 11, 12, 13]);
    expect(categoryPathResolver(buildSnapshot())).toEqual({});
  });

  it('shows a rename at once and keeps the binding, because the names are looked up on every request (spec 4.1)', () => {
    const renamed = { ...snapshot, foodCategories: snapshot.foodCategories.map((c) => (c.id === 3 ? { ...c, name: 'Meats' } : c)) };

    expect(categoryPathResolver(renamed)[10]).toEqual({ categoryId: 4, names: ['Meats', 'Poultry'] });
  });

  it('reads a Food Type that fell back to Other after its category was deleted as Other (spec 4.1.3)', () => {
    const fallenBack = {
      ...snapshot,
      foodCategories: snapshot.foodCategories.filter((c) => c.id !== 4),
      foodTypes: snapshot.foodTypes.map((f) => (f.id === 10 ? { ...f, categoryId: SYSTEM_IDS.FOOD_OTHER } : f)),
    };

    expect(categoryPathResolver(fallenBack)[10]).toEqual({ categoryId: SYSTEM_IDS.FOOD_OTHER, names: ['Other'] });
  });

  it('invents no name for a category or a Parent that is not in the snapshot', () => {
    const broken = buildSnapshot({
      foodCategories: [buildFoodCategory({ id: 4, name: 'Poultry', parentId: 3 })],
      foodTypes: [buildFoodType({ id: 10, name: 'Chicken', categoryId: 4 }), buildFoodType({ id: 11, name: 'Tofu', categoryId: 99 })],
    });

    expect(categoryPathResolver(broken)[10]).toEqual({ categoryId: 4, names: ['Poultry'] });
    expect(categoryPathResolver(broken)[11]).toEqual({ categoryId: 99, names: [] });
  });
});
