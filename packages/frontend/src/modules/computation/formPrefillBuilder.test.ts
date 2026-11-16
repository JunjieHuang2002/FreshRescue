import { describe, expect, it } from 'vitest';
import { FORM_KINDS, FORM_SCHEMAS } from '@freshrescue/contract-ui';
import type { FormValues } from '@freshrescue/contract-ui';
import type { CatalogRow, FoodTypeDetailDto } from '@freshrescue/contract-views';
import {
  BATCH_B,
  CHICKEN_RICE,
  DETAIL,
  DETAIL_CHICKEN,
  DETAIL_EMPTY,
  FRENCH,
  FRIED_RICE,
  MEAT,
  DAIRY,
  REFERENCE,
  REFERENCE_SIMULATED,
  STIR_FRY,
  TOMATO_EGG,
} from '../../testing/fixtures';
import { formSchemaParser } from '../parsing/formSchemaParser';
import { formPrefillBuilder } from './formPrefillBuilder';
import type { PrefillData } from './formPrefillBuilder';

const labelsOf = (options: readonly { readonly value: string; readonly label: string }[] | undefined): string[] => (options ?? []).map((option) => option.label);
const valuesOf = (options: readonly { readonly value: string; readonly label: string }[] | undefined): string[] => (options ?? []).map((option) => option.value);

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

const SUMMARY = '150 grams of Beef — expires in 1 day';

// One piece of view data for each of the 15 kinds of form. `PrefillData` makes a kind without one a compile error.
const DATA: PrefillData = {
  settingsForm: {},
  batchAdd: { foodTypeId: null },
  batchQty: { batch: BATCH_B, foodType: DETAIL },
  batchRemove: { batch: BATCH_B, summary: SUMMARY },
  foodTypeCreate: {},
  foodTypeEdit: { foodType: DETAIL },
  unitChange: { foodType: DETAIL },
  foodTypeDelete: { foodType: DETAIL },
  categoryCreate: { scope: 'foodCategory', parent: null },
  categoryRename: { scope: 'foodCategory', category: MEAT },
  thresholdSet: { category: MEAT },
  categoryDelete: { scope: 'foodCategory', category: MEAT },
  recipeCreate: {},
  recipeEdit: { recipe: STIR_FRY },
  recipeDelete: { recipe: FRIED_RICE },
};

