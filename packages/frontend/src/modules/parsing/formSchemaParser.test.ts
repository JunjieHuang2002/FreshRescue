import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Command, CommandPayloads } from '@freshrescue/contract-messages';
import type { Result } from '@freshrescue/contract-primitives';
import { FORM_SCHEMAS } from '@freshrescue/contract-ui';
import type { FieldError, FormErrorCode, FormValues } from '@freshrescue/contract-ui';
import { formSchemaParser } from './formSchemaParser';
import type { Target } from './formSchemaParser';

type Parsed<P> = Result<P, readonly FieldError[]>;

const errorsOf = (result: Result<unknown, readonly FieldError[]>): readonly FieldError[] => (result.ok ? [] : result.err);

/** The one error of a form with one bad field. */
const only = (result: Result<unknown, readonly FieldError[]>): FieldError | undefined => {
  expect(errorsOf(result)).toHaveLength(1);
  return errorsOf(result)[0];
};

/** The batchAdd form with a quantity text, everything else fine. */
const withQuantity = (quantity: string): FormValues => ({
  foodTypeId: '7',
  foodName: '',
  categoryId: '',
  unit: '',
  quantity,
  'expiry.mode': 'days',
  'expiry.days': '5',
  'expiry.date': '',
});

const quantityOf = (text: string): number | FormErrorCode => {
  const result = formSchemaParser(FORM_SCHEMAS.batchAdd, withQuantity(text));
  return result.ok ? result.value.quantity : (errorsOf(result)[0]?.code ?? 'FIELD_REQUIRED');
};

