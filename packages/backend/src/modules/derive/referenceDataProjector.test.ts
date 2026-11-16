import { describe, expect, it } from 'vitest';
import { LIMITS, SYSTEM_IDS, UNIT_LIST } from '@freshrescue/contract-rules';
import { buildFoodCategory, buildFoodType, buildRecipeCategory, buildSnapshot } from '../../testing/fixtures';
import { referenceDataProjector } from './referenceDataProjector';

// The preset categories of Appendix A, with a threshold on Poultry and one on Vegetables
const presets = buildSnapshot({
  foodCategories: [
    buildFoodCategory({ id: 3, name: 'Meat' }),
    buildFoodCategory({ id: 4, name: 'Red Meat', parentId: 3 }),
    buildFoodCategory({ id: 5, name: 'Poultry', parentId: 3, customThresholdDays: 2 }),
    buildFoodCategory({ id: 6, name: 'Dairy' }),
    buildFoodCategory({ id: 7, name: 'Liquid Dairy', parentId: 6 }),
    buildFoodCategory({ id: 8, name: 'Vegetables', customThresholdDays: 4 }),
    buildFoodCategory({ id: 9, name: 'Leafy Greens', parentId: 8 }),
  ],
  recipeCategories: [
    buildRecipeCategory({ id: 10, name: 'Chinese Cuisine' }),
    buildRecipeCategory({ id: 11, name: 'Vietnamese Cuisine' }),
    buildRecipeCategory({ id: 12, name: 'French Cuisine' }),
  ],
  foodTypes: [buildFoodType({ id: 13, name: 'Chicken', categoryId: 5 }), buildFoodType({ id: 14, name: 'Egg', unit: 'pieces' })],
  settings: { simulatedToday: '2026-10-04', bootstrapped: true },
});

describe('BC-19 ReferenceDataProjector', () => {
  it('passes on today, which every other figure of the request was derived for, and the stored Simulated Today', () => {
    expect(referenceDataProjector(presets, '2026-10-04')).toMatchObject({ today: '2026-10-04', simulatedToday: '2026-10-04' });
    expect(referenceDataProjector(buildSnapshot(), '2026-11-14')).toMatchObject({ today: '2026-11-14', simulatedToday: null });
  });

  it('gives the global default threshold of 3 days and the fixed list of six units', () => {
    const dto = referenceDataProjector(presets, '2026-10-04');

    expect(dto.globalThresholdDays).toBe(LIMITS.GLOBAL_THRESHOLD_DAYS);
    expect(dto.globalThresholdDays).toBe(3);
    expect(dto.units).toEqual([...UNIT_LIST]);
    expect(dto.units).toEqual(['grams', 'kg', 'ml', 'liters', 'pieces', 'cartons']);
  });

  it('builds the food category tree: each Parent with its Children, then Other (spec 4.1)', () => {
    const tree = referenceDataProjector(presets, '2026-10-04').foodCategories;

    expect(tree.map((node) => [node.name, node.children.map((child) => child.name)])).toEqual([
      ['Meat', ['Red Meat', 'Poultry']],
      ['Dairy', ['Liquid Dairy']],
      ['Vegetables', ['Leafy Greens']],
      ['Other', []],
    ]);
  });

  it('carries each category\'s own threshold and marks the system category', () => {
    const tree = referenceDataProjector(presets, '2026-10-04').foodCategories;

    expect(tree[0]?.children[1]).toEqual({ id: 5, name: 'Poultry', isSystem: false, customThresholdDays: 2, children: [] });
    expect(tree[2]).toMatchObject({ id: 8, customThresholdDays: 4 });
    expect(tree[3]).toEqual({ id: SYSTEM_IDS.FOOD_OTHER, name: 'Other', isSystem: true, customThresholdDays: null, children: [] });
  });

  it('lists the cuisines in the same shape, with no children and no threshold, and Other last', () => {
    expect(referenceDataProjector(presets, '2026-10-04').cuisines).toEqual([
      { id: 10, name: 'Chinese Cuisine', isSystem: false, customThresholdDays: null, children: [] },
      { id: 11, name: 'Vietnamese Cuisine', isSystem: false, customThresholdDays: null, children: [] },
      { id: 12, name: 'French Cuisine', isSystem: false, customThresholdDays: null, children: [] },
      { id: SYSTEM_IDS.CUISINE_OTHER, name: 'Other', isSystem: true, customThresholdDays: null, children: [] },
    ]);
  });

  it('offers every Food Type with its unit and its category, which is what the inbound form shows read-only (spec 4.2.2)', () => {
    expect(referenceDataProjector(presets, '2026-10-04').foodTypes).toEqual([
      { id: 13, name: 'Chicken', unit: 'grams', categoryId: 5 },
      { id: 14, name: 'Egg', unit: 'pieces', categoryId: SYSTEM_IDS.FOOD_OTHER },
    ]);
  });

  it('shows a rename and a new category at once, because it is projected on every request', () => {
    const changed = {
      ...presets,
      foodCategories: [...presets.foodCategories.map((c) => (c.id === 6 ? { ...c, name: 'Dairy & Eggs' } : c)), buildFoodCategory({ id: 15, name: 'Fish' })],
    };

    expect(referenceDataProjector(changed, '2026-10-04').foodCategories.map((node) => node.name)).toEqual(['Meat', 'Dairy & Eggs', 'Vegetables', 'Fish', 'Other']);
  });

  it('gives a store with only the system categories the two Other categories and nothing else', () => {
    const dto = referenceDataProjector(buildSnapshot(), '2026-10-04');

    expect(dto.foodCategories.map((node) => node.name)).toEqual(['Other']);
    expect(dto.cuisines.map((node) => node.name)).toEqual(['Other']);
    expect(dto.foodTypes).toEqual([]);
  });
});
