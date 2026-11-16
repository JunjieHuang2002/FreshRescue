import { describe, expect, it } from 'vitest';
import { CLOSED_FORM, DETAIL_EMPTY, REFERENCE, formOf } from '../../testing/fixtures';
import { editedFieldsOf, eventsOf, findButton, nodesOf, problemsOf, renderText } from '../../testing/render';
import { formPrefillBuilder } from '../computation/formPrefillBuilder';
import { foodTypeFormView } from './foodTypeFormView';

// the edit form opens on Egg: in pieces, in Other, with a threshold of 2 days of its own
const opened = (kind: 'foodTypeCreate' | 'foodTypeEdit', mode: 'editing' | 'submitting' = 'editing', hints = {}) => {
  const { values, options } =
    kind === 'foodTypeEdit' ? formPrefillBuilder('foodTypeEdit', { foodType: DETAIL_EMPTY }, REFERENCE) : formPrefillBuilder('foodTypeCreate', {}, REFERENCE);
  return formOf(kind, values, options, mode, hints);
};

const labels = (tree: ReturnType<typeof foodTypeFormView>): string[] =>
  nodesOf(tree).flatMap((node) => (node.kind === 'input' || node.kind === 'select' ? [node.label] : []));

describe('FU-07 FoodTypeFormView', () => {
  it('draws nothing for a form that is closed, and for a form that another view draws', () => {
    expect(foodTypeFormView(CLOSED_FORM)).toEqual({ kind: 'box', layout: 'stack', children: [] });
    expect(foodTypeFormView(formOf('batchAdd', {}))).toEqual({ kind: 'box', layout: 'stack', children: [] });
  });

  describe('a new Food Type (spec 4.2.5)', () => {
    const tree = foodTypeFormView(opened('foodTypeCreate'));

    it('asks for a name, a category, a unit and a threshold', () => {
      expect(problemsOf(tree)).toEqual([]);
      expect(renderText(tree)).toContain('text: Add Food Type (title)');
      expect(labels(tree)).toEqual(['Name', 'Category', 'Unit', 'Near-expiry threshold in days']);
    });

    it('starts in `Other`, with the unit left to choose', () => {
      expect(nodesOf(tree).find((node) => node.kind === 'select' && node.label === 'Category')).toMatchObject({ value: '1' });
      const unit = nodesOf(tree).find((node) => node.kind === 'select' && node.label === 'Unit');

      expect(unit).toMatchObject({ value: '' });
      expect(unit?.kind === 'select' ? unit.choices.map((choice) => choice.value) : []).toEqual(['', 'grams', 'kg', 'ml', 'liters', 'pieces', 'cartons']);
    });

    it('offers the categories with their children', () => {
      const category = nodesOf(tree).find((node) => node.kind === 'select' && node.label === 'Category');

      expect(category?.kind === 'select' ? category.choices.map((choice) => choice.label) : []).toContain('Meat → Poultry');
    });
  });

  describe('an existing Food Type', () => {
    const tree = foodTypeFormView(opened('foodTypeEdit'));

    it('shows what it has now', () => {
      expect(renderText(tree)).toContain('text: Edit Food Type (title)');
      expect(nodesOf(tree).find((node) => node.kind === 'input' && node.label === 'Name')).toMatchObject({ value: 'Egg' });
      expect(nodesOf(tree).find((node) => node.kind === 'input' && node.label === 'Near-expiry threshold in days')).toMatchObject({ value: '2' });
    });

    it('shows the unit read-only, and says where to change it (spec 4.2.2)', () => {
      expect(labels(tree)).toEqual(['Name', 'Category', 'Near-expiry threshold in days']);
      expect(renderText(tree)).toContain('text: Unit: pieces');
      expect(renderText(tree)).toContain('use Change unit');
    });

    it('can clear the threshold by emptying it, and says that this inherits one', () => {
      expect(renderText(tree)).toContain('Leave the threshold empty to use the one of its category');
    });
  });

  it('puts the hints beside their fields', () => {
    const tree = foodTypeFormView(opened('foodTypeCreate', 'editing', { name: 'The name is empty. Enter 1 to 200 characters.', unit: 'Choose one of the units in the list.' }));
    const text = renderText(tree);

    expect(text).toContain('input Name:  [The name is empty. Enter 1 to 200 characters.]');
    expect(text).toContain('[Choose one of the units in the list.]');
  });

  it('disables everything while it is submitting', () => {
    const tree = foodTypeFormView(opened('foodTypeCreate', 'submitting'));

    for (const node of nodesOf(tree)) {
      if (node.kind === 'input' || node.kind === 'select') expect(node.disabled).toBe(true);
    }
    expect(findButton(tree, 'Saving…')).toMatchObject({ disabled: true });
  });

  it('sends every event to the foodType namespace, and each field as an edit of that field', () => {
    const tree = foodTypeFormView(opened('foodTypeCreate'));

    expect(new Set(eventsOf(tree).map((event) => event.ns))).toEqual(new Set(['foodType']));
    expect(editedFieldsOf(tree)).toEqual(['name', 'categoryId', 'unit', 'thresholdDays']);
    expect(findButton(tree, 'Save')?.event.name).toBe('submit');
    expect(findButton(tree, 'Cancel')?.event.name).toBe('cancel');
  });
});
