import { describe, expect, it } from 'vitest';
import type { FormState } from '@freshrescue/contract-ui';
import type { CatalogRow } from '@freshrescue/contract-views';
import { CLOSED_FORM, REFERENCE, STIR_FRY, formOf } from '../../testing/fixtures';
import { editedFieldsOf, eventsOf, findButton, nodesOf, problemsOf, renderText } from '../../testing/render';
import { formPrefillBuilder } from '../computation/formPrefillBuilder';
import { recipeFormView } from './recipeFormView';

// the recipe that is edited: 300 g of Beef and 200 g of Broccoli, as the catalog shows it
const opened = (kind: 'recipeCreate' | 'recipeEdit', recipe: CatalogRow = STIR_FRY, mode: 'editing' | 'submitting' = 'editing', hints = {}): FormState => {
  const { values, options } =
    kind === 'recipeEdit' ? formPrefillBuilder('recipeEdit', { recipe }, REFERENCE) : formPrefillBuilder('recipeCreate', {}, REFERENCE);
  return formOf(kind, values, options, mode, hints);
};

const labels = (tree: ReturnType<typeof recipeFormView>): string[] =>
  nodesOf(tree).flatMap((node) => (node.kind === 'input' || node.kind === 'select' ? [node.label] : []));

describe('FU-15 RecipeFormView', () => {
  it('draws nothing for a form that is closed, and for a form that another view draws', () => {
    expect(recipeFormView(CLOSED_FORM)).toEqual({ kind: 'box', layout: 'stack', children: [] });
    expect(recipeFormView(formOf('batchAdd', {}))).toEqual({ kind: 'box', layout: 'stack', children: [] });
  });

  describe('a new recipe', () => {
    const tree = recipeFormView(opened('recipeCreate'));

    it('asks for a name and a cuisine, and starts with one ingredient row to fill in', () => {
      expect(problemsOf(tree)).toEqual([]);
      expect(renderText(tree)).toContain('text: New recipe (title)');
      expect(labels(tree)).toEqual(['Recipe name', 'Cuisine', 'Food Type', 'Quantity', 'Unit']);
    });

    it('starts in the cuisine `Other`', () => {
      expect(nodesOf(tree).find((node) => node.kind === 'select' && node.label === 'Cuisine')).toMatchObject({ value: '2' });
    });

    it('offers the Food Types and the six units in a row', () => {
      const foodType = nodesOf(tree).find((node) => node.kind === 'select' && node.label === 'Food Type');
      const unit = nodesOf(tree).find((node) => node.kind === 'select' && node.label === 'Unit');

      expect(foodType?.kind === 'select' ? foodType.choices.map((choice) => choice.label).slice(0, 3) : []).toEqual(['Choose a Food Type', 'Beef', 'Broccoli']);
      expect(unit?.kind === 'select' ? unit.choices.map((choice) => choice.value) : []).toEqual(['', 'grams', 'kg', 'ml', 'liters', 'pieces', 'cartons']);
    });

    it('cannot remove its only row, because a recipe needs an ingredient', () => {
      expect(findButton(tree, 'Remove')).toMatchObject({ disabled: true });
    });
  });

  describe('a recipe that is edited', () => {
    const tree = recipeFormView(opened('recipeEdit'));
    const text = renderText(tree);

    it('shows its name, its cuisine and a row for each ingredient with its quantity as decimal text', () => {
      expect(problemsOf(tree)).toEqual([]);
      expect(text).toContain('text: Edit recipe (title)');
      expect(text).toContain('input Recipe name: Beef and Broccoli Stir-Fry');
      expect(text).toContain('select Cuisine: 10 of Chinese Cuisine');
      expect(text).toContain('select Food Type: 20 of');
      expect(text).toContain('input Quantity: 300');
      expect(text).toContain('input Quantity: 200');
      expect(text.match(/select Unit: grams/g)).toHaveLength(2);
    });

    it('sends the fields of a row as edits of the keys `draft.rows.<n>.<field>`', () => {
      expect(editedFieldsOf(tree)).toEqual([
        'name',
        'draft.cuisineId',
        'draft.rows.0.foodTypeId',
        'draft.rows.0.quantity',
        'draft.rows.0.unit',
        'draft.rows.1.foodTypeId',
        'draft.rows.1.quantity',
        'draft.rows.1.unit',
      ]);
    });

    it('can remove either row, each by its index', () => {
      const removes = eventsOf(tree).filter((event) => event.name === 'removeRow');

      expect(removes).toEqual([
        { ns: 'recipe', name: 'removeRow', payload: { group: 'draft.rows', index: 0 } },
        { ns: 'recipe', name: 'removeRow', payload: { group: 'draft.rows', index: 1 } },
      ]);
      expect(nodesOf(tree).filter((node) => node.kind === 'button' && node.label === 'Remove' && node.disabled)).toHaveLength(0);
    });

    it('can add an ingredient', () => {
      expect(findButton(tree, 'Add ingredient')?.event).toEqual({ ns: 'recipe', name: 'addRow', payload: { group: 'draft.rows', fields: ['foodTypeId', 'quantity', 'unit'] } });
    });

    it('leaves the Food Type of a row empty when it was deleted, so that the person picks another (blueprint 3.3)', () => {
      const [beef, broccoli] = STIR_FRY.ingredients;
      const deleted: CatalogRow = { ...STIR_FRY, ingredients: [beef!, { ...broccoli!, state: 'missingFoodType' }] };
      const gone = recipeFormView(opened('recipeEdit', deleted));
      const rows = nodesOf(gone).filter((node) => node.kind === 'select' && node.label === 'Food Type');

      expect(rows.map((node) => (node.kind === 'select' ? node.value : ''))).toEqual(['20', '']);
    });
  });

  it('puts the hints beside their fields, and the hint of the rows above them', () => {
    const tree = recipeFormView(
      opened('recipeEdit', STIR_FRY, 'editing', {
        name: 'That name is already used. Choose another name.',
        'draft.rows.1.quantity': 'Use at most 3 decimal places.',
        'draft.rows': 'This field is required.',
      }),
    );
    const text = renderText(tree);

    expect(text).toContain('input Recipe name: Beef and Broccoli Stir-Fry [That name is already used. Choose another name.]');
    expect(text).toContain('input Quantity: 200 [Use at most 3 decimal places.]');
    expect(text).toContain('text: This field is required. (badNote)');
  });

  it('disables everything while it is submitting', () => {
    const tree = recipeFormView(opened('recipeEdit', STIR_FRY, 'submitting'));

    for (const node of nodesOf(tree)) {
      if (node.kind === 'input' || node.kind === 'select' || node.kind === 'button') expect(node.disabled).toBe(true);
    }
    expect(findButton(tree, 'Saving…')).toBeDefined();
  });

  it('ends in Save and Cancel, and sends every event to the recipe namespace', () => {
    const tree = recipeFormView(opened('recipeCreate'));

    expect(findButton(tree, 'Save')?.event).toEqual({ ns: 'recipe', name: 'submit', payload: {} });
    expect(findButton(tree, 'Cancel')?.event).toEqual({ ns: 'recipe', name: 'cancel', payload: {} });
    expect(new Set(eventsOf(tree).map((event) => event.ns))).toEqual(new Set(['recipe']));
  });

  it('draws the rows in order even when the form has been given them out of order', () => {
    const values = { recipeId: '', name: 'x', 'draft.cuisineId': '2', 'draft.rows.10.quantity': 'c', 'draft.rows.2.quantity': 'b', 'draft.rows.9.quantity': 'd' };
    const tree = recipeFormView(formOf('recipeCreate', values, {}));
    const quantities = nodesOf(tree).flatMap((node) => (node.kind === 'input' && node.label === 'Quantity' ? [node.value] : []));

    expect(quantities).toEqual(['b', 'd', 'c']);
  });
});
