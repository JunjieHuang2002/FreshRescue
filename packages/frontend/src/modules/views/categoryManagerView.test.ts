import { describe, expect, it } from 'vitest';
import type { ReferenceDataDto } from '@freshrescue/contract-views';
import { CHINESE, CLOSED_FORM, DAIRY, FRENCH, MEAT, REFERENCE, formOf } from '../../testing/fixtures';
import { eventsOf, findButton, nodesOf, problemsOf, renderText } from '../../testing/render';
import { formPrefillBuilder } from '../computation/formPrefillBuilder';
import type { PrefillData } from '../computation/formPrefillBuilder';
import { categoryManagerView } from './categoryManagerView';

/** The labels of the buttons in the row of the category with this name. */
const buttonsOf = (tree: ReturnType<typeof categoryManagerView>, name: string): string[] => {
  const row = nodesOf(tree).find((node) => node.kind === 'box' && node.layout === 'row' && node.children.some((child) => child.kind === 'text' && child.text === name));
  return row?.kind === 'box' ? row.children.flatMap((child) => (child.kind === 'button' ? [child.label] : [])) : [];
};

describe('FU-16 CategoryManagerView', () => {
  const tree = categoryManagerView(CLOSED_FORM, CLOSED_FORM, REFERENCE);
  const text = renderText(tree);

  it('draws the food category tree, with the children of a Parent under it, and the cuisines (spec 4.1)', () => {
    expect(problemsOf(tree)).toEqual([]);
    expect(text).toContain('text: Food categories (title)');
    expect(text).toContain('text: Recipe cuisines (title)');
    const names = nodesOf(tree).flatMap((node) => (node.kind === 'text' && !node.tone ? [node.text] : []));

    expect(names).toEqual([
      'Meat',
      '— Red Meat',
      '— Poultry',
      'Dairy',
      '— Liquid Dairy',
      'Vegetables',
      '— Leafy Greens',
      'Other',
      'Chinese Cuisine',
      'Vietnamese Cuisine',
      'French Cuisine',
      'Other',
    ]);
  });

  it('shows the threshold of a food category, or that it is inherited', () => {
    expect(text).toContain('text: Threshold: 5 days (muted)');
    expect(text).toContain('text: Threshold: inherited (muted)');
    expect(text.match(/Threshold: 5 days/g)).toHaveLength(1);
  });

  it('gives a Parent food category buttons to rename it, set its threshold, add a child, and delete it', () => {
    expect(buttonsOf(tree, 'Meat')).toEqual(['Rename', 'Set threshold', 'Add child', 'Delete']);
  });

  it('gives a Child no button to add a child, because a Child cannot have children (spec 4.1)', () => {
    expect(buttonsOf(tree, '— Red Meat')).toEqual(['Rename', 'Set threshold', 'Delete']);
  });

  it('gives a cuisine no threshold and no child, which a cuisine does not have', () => {
    expect(buttonsOf(tree, 'French Cuisine')).toEqual(['Rename', 'Delete']);
  });

  it('gives `Other` no button at all: it cannot be renamed, deleted, given a child or a threshold (spec 4.1)', () => {
    const others = nodesOf(tree).filter((node) => node.kind === 'box' && node.layout === 'row' && node.children.some((child) => child.kind === 'text' && child.text === 'Other'));

    expect(others).toHaveLength(2);
    for (const row of others) expect(row.kind === 'box' ? row.children.filter((child) => child.kind === 'button') : []).toEqual([]);
  });

  describe('the events of the buttons carry the category that they are about', () => {
    const events = eventsOf(tree);

    it('rename', () => {
      expect(events).toContainEqual({ ns: 'category', name: 'renameCategory', payload: { scope: 'foodCategory', category: MEAT } });
      expect(events).toContainEqual({ ns: 'category', name: 'renameCategory', payload: { scope: 'cuisine', category: FRENCH } });
    });

    it('set the threshold, with the category as it is now, whatever days it has', () => {
      expect(events).toContainEqual({ ns: 'threshold', name: 'setThreshold', payload: { category: MEAT } });
      expect(events).toContainEqual({ ns: 'threshold', name: 'setThreshold', payload: { category: DAIRY } });
    });

    it('add a child under a Parent, a Parent, and a cuisine', () => {
      expect(events).toContainEqual({ ns: 'category', name: 'newCategory', payload: { scope: 'foodCategory', parent: MEAT } });
      expect(findButton(tree, 'Add food category')?.event).toEqual({ ns: 'category', name: 'newCategory', payload: { scope: 'foodCategory', parent: null } });
      expect(findButton(tree, 'Add cuisine')?.event).toEqual({ ns: 'category', name: 'newCategory', payload: { scope: 'cuisine', parent: null } });
    });

    it('delete, with the tree that the category is in', () => {
      expect(events).toContainEqual({ ns: 'categoryDelete', name: 'deleteCategory', payload: { scope: 'foodCategory', category: DAIRY.children[0] } });
      expect(events).toContainEqual({ ns: 'categoryDelete', name: 'deleteCategory', payload: { scope: 'cuisine', category: CHINESE } });
    });
  });

  describe('the create and rename form', () => {
    const create = (data: PrefillData['categoryCreate'], mode: 'editing' | 'submitting' = 'editing', hints = {}) => {
      const { values, options } = formPrefillBuilder('categoryCreate', data, REFERENCE);
      return categoryManagerView(formOf('categoryCreate', values, options, mode, hints), CLOSED_FORM, REFERENCE);
    };
    const rename = (data: PrefillData['categoryRename']) => {
      const { values, options } = formPrefillBuilder('categoryRename', data, REFERENCE);
      return categoryManagerView(formOf('categoryRename', values, options), CLOSED_FORM, REFERENCE);
    };

    it('names what it creates: a food category, a child of a Parent, a cuisine', () => {
      expect(renderText(create({ scope: 'foodCategory', parent: null }))).toContain('text: New food category (title)');
      expect(renderText(create({ scope: 'foodCategory', parent: MEAT }))).toContain('text: New child category of Meat (title)');
      expect(renderText(create({ scope: 'cuisine', parent: null }))).toContain('text: New cuisine (title)');
    });

    it('starts a rename at the name that the category has', () => {
      const tree = rename({ scope: 'cuisine', category: FRENCH });

      expect(renderText(tree)).toContain('text: Rename category (title)');
      expect(nodesOf(tree).find((node) => node.kind === 'input')).toMatchObject({ label: 'Name', value: 'French Cuisine', event: { ns: 'category', name: 'edit', payload: { field: 'name' } } });
    });

    it('has Save and Cancel, shows the hint of the name, and is disabled while it submits', () => {
      const hinted = create({ scope: 'foodCategory', parent: null }, 'editing', { name: 'The name Other is reserved. Choose another name.' });
      const submitting = create({ scope: 'foodCategory', parent: null }, 'submitting');

      expect(findButton(hinted, 'Save')?.event).toEqual({ ns: 'category', name: 'submit', payload: {} });
      expect(findButton(hinted, 'Cancel')?.event).toEqual({ ns: 'category', name: 'cancel', payload: {} });
      expect(renderText(hinted)).toContain('[The name Other is reserved. Choose another name.]');
      expect(findButton(submitting, 'Saving…')).toMatchObject({ disabled: true });
      expect(nodesOf(submitting).find((node) => node.kind === 'input')).toMatchObject({ disabled: true });
    });
  });

  describe('the threshold form', () => {
    const open = (mode: 'editing' | 'submitting' = 'editing', hints = {}) => {
      const { values, options } = formPrefillBuilder('thresholdSet', { category: MEAT }, REFERENCE);
      return categoryManagerView(CLOSED_FORM, formOf('thresholdSet', values, options, mode, hints), REFERENCE);
    };

    it('starts at the days that the category has, and says that empty means to inherit', () => {
      const tree = open();

      expect(problemsOf(tree)).toEqual([]);
      expect(renderText(tree)).toContain('text: Near-expiry threshold of Meat (title)');
      expect(nodesOf(tree).find((node) => node.kind === 'input')).toMatchObject({ label: 'Days', value: '5', event: { ns: 'threshold', name: 'edit', payload: { field: 'thresholdDays' } } });
      expect(renderText(tree)).toContain('Leave it empty to inherit');
    });

    it('has Save and Cancel for the threshold namespace, shows the hint, and is disabled while it submits', () => {
      const tree = open('editing', { thresholdDays: 'The threshold must be a whole number of days, at least 1.' });

      expect(findButton(tree, 'Save')?.event).toEqual({ ns: 'threshold', name: 'submit', payload: {} });
      expect(findButton(tree, 'Cancel')?.event).toEqual({ ns: 'threshold', name: 'cancel', payload: {} });
      expect(renderText(tree)).toContain('[The threshold must be a whole number of days, at least 1.]');
      expect(findButton(open('submitting'), 'Saving…')).toMatchObject({ disabled: true });
    });
  });

  it('draws both forms above the trees when both are open', () => {
    const create = formPrefillBuilder('categoryCreate', { scope: 'cuisine', parent: null }, REFERENCE);
    const set = formPrefillBuilder('thresholdSet', { category: MEAT }, REFERENCE);
    const both = renderText(categoryManagerView(formOf('categoryCreate', create.values), formOf('thresholdSet', set.values), REFERENCE));

    expect(both.indexOf('New cuisine')).toBeLessThan(both.indexOf('Near-expiry threshold of Meat'));
    expect(both.indexOf('Near-expiry threshold of Meat')).toBeLessThan(both.indexOf('Food categories'));
  });

  it('says that it is loading when the reference data has not arrived, and still shows an open form', () => {
    const loading = categoryManagerView(CLOSED_FORM, CLOSED_FORM, null);

    expect(renderText(loading)).toContain('text: Loading categories… (muted)');
    expect(eventsOf(loading)).toEqual([]);
    const { values } = formPrefillBuilder('categoryCreate', { scope: 'foodCategory', parent: null }, null);

    expect(renderText(categoryManagerView(formOf('categoryCreate', values), CLOSED_FORM, null))).toContain('text: New food category (title)');
  });

  it('draws a tree that has no category but `Other`', () => {
    const bare: ReferenceDataDto = {
      ...REFERENCE,
      foodCategories: REFERENCE.foodCategories.filter((node) => node.isSystem),
      cuisines: REFERENCE.cuisines.filter((node) => node.isSystem),
    };
    const tree = categoryManagerView(CLOSED_FORM, CLOSED_FORM, bare);

    expect(problemsOf(tree)).toEqual([]);
    expect(eventsOf(tree).map((event) => event.name)).toEqual(['newCategory', 'newCategory']);
  });

  it('leaves the other forms to the views that draw them', () => {
    const other = formOf('batchQty', { quantity: '1' });

    expect(renderText(categoryManagerView(other, other, REFERENCE))).not.toContain('Edit quantity');
    expect(renderText(categoryManagerView(other, other, REFERENCE))).toBe(text);
  });
});
