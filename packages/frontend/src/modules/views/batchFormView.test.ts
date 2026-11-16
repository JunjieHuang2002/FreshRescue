import { describe, expect, it } from 'vitest';
import type { FormState } from '@freshrescue/contract-ui';
import { BATCH_B, CLOSED_FORM, DETAIL, REFERENCE, formOf } from '../../testing/fixtures';
import { editedFieldsOf, eventsOf, findButton, nodesOf, problemsOf, renderText } from '../../testing/render';
import { formPrefillBuilder } from '../computation/formPrefillBuilder';
import type { PrefillData } from '../computation/formPrefillBuilder';
import { batchFormView } from './batchFormView';

const addForm = (data: PrefillData['batchAdd'], mode: 'editing' | 'submitting' = 'editing', hints = {}): FormState => {
  const { values, options } = formPrefillBuilder('batchAdd', data, REFERENCE);
  return formOf('batchAdd', values, options, mode, hints);
};

const inputLabels = (tree: ReturnType<typeof batchFormView>): string[] =>
  nodesOf(tree).flatMap((node) => (node.kind === 'input' || node.kind === 'select' ? [node.label] : []));

describe('FU-06 BatchFormView', () => {
  it('draws nothing for a form that is closed, and for a form that another view draws', () => {
    expect(batchFormView(CLOSED_FORM)).toEqual({ kind: 'box', layout: 'stack', children: [] });
    expect(batchFormView(formOf('foodTypeCreate', {}))).toEqual({ kind: 'box', layout: 'stack', children: [] });
  });

  describe('adding a batch for a new Food Type', () => {
    const tree = batchFormView(addForm({ foodTypeId: null }));

    it('asks for the name, the category and the unit of the new Food Type, then the quantity and the expiry', () => {
      expect(problemsOf(tree)).toEqual([]);
      expect(inputLabels(tree)).toEqual(['Food Type', 'New Food Type name', 'Category', 'Unit', 'Quantity', 'Expiry given as', 'Shelf life in days']);
      expect(renderText(tree)).toContain('text: Add batch (title)');
    });

    it('lets the person pick an existing Food Type instead, or stay on "New Food Type"', () => {
      const pick = nodesOf(tree).find((node) => node.kind === 'select' && node.label === 'Food Type');

      expect(pick).toMatchObject({ value: '', event: { ns: 'batch', name: 'pickFoodType', payload: {} } });
      expect(pick?.kind === 'select' ? pick.choices.map((choice) => choice.label).slice(0, 3) : []).toEqual(['New Food Type', 'Beef', 'Broccoli']);
    });

    it('starts on a shelf life in days, and shows the date field when the expiry is given as a date', () => {
      const byDate = batchFormView(formOf('batchAdd', { ...addForm({ foodTypeId: null }).context.values, 'expiry.mode': 'date' }, addForm({ foodTypeId: null }).context.options));

      expect(inputLabels(byDate)).toContain('Expiration date');
      expect(inputLabels(byDate)).not.toContain('Shelf life in days');
      expect(nodesOf(byDate).find((node) => node.kind === 'input' && node.label === 'Expiration date')).toMatchObject({ inputType: 'date' });
    });

    it('sends each field as an edit of that field', () => {
      expect(editedFieldsOf(tree)).toEqual(['foodName', 'categoryId', 'unit', 'quantity', 'expiry.mode', 'expiry.days']);
    });
  });

  describe('adding a batch to a Food Type that exists (spec exception 4)', () => {
    const tree = batchFormView(addForm({ foodTypeId: 24 }));
    const text = renderText(tree);

    it('shows its unit and its category read-only', () => {
      expect(problemsOf(tree)).toEqual([]);
      expect(text).toContain('text: Unit: ml');
      expect(text).toContain('text: Category: Dairy → Liquid Dairy');
    });

    it('draws no field for a name, a category or a unit, so a picked Food Type and a typed name are never both filled', () => {
      expect(inputLabels(tree)).toEqual(['Food Type', 'Quantity', 'Expiry given as', 'Shelf life in days']);
    });

    it('has the Food Type picked', () => {
      expect(nodesOf(tree).find((node) => node.kind === 'select' && node.label === 'Food Type')).toMatchObject({ value: '24' });
    });
  });

  it('puts the hints beside their fields, and a hint for each end of the expiry', () => {
    const tree = batchFormView(addForm({ foodTypeId: 24 }, 'editing', { quantity: 'The quantity must be at least 0.001.', 'expiry.days': 'Use a whole number, like 3.' }));
    const text = renderText(tree);

    expect(text).toContain('input Quantity:  [The quantity must be at least 0.001.]');
    expect(text).toContain('input Shelf life in days:  [Use a whole number, like 3.]');
  });

  it('disables the fields and the buttons, and says so, while it is submitting', () => {
    const tree = batchFormView(addForm({ foodTypeId: 24 }, 'submitting'));

    for (const node of nodesOf(tree)) {
      if (node.kind === 'input' || node.kind === 'select') expect(node.disabled).toBe(true);
    }
    expect(findButton(tree, 'Saving…')).toMatchObject({ disabled: true });
    expect(findButton(tree, 'Cancel')).toMatchObject({ disabled: true });
  });

  it('ends in Save and Cancel, which go to the batch namespace', () => {
    const tree = batchFormView(addForm({ foodTypeId: null }));

    expect(findButton(tree, 'Save')?.event).toEqual({ ns: 'batch', name: 'submit', payload: {} });
    expect(findButton(tree, 'Cancel')?.event).toEqual({ ns: 'batch', name: 'cancel', payload: {} });
    expect(new Set(eventsOf(tree).map((event) => event.ns))).toEqual(new Set(['batch']));
  });

  describe('editing the quantity of a batch', () => {
    const { values, options } = formPrefillBuilder('batchQty', { batch: BATCH_B, foodType: DETAIL }, REFERENCE);
    const tree = batchFormView(formOf('batchQty', values, options));

    it('has one field, the quantity, which starts at the quantity that the batch has', () => {
      expect(problemsOf(tree)).toEqual([]);
      expect(inputLabels(tree)).toEqual(['Quantity']);
      expect(nodesOf(tree).find((node) => node.kind === 'input')).toMatchObject({ value: '150', event: { ns: 'batch', name: 'edit', payload: { field: 'quantity' } } });
    });

    it('names what the batch belongs to, and says that nothing else about it can change (spec 4.2.1)', () => {
      const text = renderText(tree);

      expect(text).toContain('text: Edit quantity (title)');
      expect(text).toContain('text: Beef · grams');
      expect(text).toContain('Only the quantity of a batch can be changed');
    });
  });
});