describe('FC-02 FormPrefillBuilder', () => {
  it('builds every one of the 15 forms, with and without reference data, and never fails', () => {
    expect(FORM_KINDS).toHaveLength(15);

    for (const kind of FORM_KINDS) {
      for (const reference of [REFERENCE, null]) {
        const prefill = formPrefillBuilder(kind, DATA[kind], reference);

        expect(Object.values(prefill.values).every((value) => typeof value === 'string'), kind).toBe(true);
        expect(typeof prefill.options, kind).toBe('object');
      }
    }
  });

  it('is given the view data that its kind needs, which the compiler checks', () => {
    // never called: these lines are here for the compiler, which must refuse each of them
    const _refused = (): void => {
      // @ts-expect-error a quantity edit needs the batch itself, not the id of one
      formPrefillBuilder('batchQty', { batchId: 32 }, REFERENCE);
      // @ts-expect-error a Food Type is not the data of a recipe
      formPrefillBuilder('recipeEdit', { foodType: DETAIL }, REFERENCE);
      // @ts-expect-error a category form needs the tree that it is in
      formPrefillBuilder('categoryCreate', { parent: null }, REFERENCE);
    };
    void _refused;
  });

  describe('the demo control', () => {
    it('starts at the current Simulated Today, or empty when there is none', () => {
      expect(formPrefillBuilder('settingsForm', {}, REFERENCE_SIMULATED).values).toEqual({ date: '2026-10-05' });
      expect(formPrefillBuilder('settingsForm', {}, REFERENCE).values).toEqual({ date: '' });
      expect(formPrefillBuilder('settingsForm', {}, null).values).toEqual({ date: '' });
    });
  });

  describe('the inbound form (spec 4.2.5)', () => {
    it('opens empty for a new Food Type, in `Other`, with no unit chosen and a shelf life in days', () => {
      const { values } = formPrefillBuilder('batchAdd', { foodTypeId: null }, REFERENCE);

      expect(values).toEqual({
        foodTypeId: '',
        foodName: '',
        categoryId: '1',
        unit: '',
        quantity: '',
        'expiry.mode': 'days',
        'expiry.days': '',
        'expiry.date': '',
      });
    });

    it('opens from the detail of a Food Type with that Food Type picked, and its unit and category filled in', () => {
      const { values } = formPrefillBuilder('batchAdd', { foodTypeId: 24 }, REFERENCE);

      expect(values.foodTypeId).toBe('24');
      expect(values.foodName).toBe('');
      expect(values.unit).toBe('ml');
      expect(values.categoryId).toBe('7');
    });

    it('gives a picked Food Type its id and no name, and a form with neither nothing (spec 4.2.5)', () => {
      const picked = formPrefillBuilder('batchAdd', { value: '22' }, REFERENCE).values;
      const none = formPrefillBuilder('batchAdd', { value: '' }, REFERENCE).values;

      expect(picked).toMatchObject({ foodTypeId: '22', foodName: '', unit: 'grams', categoryId: '5' });
      expect(none).toMatchObject({ foodTypeId: '', foodName: '', unit: '', categoryId: '1' });
    });

    it('fills only what depends on the choice for a pick, so that the quantity typed so far is kept', () => {
      const picked = formPrefillBuilder('batchAdd', { value: '22' }, REFERENCE).values;

      expect(Object.keys(picked).sort()).toEqual(['categoryId', 'foodName', 'foodTypeId', 'unit']);
    });

    it('leaves the pick empty for a Food Type that is not in the reference data', () => {
      expect(formPrefillBuilder('batchAdd', { value: '999' }, REFERENCE).values.foodTypeId).toBe('');
      expect(formPrefillBuilder('batchAdd', { foodTypeId: 22 }, null).values.foodTypeId).toBe('');
    });

    it('offers the Food Types, the categories with their children, the six units and the two ways to give the expiry', () => {
      const { options } = formPrefillBuilder('batchAdd', { foodTypeId: null }, REFERENCE);

      expect(labelsOf(options.foodTypeId)).toEqual(['New Food Type', 'Beef', 'Broccoli', 'Chicken', 'Egg', 'Milk', 'Rice', 'Spinach', 'Tomato']);
      expect(valuesOf(options.foodTypeId)[0]).toBe('');
      expect(labelsOf(options.categoryId)).toEqual([
        'Meat',
        'Meat → Red Meat',
        'Meat → Poultry',
        'Dairy',
        'Dairy → Liquid Dairy',
        'Vegetables',
        'Vegetables → Leafy Greens',
        'Other',
      ]);
      expect(valuesOf(options.unit)).toEqual(['', 'grams', 'kg', 'ml', 'liters', 'pieces', 'cartons']);
      expect(valuesOf(options['expiry.mode'])).toEqual(['days', 'date']);
    });

    it('can be parsed by FormSchemaParser as it is opened, apart from what the person has still to enter', () => {
      const result = formSchemaParser(FORM_SCHEMAS.batchAdd, formPrefillBuilder('batchAdd', { foodTypeId: 24 }, REFERENCE).values);

      expect(result.ok ? [] : result.err).toEqual([
        { field: 'quantity', code: 'FIELD_REQUIRED' },
        { field: 'expiry.days', code: 'FIELD_REQUIRED' },
      ]);
    });
  });

  describe('editing a quantity', () => {
    it('shows the quantity of the batch as decimal text, and names what it belongs to', () => {
      const { values } = formPrefillBuilder('batchQty', { batch: BATCH_B, foodType: DETAIL }, REFERENCE);

      expect(values).toEqual({ batchId: '32', quantity: '150', name: 'Beef', unit: 'grams' });
    });

    it('writes thousandths as the decimals that the person typed them with', () => {
      const text = (quantity: number): string | undefined => formPrefillBuilder('batchQty', { batch: { ...BATCH_B, quantity }, foodType: DETAIL }, REFERENCE).values.quantity;

      expect(text(1500)).toBe('1.5');
      expect(text(1)).toBe('0.001');
      expect(text(250)).toBe('0.25');
      expect(text(500_000_000)).toBe('500000');
      expect(text(12_345)).toBe('12.345');
    });

    it('can be parsed by FormSchemaParser as it is opened', () => {
      const values = formPrefillBuilder('batchQty', { batch: { ...BATCH_B, quantity: 150_250 }, foodType: DETAIL }, REFERENCE).values;

      expect(formSchemaParser(FORM_SCHEMAS.batchQty, values)).toEqual({ ok: true, value: { batchId: 32, quantity: 150_250 } });
    });
  });

  describe('the Food Type form', () => {
    it('opens a new Food Type in `Other`, with no name, no unit and no threshold', () => {
      const { values, options } = formPrefillBuilder('foodTypeCreate', {}, REFERENCE);

      expect(values).toEqual({ foodTypeId: '', name: '', categoryId: '1', unit: '', thresholdDays: '' });
      expect(valuesOf(options.unit)).toEqual(['', 'grams', 'kg', 'ml', 'liters', 'pieces', 'cartons']);
    });

    it('opens an existing Food Type with what it has now, and an empty threshold when it inherits one', () => {
      const own = formPrefillBuilder('foodTypeEdit', { foodType: DETAIL_EMPTY }, REFERENCE).values;
      const inherited = formPrefillBuilder('foodTypeEdit', { foodType: DETAIL }, REFERENCE).values;

      expect(own).toEqual({ foodTypeId: '23', name: 'Egg', categoryId: '1', unit: 'pieces', thresholdDays: '2' });
      expect(inherited).toEqual({ foodTypeId: '20', name: 'Beef', categoryId: '4', unit: 'grams', thresholdDays: '' });
    });
  });

  describe('the unit change', () => {
    it('asks for the new quantity of every batch, Expired ones too, each labelled with what it holds now (spec 4.2.2)', () => {
      const { values } = formPrefillBuilder('unitChange', { foodType: DETAIL_CHICKEN }, REFERENCE);

      expect(values).toEqual({
        foodTypeId: '22',
        name: 'Chicken',
        fromUnit: 'grams',
        unit: '',
        'batches.0.batchId': '11',
        'batches.0.quantity': '',
        'batches.0.label': '100 grams, expires 2026-10-04',
        'batches.1.batchId': '12',
        'batches.1.quantity': '',
        'batches.1.label': '200 grams, expires 2026-10-09',
      });
    });

    it('lists a batch of every status: the Expired batch of Beef has its field as well', () => {
      const { values } = formPrefillBuilder('unitChange', { foodType: DETAIL }, REFERENCE);

      expect(Object.keys(values).filter((key) => key.endsWith('.batchId'))).toEqual(['batches.0.batchId', 'batches.1.batchId', 'batches.2.batchId']);
      expect(values['batches.0.label']).toBe('100 grams, expires 2026-10-01');
    });

    it('offers the other five units for the new unit, because a unit cannot change to itself', () => {
      const { options } = formPrefillBuilder('unitChange', { foodType: DETAIL_CHICKEN }, REFERENCE);

      expect(valuesOf(options.unit)).toEqual(['', 'kg', 'ml', 'liters', 'pieces', 'cartons']);
    });

    it('asks only for the unit when the Food Type has no batch', () => {
      const { values } = formPrefillBuilder('unitChange', { foodType: DETAIL_EMPTY }, REFERENCE);

      expect(Object.keys(values).sort()).toEqual(['foodTypeId', 'fromUnit', 'name', 'unit']);
    });

    it('can be parsed by FormSchemaParser once the person has filled it in', () => {
      const values: FormValues = {
        ...formPrefillBuilder('unitChange', { foodType: DETAIL_CHICKEN }, REFERENCE).values,
        unit: 'pieces',
        'batches.0.quantity': '0.5',
        'batches.1.quantity': '1',
      };

      expect(formSchemaParser(FORM_SCHEMAS.unitChange, values)).toEqual({
        ok: true,
        value: {
          foodTypeId: 22,
          unit: 'pieces',
          batches: [
            { batchId: 11, quantity: 500 },
            { batchId: 12, quantity: 1000 },
          ],
        },
      });
    });
  });

  describe('the category forms', () => {
    it('opens a new Parent, a new Child under a Parent, and a new cuisine', () => {
      expect(formPrefillBuilder('categoryCreate', { scope: 'foodCategory', parent: null }, REFERENCE).values).toEqual({
        scope: 'foodCategory',
        categoryId: '',
        parentId: '',
        name: '',
      });
      expect(formPrefillBuilder('categoryCreate', { scope: 'foodCategory', parent: MEAT }, REFERENCE).values.parentId).toBe('3');
      expect(formPrefillBuilder('categoryCreate', { scope: 'cuisine', parent: null }, REFERENCE).values.scope).toBe('cuisine');
    });

    it('opens a rename with the name that the category has', () => {
      expect(formPrefillBuilder('categoryRename', { scope: 'cuisine', category: FRENCH }, REFERENCE).values).toEqual({
        scope: 'cuisine',
        categoryId: '12',
        parentId: '',
        name: 'French Cuisine',
      });
    });

    it('opens the threshold with the days that the category has, or empty', () => {
      expect(formPrefillBuilder('thresholdSet', { category: MEAT }, REFERENCE).values).toEqual({
        categoryId: '3',
        thresholdDays: '5',
        name: 'Meat',
      });
      expect(formPrefillBuilder('thresholdSet', { category: DAIRY }, REFERENCE).values.thresholdDays).toBe('');
    });
  });

  describe('the recipe form', () => {
    it('opens a new recipe in `Other` with one empty ingredient row, because a recipe needs at least one', () => {
      const { values } = formPrefillBuilder('recipeCreate', {}, REFERENCE);

      expect(values).toEqual({
        recipeId: '',
        name: '',
        'draft.cuisineId': '2',
        'draft.rows.0.foodTypeId': '',
        'draft.rows.0.quantity': '',
        'draft.rows.0.unit': '',
      });
    });

    it('offers the cuisines, the Food Types, the units, and the unit that each Food Type has', () => {
      const { options } = formPrefillBuilder('recipeCreate', {}, REFERENCE);

      expect(labelsOf(options['draft.cuisineId'])).toEqual(['Chinese Cuisine', 'Vietnamese Cuisine', 'French Cuisine', 'Other']);
      expect(valuesOf(options['draft.rows.foodTypeId'])[0]).toBe('');
      expect(labelsOf(options['draft.rows.foodTypeId']).slice(1, 3)).toEqual(['Beef', 'Broccoli']);
      expect(valuesOf(options['draft.rows.unit'])).toEqual(['', 'grams', 'kg', 'ml', 'liters', 'pieces', 'cartons']);
      expect(options['draft.rows.unitOf']).toContainEqual({ value: '20', label: 'grams' });
      expect(options['draft.rows.unitOf']).toContainEqual({ value: '27', label: 'pieces' });
    });

    it('opens a recipe with its rows, as decimal text', () => {
      const { values } = formPrefillBuilder('recipeEdit', { recipe: STIR_FRY }, REFERENCE);

      expect(values).toEqual({
        recipeId: '40',
        name: 'Beef and Broccoli Stir-Fry',
        'draft.cuisineId': '10',
        'draft.rows.0.foodTypeId': '20',
        'draft.rows.0.quantity': '300',
        'draft.rows.0.unit': 'grams',
        'draft.rows.1.foodTypeId': '21',
        'draft.rows.1.quantity': '200',
        'draft.rows.1.unit': 'grams',
      });
    });

    it('leaves the Food Type of a row empty when that Food Type was deleted, so the person picks another (blueprint 3.3)', () => {
      const { values } = formPrefillBuilder('recipeEdit', { recipe: TOMATO_EGG }, REFERENCE);

      // the recipe says it itself: the row of the deleted Tomato is in the state `missingFoodType`
      expect(values['draft.rows.0.foodTypeId']).toBe('');
      expect(values['draft.rows.0.quantity']).toBe('2');
      expect(values['draft.rows.0.unit']).toBe('pieces');
      expect(values['draft.rows.1.foodTypeId']).toBe('23');
    });

    it('knows that a Food Type was deleted from the recipe, and not from the reference data, so it needs neither', () => {
      expect(formPrefillBuilder('recipeEdit', { recipe: TOMATO_EGG }, null).values['draft.rows.0.foodTypeId']).toBe('');
      expect(formPrefillBuilder('recipeEdit', { recipe: STIR_FRY }, null).values['draft.rows.0.foodTypeId']).toBe('20');
    });

    it('keeps a unit that differs from the unit of its Food Type, because that conflict is the recipe\'s to show (spec 4.4.A)', () => {
      const { values } = formPrefillBuilder('recipeEdit', { recipe: CHICKEN_RICE }, REFERENCE);

      expect(values['draft.rows.0.foodTypeId']).toBe('22');
      expect(values['draft.rows.0.unit']).toBe('pieces');
    });

    it('starts a recipe that has no rows with one empty row, and keeps its name and cuisine', () => {
      const bare: CatalogRow = { ...STIR_FRY, ingredients: [] };

      expect(formPrefillBuilder('recipeEdit', { recipe: bare }, REFERENCE).values).toEqual({
        recipeId: '40',
        name: 'Beef and Broccoli Stir-Fry',
        'draft.cuisineId': '10',
        'draft.rows.0.foodTypeId': '',
        'draft.rows.0.quantity': '',
        'draft.rows.0.unit': '',
      });
    });

    it('can be parsed by FormSchemaParser as it is opened for editing', () => {
      const values = formPrefillBuilder('recipeEdit', { recipe: STIR_FRY }, REFERENCE).values;

      expect(formSchemaParser(FORM_SCHEMAS.recipe, values)).toEqual({
        ok: true,
        value: {
          recipeId: 40,
          name: 'Beef and Broccoli Stir-Fry',
          draft: {
            cuisineId: 10,
            rows: [
              { foodTypeId: 20, quantity: 300_000, unit: 'grams' },
              { foodTypeId: 21, quantity: 200_000, unit: 'grams' },
            ],
          },
        },
      });
    });
  });

  describe('the four confirmations', () => {
    const target = (values: FormValues) => formSchemaParser(FORM_SCHEMAS.target, values);

    it('removing a batch asks about that batch, and names it', () => {
      const { values } = formPrefillBuilder('batchRemove', { batch: BATCH_B, summary: SUMMARY }, REFERENCE);

      expect(values).toEqual({ id: '32', title: 'Remove this batch?', confirmLabel: 'Remove batch', 'lines.0': SUMMARY });
      expect(target(values)).toEqual({ ok: true, value: { id: 32, scope: null } });
    });

    it('deleting a Food Type lists the recipes that will become blocked (spec 4.2.4)', () => {
      const { values } = formPrefillBuilder('foodTypeDelete', { foodType: DETAIL_CHICKEN }, REFERENCE);

      expect(values).toEqual({
        id: '22',
        title: 'Delete Chicken?',
        confirmLabel: 'Delete Food Type',
        'lines.0': 'These recipes will become blocked: Chicken Fried Rice, Chicken Broccoli Gratin.',
      });
      expect(target(values)).toEqual({ ok: true, value: { id: 22, scope: null } });
    });

    it('deleting a Food Type that no recipe uses says so', () => {
      expect(formPrefillBuilder('foodTypeDelete', { foodType: DETAIL_EMPTY }, REFERENCE).values['lines.0']).toBe('No recipe uses this Food Type.');
    });

    it('deleting a category says that its contents fall back to `Other`, in each tree, and reads the tree as the scope', () => {
      const food = formPrefillBuilder('categoryDelete', { scope: 'foodCategory', category: MEAT }, REFERENCE).values;
      const cuisine = formPrefillBuilder('categoryDelete', { scope: 'cuisine', category: FRENCH }, REFERENCE).values;

      expect(food).toMatchObject({ id: '3', scope: 'foodCategory', title: 'Delete Meat?', confirmLabel: 'Delete category' });
      expect(food['lines.0']).toContain('move to Other');
      expect(cuisine['lines.0']).toBe('Its recipes move to Other.');
      expect(target(cuisine)).toEqual({ ok: true, value: { id: 12, scope: 'cuisine' } });
    });

    it('deleting a recipe says that it leaves the cook queue (spec 4.5)', () => {
      const { values } = formPrefillBuilder('recipeDelete', { recipe: FRIED_RICE }, REFERENCE);

      expect(values).toMatchObject({ id: '41', title: 'Delete Chicken Fried Rice?', confirmLabel: 'Delete recipe' });
      expect(values['lines.0']).toContain('cook queue');
      expect(target(values)).toEqual({ ok: true, value: { id: 41, scope: null } });
    });

    it('leaves out a line that has nothing in it', () => {
      expect(formPrefillBuilder('batchRemove', { batch: BATCH_B, summary: '' }, REFERENCE).values).not.toHaveProperty('lines.0');
    });
  });

  it('does not change the view data or the reference data that it is given', () => {
    const data: PrefillData = deepFreeze(structuredClone(DATA));
    const reference = deepFreeze(structuredClone(REFERENCE));
    const clone = (foodType: FoodTypeDetailDto): FoodTypeDetailDto => deepFreeze(structuredClone(foodType));

    for (const kind of FORM_KINDS) expect(() => formPrefillBuilder(kind, data[kind], reference), kind).not.toThrow();
    expect(() => formPrefillBuilder('unitChange', { foodType: clone(DETAIL_CHICKEN) }, reference)).not.toThrow();
    expect(reference).toEqual(REFERENCE);
    expect(data).toEqual(DATA);
  });
});