describe('FP-01 FormSchemaParser', () => {
  describe('the eight edit forms, each with a payload that fits its command', () => {
    it('settings: SetSimulatedToday takes a date, or null to clear it', () => {
      const set = formSchemaParser(FORM_SCHEMAS.settings, { date: '2026-10-05' });
      const cleared = formSchemaParser(FORM_SCHEMAS.settings, { date: '' });

      expectTypeOf(set).toEqualTypeOf<Parsed<CommandPayloads['SetSimulatedToday']>>();
      expect(set).toEqual({ ok: true, value: { date: '2026-10-05' } });
      expect(cleared).toEqual({ ok: true, value: { date: null } });
    });

    it('batchAdd: InboundBatch with a Food Type that was picked and a shelf life in days', () => {
      const result = formSchemaParser(FORM_SCHEMAS.batchAdd, {
        foodTypeId: '7',
        foodName: '',
        categoryId: '3',
        unit: 'ml',
        quantity: '500',
        'expiry.mode': 'days',
        'expiry.days': '5',
        'expiry.date': '2026-12-31',
      });

      expectTypeOf(result).toEqualTypeOf<Parsed<CommandPayloads['InboundBatch']>>();
      expect(result).toEqual({
        ok: true,
        value: { foodTypeId: 7, foodName: null, categoryId: 3, unit: 'ml', quantity: 500_000, expiry: { days: 5 } },
      });
      if (result.ok) {
        const command: Extract<Command, { type: 'InboundBatch' }> = { type: 'InboundBatch', payload: result.value };
        expect(command.type).toBe('InboundBatch');
      }
    });

    it('batchAdd: InboundBatch with a new name and an expiration date', () => {
      const result = formSchemaParser(FORM_SCHEMAS.batchAdd, {
        foodTypeId: '',
        foodName: 'Kale',
        categoryId: '4',
        unit: 'grams',
        quantity: '1.5',
        'expiry.mode': 'date',
        'expiry.days': '9',
        'expiry.date': '2026-10-06',
      });

      expect(result).toEqual({
        ok: true,
        value: { foodTypeId: null, foodName: 'Kale', categoryId: 4, unit: 'grams', quantity: 1500, expiry: { date: '2026-10-06' } },
      });
    });

    it('batchQty: EditBatchQuantity', () => {
      const result = formSchemaParser(FORM_SCHEMAS.batchQty, { batchId: '21', quantity: '0.25' });

      expectTypeOf(result).toEqualTypeOf<Parsed<CommandPayloads['EditBatchQuantity']>>();
      expect(result).toEqual({ ok: true, value: { batchId: 21, quantity: 250 } });
    });

    it('foodType: SaveFoodType, to create (no id) and to edit (an id, a threshold)', () => {
      const created = formSchemaParser(FORM_SCHEMAS.foodType, { foodTypeId: '', name: 'Kale', categoryId: '', unit: 'grams', thresholdDays: '' });
      const edited = formSchemaParser(FORM_SCHEMAS.foodType, { foodTypeId: '9', name: 'Kale', categoryId: '4', unit: 'grams', thresholdDays: '2' });

      expectTypeOf(created).toEqualTypeOf<Parsed<CommandPayloads['SaveFoodType']>>();
      expect(created).toEqual({ ok: true, value: { foodTypeId: null, name: 'Kale', categoryId: null, unit: 'grams', thresholdDays: null } });
      expect(edited).toEqual({ ok: true, value: { foodTypeId: 9, name: 'Kale', categoryId: 4, unit: 'grams', thresholdDays: 2 } });
    });

    it('unitChange: ChangeFoodTypeUnit with a new quantity for every batch', () => {
      const result = formSchemaParser(FORM_SCHEMAS.unitChange, {
        foodTypeId: '5',
        unit: 'pieces',
        'batches.0.batchId': '11',
        'batches.0.quantity': '0.5',
        'batches.1.batchId': '12',
        'batches.1.quantity': '1',
      });

      expectTypeOf(result).toEqualTypeOf<Parsed<CommandPayloads['ChangeFoodTypeUnit']>>();
      expect(result).toEqual({
        ok: true,
        value: {
          foodTypeId: 5,
          unit: 'pieces',
          batches: [
            { batchId: 11, quantity: 500 },
            { batchId: 12, quantity: 1000 },
          ],
        },
      });
    });

    it('unitChange: a Food Type without batches sends an empty list', () => {
      expect(formSchemaParser(FORM_SCHEMAS.unitChange, { foodTypeId: '5', unit: 'kg' })).toEqual({
        ok: true,
        value: { foodTypeId: 5, unit: 'kg', batches: [] },
      });
    });

    it('category: SaveCategory to create a Child under a Parent, and to rename', () => {
      const child = formSchemaParser(FORM_SCHEMAS.category, { scope: 'foodCategory', categoryId: '', parentId: '3', name: 'Red Meat' });
      const renamed = formSchemaParser(FORM_SCHEMAS.category, { scope: 'cuisine', categoryId: '8', parentId: '', name: 'Thai Cuisine' });

      expectTypeOf(child).toEqualTypeOf<Parsed<CommandPayloads['SaveCategory']>>();
      expect(child).toEqual({ ok: true, value: { scope: 'foodCategory', categoryId: null, parentId: 3, name: 'Red Meat' } });
      expect(renamed).toEqual({ ok: true, value: { scope: 'cuisine', categoryId: 8, parentId: null, name: 'Thai Cuisine' } });
    });

    it('threshold: SetCategoryThreshold with a number of days, or null to clear it', () => {
      const set = formSchemaParser(FORM_SCHEMAS.threshold, { categoryId: '3', thresholdDays: '4' });
      const cleared = formSchemaParser(FORM_SCHEMAS.threshold, { categoryId: '3', thresholdDays: '' });

      expectTypeOf(set).toEqualTypeOf<Parsed<CommandPayloads['SetCategoryThreshold']>>();
      expect(set).toEqual({ ok: true, value: { categoryId: 3, thresholdDays: 4 } });
      expect(cleared).toEqual({ ok: true, value: { categoryId: 3, thresholdDays: null } });
    });

    it('recipe: SaveRecipe with a name, a cuisine and its ingredient rows', () => {
      const result = formSchemaParser(FORM_SCHEMAS.recipe, {
        recipeId: '',
        name: 'Beef Stew',
        'draft.cuisineId': '2',
        'draft.rows.0.foodTypeId': '10',
        'draft.rows.0.quantity': '300',
        'draft.rows.0.unit': 'grams',
        'draft.rows.1.foodTypeId': '11',
        'draft.rows.1.quantity': '2',
        'draft.rows.1.unit': 'pieces',
      });

      expectTypeOf(result).toEqualTypeOf<Parsed<CommandPayloads['SaveRecipe']>>();
      expect(result).toEqual({
        ok: true,
        value: {
          recipeId: null,
          name: 'Beef Stew',
          draft: {
            cuisineId: 2,
            rows: [
              { foodTypeId: 10, quantity: 300_000, unit: 'grams' },
              { foodTypeId: 11, quantity: 2000, unit: 'pieces' },
            ],
          },
        },
      });
    });
  });

  describe('target: the confirmation that the four deletions share', () => {
    it('reads the id of the record, and the tree of a category', () => {
      const record = formSchemaParser(FORM_SCHEMAS.target, { id: '7' });
      const category = formSchemaParser(FORM_SCHEMAS.target, { id: '3', scope: 'cuisine' });

      expectTypeOf(record).toEqualTypeOf<Parsed<Target>>();
      expect(record).toEqual({ ok: true, value: { id: 7, scope: null } });
      expect(category).toEqual({ ok: true, value: { id: 3, scope: 'cuisine' } });
    });

    it('needs an id, and a scope that is one of the two trees', () => {
      expect(only(formSchemaParser(FORM_SCHEMAS.target, { id: '' }))).toEqual({ field: 'id', code: 'FIELD_REQUIRED' });
      expect(only(formSchemaParser(FORM_SCHEMAS.target, { id: '3', scope: 'forest' }))).toEqual({ field: 'scope', code: 'CHOICE_UNKNOWN' });
    });
  });

  describe('inbound name fields (spec 4.2.5)', () => {
    const name = (foodTypeId: string, foodName: string) => {
      const result = formSchemaParser(FORM_SCHEMAS.batchAdd, { ...withQuantity('1'), foodTypeId, foodName });
      return result.ok ? { foodTypeId: result.value.foodTypeId, foodName: result.value.foodName } : errorsOf(result);
    };

    it('gives the id and no name for a Food Type that was picked', () => {
      expect(name('7', '')).toEqual({ foodTypeId: 7, foodName: null });
    });

    it('gives the name and no id for a name that was typed', () => {
      expect(name('', 'Kale')).toEqual({ foodTypeId: null, foodName: 'Kale' });
    });

    it('gives two nulls for a form with neither, which the backend answers with NAME_EMPTY', () => {
      expect(name('', '')).toEqual({ foodTypeId: null, foodName: null });
      expect(name('', '   ')).toEqual({ foodTypeId: null, foodName: null });
    });

    it('keeps a typed name exactly as typed: trimming and matching are the backend\'s work', () => {
      expect(name('', '  Kale ')).toEqual({ foodTypeId: null, foodName: '  Kale ' });
    });

    it('does not choose between the two fields: a form that fills both is sent as it is', () => {
      expect(name('7', 'Kale')).toEqual({ foodTypeId: 7, foodName: 'Kale' });
    });
  });

  describe('quantity text (spec section 3)', () => {
    it('reads decimal text as thousandths', () => {
      expect(quantityOf('1.5')).toBe(1500);
      expect(quantityOf('0.001')).toBe(1);
      expect(quantityOf('500000')).toBe(500_000_000);
      expect(quantityOf('300')).toBe(300_000);
      expect(quantityOf('0.25')).toBe(250);
      expect(quantityOf('12.345')).toBe(12_345);
    });

    it('answers QTY_DECIMALS for more than 3 digits after the point, and never rounds', () => {
      for (const text of ['1.2345', '0.0005', '5.1000', '0.0001']) expect(quantityOf(text)).toBe('QTY_DECIMALS');
    });

    it('answers QTY_FORMAT for anything but digits and one point', () => {
      for (const text of ['1e3', '1E3', '-2', '+2', '1,000', '1 000', '1.2.3', '.', 'abc', '1,5', '0x10', '१२', '１２']) {
        expect(quantityOf(text)).toBe('QTY_FORMAT');
      }
    });

    it('answers FIELD_REQUIRED for an empty field, or one with only spaces', () => {
      expect(quantityOf('')).toBe('FIELD_REQUIRED');
      expect(quantityOf('   ')).toBe('FIELD_REQUIRED');
    });

    it('accepts a point with digits on one side only, and spaces around the number', () => {
      expect(quantityOf('.5')).toBe(500);
      expect(quantityOf('5.')).toBe(5000);
      expect(quantityOf(' 2.5 ')).toBe(2500);
      expect(quantityOf('007')).toBe(7000);
    });

    it('lets zero through to the backend, which owns the rule that a quantity is positive', () => {
      expect(quantityOf('0')).toBe(0);
      expect(quantityOf('0.000')).toBe(0);
    });

    it('turns a number beyond the integers into the largest one, so the backend answers QTY_TOO_LARGE', () => {
      expect(quantityOf('9'.repeat(40))).toBe(Number.MAX_SAFE_INTEGER);
      expect(quantityOf('9007199254740.992')).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('whole numbers, dates, ids and choices', () => {
    const days = (text: string) => formSchemaParser(FORM_SCHEMAS.threshold, { categoryId: '3', thresholdDays: text });

    it('reads a whole number of days, and leaves a blank optional one as null', () => {
      expect(days('3')).toEqual({ ok: true, value: { categoryId: 3, thresholdDays: 3 } });
      expect(days(' 12 ')).toEqual({ ok: true, value: { categoryId: 3, thresholdDays: 12 } });
      expect(days('0')).toEqual({ ok: true, value: { categoryId: 3, thresholdDays: 0 } });
      expect(days('')).toEqual({ ok: true, value: { categoryId: 3, thresholdDays: null } });
    });

    it('answers INT_FORMAT for anything that is not a whole number without a sign', () => {
      for (const text of ['2.5', '-1', '+1', '1e2', 'three', '1,000', '٣', '9'.repeat(30)]) {
        expect(only(days(text))).toEqual({ field: 'thresholdDays', code: 'INT_FORMAT' });
      }
    });

    it('reads a date as YYYY-MM-DD and answers DATE_FORMAT for any other form', () => {
      const date = (text: string) => formSchemaParser(FORM_SCHEMAS.settings, { date: text });

      expect(date('2026-10-05')).toEqual({ ok: true, value: { date: '2026-10-05' } });
      for (const text of ['2026-1-5', '5/10/2026', '10-05-2026', '2026-10-05T00:00', 'tomorrow', '20261005']) {
        expect(only(date(text))).toEqual({ field: 'date', code: 'DATE_FORMAT' });
      }
    });

    it('leaves a date that does not exist to the backend (DATE_INVALID): only the form of the text is the form\'s business', () => {
      expect(formSchemaParser(FORM_SCHEMAS.settings, { date: '2026-02-30' })).toEqual({ ok: true, value: { date: '2026-02-30' } });
    });

    it('reads an id from a list, and answers CHOICE_UNKNOWN for text that is not an id', () => {
      const batch = (text: string) => formSchemaParser(FORM_SCHEMAS.batchQty, { batchId: text, quantity: '1' });

      expect(batch('21')).toEqual({ ok: true, value: { batchId: 21, quantity: 1000 } });
      for (const text of ['0', '-4', '2.5', 'abc', '1e3']) {
        expect(only(batch(text))).toEqual({ field: 'batchId', code: 'CHOICE_UNKNOWN' });
      }
      expect(only(batch(''))).toEqual({ field: 'batchId', code: 'FIELD_REQUIRED' });
    });

    it('reads a choice from its list exactly, so `KG` is not `kg`', () => {
      const unit = (text: string) => formSchemaParser(FORM_SCHEMAS.unitChange, { foodTypeId: '5', unit: text });

      expect(unit('kg')).toEqual({ ok: true, value: { foodTypeId: 5, unit: 'kg', batches: [] } });
      for (const text of ['KG', ' kg', 'kg ', 'cups', 'gram']) {
        expect(only(unit(text))).toEqual({ field: 'unit', code: 'CHOICE_UNKNOWN' });
      }
      expect(only(unit(''))).toEqual({ field: 'unit', code: 'FIELD_REQUIRED' });
    });
  });

  describe('text', () => {
    it('keeps a required name exactly as typed, and answers FIELD_REQUIRED when it is empty or only spaces', () => {
      const name = (text: string) => formSchemaParser(FORM_SCHEMAS.category, { scope: 'foodCategory', categoryId: '', parentId: '', name: text });

      expect(name('  Poultry ')).toEqual({ ok: true, value: { scope: 'foodCategory', categoryId: null, parentId: null, name: '  Poultry ' } });
      expect(only(name(''))).toEqual({ field: 'name', code: 'FIELD_REQUIRED' });
      expect(only(name('   '))).toEqual({ field: 'name', code: 'FIELD_REQUIRED' });
    });

    it('treats a field that the form does not have as empty', () => {
      expect(errorsOf(formSchemaParser(FORM_SCHEMAS.batchQty, {}))).toEqual([
        { field: 'batchId', code: 'FIELD_REQUIRED' },
        { field: 'quantity', code: 'FIELD_REQUIRED' },
      ]);
    });
  });

  describe('the expiry of an inbound: a shelf life or a date, never both', () => {
    const expiry = (values: Record<string, string>) => formSchemaParser(FORM_SCHEMAS.batchAdd, { ...withQuantity('1'), ...values });

    it('reads only the branch that `expiry.mode` names', () => {
      expect(expiry({ 'expiry.mode': 'days', 'expiry.days': '0', 'expiry.date': 'garbage' })).toMatchObject({ ok: true, value: { expiry: { days: 0 } } });
      expect(expiry({ 'expiry.mode': 'date', 'expiry.days': 'garbage', 'expiry.date': '2026-10-06' })).toMatchObject({
        ok: true,
        value: { expiry: { date: '2026-10-06' } },
      });
    });

    it('answers FIELD_REQUIRED on the branch that was chosen and left empty', () => {
      expect(only(expiry({ 'expiry.mode': 'days', 'expiry.days': '' }))).toEqual({ field: 'expiry.days', code: 'FIELD_REQUIRED' });
      expect(only(expiry({ 'expiry.mode': 'date', 'expiry.date': '' }))).toEqual({ field: 'expiry.date', code: 'FIELD_REQUIRED' });
    });

    it('answers the format error of the branch under its own key', () => {
      expect(only(expiry({ 'expiry.mode': 'days', 'expiry.days': '2.5' }))).toEqual({ field: 'expiry.days', code: 'INT_FORMAT' });
      expect(only(expiry({ 'expiry.mode': 'date', 'expiry.date': '6 Oct' }))).toEqual({ field: 'expiry.date', code: 'DATE_FORMAT' });
    });

    it('needs a mode, and a mode that is one of the branches', () => {
      expect(only(expiry({ 'expiry.mode': '' }))).toEqual({ field: 'expiry.mode', code: 'FIELD_REQUIRED' });
      expect(only(expiry({ 'expiry.mode': 'weeks' }))).toEqual({ field: 'expiry.mode', code: 'CHOICE_UNKNOWN' });
      expect(only(expiry({ 'expiry.mode': 'constructor' }))).toEqual({ field: 'expiry.mode', code: 'CHOICE_UNKNOWN' });
    });
  });

  describe('rows', () => {
    const rowValues = (rows: readonly (readonly [string, string, string])[]): FormValues => ({
      recipeId: '',
      name: 'Soup',
      'draft.cuisineId': '',
      ...Object.fromEntries(
        rows.flatMap(([foodTypeId, quantity, unit], index) => [
          [`draft.rows.${index}.foodTypeId`, foodTypeId],
          [`draft.rows.${index}.quantity`, quantity],
          [`draft.rows.${index}.unit`, unit],
        ]),
      ),
    });

    it('wants at least one ingredient row, and puts the error on the rows', () => {
      expect(only(formSchemaParser(FORM_SCHEMAS.recipe, rowValues([])))).toEqual({ field: 'draft.rows', code: 'FIELD_REQUIRED' });
    });

    it('reports every bad field of every row under the key of the row, in order', () => {
      const result = formSchemaParser(FORM_SCHEMAS.recipe, rowValues([['', '1', 'grams'], ['4', '1.2345', 'cups'], ['5', '', '']]));

      expect(errorsOf(result)).toEqual([
        { field: 'draft.rows.0.foodTypeId', code: 'FIELD_REQUIRED' },
        { field: 'draft.rows.1.quantity', code: 'QTY_DECIMALS' },
        { field: 'draft.rows.1.unit', code: 'CHOICE_UNKNOWN' },
        { field: 'draft.rows.2.quantity', code: 'FIELD_REQUIRED' },
        { field: 'draft.rows.2.unit', code: 'FIELD_REQUIRED' },
      ]);
    });

    it('reads the cuisine from inside the group, and null for the default', () => {
      expect(formSchemaParser(FORM_SCHEMAS.recipe, rowValues([['4', '1', 'grams']]))).toMatchObject({ ok: true, value: { draft: { cuisineId: null } } });
    });

    it('does not mind a row that has a gap after it or a key that is not a row', () => {
      const values = { ...rowValues([['4', '1', 'grams']]), 'draft.rows.note': 'not a row', 'draft.other': 'x' };

      expect(formSchemaParser(FORM_SCHEMAS.recipe, values)).toMatchObject({ ok: true, value: { draft: { rows: [{ foodTypeId: 4 }] } } });
    });
  });

  describe('every error code of a form', () => {
    it('is produced by a failing input: FIELD_REQUIRED, QTY_FORMAT, QTY_DECIMALS, INT_FORMAT, DATE_FORMAT and CHOICE_UNKNOWN', () => {
      const result = formSchemaParser(FORM_SCHEMAS.batchAdd, {
        foodTypeId: 'x',
        foodName: '',
        categoryId: '',
        unit: 'cups',
        quantity: '1,5',
        'expiry.mode': 'days',
        'expiry.days': '2.5',
      });

      expect(errorsOf(result)).toEqual([
        { field: 'foodTypeId', code: 'CHOICE_UNKNOWN' },
        { field: 'unit', code: 'CHOICE_UNKNOWN' },
        { field: 'quantity', code: 'QTY_FORMAT' },
        { field: 'expiry.days', code: 'INT_FORMAT' },
      ]);
      expect(quantityOf('1.2345')).toBe('QTY_DECIMALS');
      expect(only(formSchemaParser(FORM_SCHEMAS.settings, { date: 'soon' }))?.code).toBe('DATE_FORMAT');
      expect(quantityOf('')).toBe('FIELD_REQUIRED');
    });
  });

  it('reads every field and reports them all, so a form with several bad fields is not fixed one at a time', () => {
    const result = formSchemaParser(FORM_SCHEMAS.batchQty, { batchId: 'x', quantity: '-1' });

    expect(errorsOf(result).map((error) => error.field)).toEqual(['batchId', 'quantity']);
  });

  it('ignores keys that the schema does not name, and does not change the values it is given', () => {
    const values = Object.freeze({ batchId: '21', quantity: '1', title: 'Edit quantity', 'lines.0': 'ignored' });

    expect(formSchemaParser(FORM_SCHEMAS.batchQty, values)).toEqual({ ok: true, value: { batchId: 21, quantity: 1000 } });
    expect(values).toEqual({ batchId: '21', quantity: '1', title: 'Edit quantity', 'lines.0': 'ignored' });
  });
});
