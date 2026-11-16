import { afterEach, describe, expect, it } from 'vitest';
import { errorReply, okReply } from '../testing/fakeApi';
import { DETAIL_EMPTY, MEAT, REFERENCE } from '../testing/fixtures';
import { buttonOf, choose, click, hintOf, inputOf, isShown, openPage, settle, textsOf, typeInto } from '../testing/page';
import type { Page } from '../testing/page';

// The six workflows of TaxonomyCoordinator, and its redraw hook, each started from one event on the painted page.

let page: Page | null = null;
afterEach(() => {
  page?.close();
  page = null;
});

async function open(...args: Parameters<typeof openPage>): Promise<Page> {
  page = await openPage(...args);
  return page;
}

async function openDetailOf(name: string): Promise<void> {
  click(name);
  await settle();
}

async function openCategories(): Promise<void> {
  click('Categories');
  await settle();
}

describe('TaxonomyCoordinator: saveFoodType', () => {
  it('creates a Food Type without stock from the inventory list: SaveFoodType with no id, then a reload', async () => {
    const { api } = await open();
    click('Add Food Type');
    expect(textsOf('foodTypeForm')).toContain('Add Food Type');
    typeInto('Name', 'Milk');
    choose('Category', '7');
    choose('Unit', 'ml');
    api.forget();
    click('Save', { slot: 'foodTypeForm' });
    await settle();
    expect(api.requests).toEqual([
      { type: 'SaveFoodType', payload: { foodTypeId: null, name: 'Milk', categoryId: 7, unit: 'ml', thresholdDays: null } },
      { type: 'GetReferenceData', params: {} },
      { type: 'GetInventoryList', params: {} },
    ]);
    expect(textsOf('foodTypeForm')).toEqual([]);
  });

  it('edits the Food Type of the detail, prefilled with what it has, and reloads the detail too', async () => {
    const { api } = await open();
    await openDetailOf('Beef');
    click('Edit Food Type');
    expect([inputOf('Name').value, inputOf('Near-expiry threshold in days').value]).toEqual(['Beef', '']);
    expect(textsOf('foodTypeForm')).toContain('Unit: grams');
    typeInto('Name', 'Ground Beef');
    typeInto('Near-expiry threshold in days', '4');
    api.forget();
    click('Save', { slot: 'foodTypeForm' });
    await settle();
    expect(api.requests).toEqual([
      { type: 'SaveFoodType', payload: { foodTypeId: 20, name: 'Ground Beef', categoryId: 4, unit: 'grams', thresholdDays: 4 } },
      { type: 'GetReferenceData', params: {} },
      { type: 'GetInventoryList', params: {} },
      { type: 'GetFoodTypeDetail', params: { foodTypeId: 20 } },
    ]);
  });

  it('sends nothing for a threshold that is not a whole number (INT_FORMAT), and shows the refusal of a name that is taken (NAME_DUPLICATE) beside the name', async () => {
    const { api } = await open({ SaveFoodType: errorReply('NAME_DUPLICATE', 'name: Beef') });
    click('Add Food Type');
    typeInto('Name', 'beef');
    choose('Unit', 'grams');
    typeInto('Near-expiry threshold in days', '2.5');
    api.forget();
    click('Save', { slot: 'foodTypeForm' });
    await settle();
    expect(api.requests).toEqual([]);
    expect(hintOf('Near-expiry threshold in days')).toBe('Use a whole number, like 3.');

    typeInto('Near-expiry threshold in days', '');
    click('Save', { slot: 'foodTypeForm' });
    await settle();
    expect(api.types()).toEqual(['SaveFoodType']);
    expect(hintOf('Name')).toBe('That name is already used. Choose another name.');
    expect(textsOf('notices')[0]).toBe('That name is already used. Choose another name.');
  });
});

describe('TaxonomyCoordinator: a form on its way', () => {
  it('sends one SaveFoodType, and one DeleteCategory, when a form is submitted twice before the answer comes', async () => {
    const { api, app } = await open();
    click('Add Food Type');
    typeInto('Name', 'Milk');
    choose('Unit', 'ml');
    const saveFoodType = { ns: 'foodType', name: 'submit', payload: {} } as const;
    await Promise.all([app.dispatch(saveFoodType), app.dispatch(saveFoodType)]);
    await openCategories();
    click('Delete', { slot: 'categories', nth: 0 });
    const deleteCategory = { ns: 'categoryDelete', name: 'submit', payload: {} } as const;
    await Promise.all([app.dispatch(deleteCategory), app.dispatch(deleteCategory)]);
    expect([api.sent('SaveFoodType').length, api.sent('DeleteCategory').length]).toEqual([1, 1]);
  });
});

describe('TaxonomyCoordinator: changeUnit', () => {
  it('asks for the quantity of every batch in the new unit, keeps Save disabled until all are valid, and sends ChangeFoodTypeUnit', async () => {
    const { api } = await open();
    await openDetailOf('Beef');
    click('Change unit');
    expect(textsOf('unitConversion')).toEqual(expect.arrayContaining(['Change unit of Beef', 'Now in grams.', '100 grams, expires 2026-10-01', '300 grams, expires 2026-10-09']));
    expect(buttonOf('Save', { slot: 'unitConversion' }).disabled).toBe(true);
    choose('New unit', 'kg');
    typeInto('100 grams, expires 2026-10-01', '0.1');
    typeInto('150 grams, expires 2026-10-03', '0.15');
    expect(buttonOf('Save', { slot: 'unitConversion' }).disabled).toBe(true);
    typeInto('300 grams, expires 2026-10-09', '0.3');
    expect(buttonOf('Save', { slot: 'unitConversion' }).disabled).toBe(false);
    api.forget();
    click('Save', { slot: 'unitConversion' });
    await settle();
    expect(api.requests[0]).toEqual({
      type: 'ChangeFoodTypeUnit',
      payload: {
        foodTypeId: 20,
        unit: 'kg',
        batches: [
          { batchId: 31, quantity: 100 },
          { batchId: 32, quantity: 150 },
          { batchId: 33, quantity: 300 },
        ],
      },
    });
    expect(api.types().slice(1)).toEqual(['GetReferenceData', 'GetInventoryList', 'GetFoodTypeDetail']);
    expect(textsOf('unitConversion')).toEqual([]);
  });

  it('shows a refusal of the cap (CAP_EXCEEDED) as a notice and keeps the modal open', async () => {
    await open({ ChangeFoodTypeUnit: errorReply('CAP_EXCEEDED', 'the total would be 600,000 pieces') });
    await openDetailOf('Beef');
    click('Change unit');
    choose('New unit', 'pieces');
    for (const label of ['100 grams, expires 2026-10-01', '150 grams, expires 2026-10-03', '300 grams, expires 2026-10-09']) typeInto(label, '200000');
    click('Save', { slot: 'unitConversion' });
    await settle();
    expect(textsOf('notices')[0]).toBe('That would take this Food Type above 500,000 in total, so nothing was changed.');
    expect(textsOf('unitConversion')).toContain('Change unit of Beef');
  });
});

describe('TaxonomyCoordinator: deleteFoodType', () => {
  it('asks first, sends DeleteFoodType, closes the detail and reloads the list', async () => {
    const { api } = await open({ GetFoodTypeDetail: okReply('GetFoodTypeDetail', DETAIL_EMPTY) });
    await openDetailOf('Egg');
    click('Delete Food Type', { slot: 'foodTypeDetail' });
    expect(textsOf('confirm')).toEqual(['Delete Egg?', 'No recipe uses this Food Type.', 'Delete Food Type', 'Cancel']);
    api.forget();
    click('Delete Food Type', { slot: 'confirm' });
    await settle();
    expect(api.requests).toEqual([
      { type: 'DeleteFoodType', payload: { foodTypeId: 23 } },
      { type: 'GetReferenceData', params: {} },
      { type: 'GetInventoryList', params: {} },
    ]);
    expect([isShown('inventoryList'), isShown('foodTypeDetail')]).toEqual([true, false]);
  });

  it('lists the recipes that will become blocked, and shows the refusal of a Food Type that still has batches: "Remove all 3 batches first."', async () => {
    const { api } = await open({ DeleteFoodType: errorReply('HAS_BATCHES', 'Remove all 3 batches first') });
    await openDetailOf('Beef');
    click('Delete Food Type', { slot: 'foodTypeDetail' });
    expect(textsOf('confirm')).toContain('These recipes will become blocked: Beef and Broccoli Stir-Fry.');
    api.forget();
    click('Delete Food Type', { slot: 'confirm' });
    await settle();
    expect(api.types()).toEqual(['DeleteFoodType']);
    expect(textsOf('notices')[0]).toBe('Remove all 3 batches first.');
    expect(textsOf('confirm')[0]).toBe('Delete Beef?');
    expect(isShown('foodTypeDetail')).toBe(true);
  });
});

describe('TaxonomyCoordinator: saveCategory', () => {
  it('creates a Parent, a Child under a Parent and a cuisine, and renames a category in place, each with SaveCategory', async () => {
    const { api } = await open();
    await openCategories();
    const saves: unknown[] = [];
    const save = async (opener: () => void, name: string): Promise<void> => {
      opener();
      typeInto('Name', name, { slot: 'categories' });
      click('Save', { slot: 'categories' });
      await settle();
      saves.push(api.sent('SaveCategory').at(-1)?.payload);
    };
    await save(() => click('Add food category'), 'Fruit');
    await save(() => click('Add child', { nth: 0 }), 'Game');
    await save(() => click('Add cuisine'), 'Thai Cuisine');
    await save(() => click('Rename', { nth: 0 }), 'Meats');
    expect(saves).toEqual([
      { scope: 'foodCategory', categoryId: null, parentId: null, name: 'Fruit' },
      { scope: 'foodCategory', categoryId: null, parentId: 3, name: 'Game' },
      { scope: 'cuisine', categoryId: null, parentId: null, name: 'Thai Cuisine' },
      { scope: 'foodCategory', categoryId: 3, parentId: null, name: 'Meats' },
    ]);
  });

  it('reloads the reference data after a save, and the trees are drawn again from it', async () => {
    const withFruit = { ...REFERENCE, foodCategories: [...REFERENCE.foodCategories, { id: 50, name: 'Fruit', isSystem: false, customThresholdDays: null, children: [] }] };
    const { api } = await open({ GetReferenceData: (_message, earlier) => okReply('GetReferenceData', earlier < 2 ? REFERENCE : withFruit) });
    await openCategories();
    expect(textsOf('categories')).not.toContain('Fruit');
    click('Add food category');
    typeInto('Name', 'Fruit', { slot: 'categories' });
    api.forget();
    click('Save', { slot: 'categories' });
    await settle();
    expect(api.types()).toEqual(['SaveCategory', 'GetReferenceData']);
    expect(textsOf('categories')).toContain('Fruit');
    expect(textsOf('categories')).not.toContain('New food category');
  });

  it('shows the refusal of the reserved name (NAME_RESERVED) beside the name and keeps the form open', async () => {
    await open({ SaveCategory: errorReply('NAME_RESERVED', 'name: Other') });
    await openCategories();
    click('Add food category');
    typeInto('Name', 'other', { slot: 'categories' });
    click('Save', { slot: 'categories' });
    await settle();
    expect(hintOf('Name', { slot: 'categories' })).toBe('The name Other is reserved. Choose another name.');
    expect(textsOf('categories')).toContain('New food category');
  });
});

describe('TaxonomyCoordinator: deleteCategory', () => {
  it('asks first, saying that the contents fall back to Other, then sends DeleteCategory with the tree of the category', async () => {
    const { api } = await open();
    await openCategories();
    click('Delete', { slot: 'categories', nth: 0 });
    expect(textsOf('confirm')).toEqual([
      'Delete Meat?',
      'Its Food Types, and those of its child categories, move to Other. Its thresholds are deleted.',
      'Delete category',
      'Cancel',
    ]);
    api.forget();
    click('Delete category', { slot: 'confirm' });
    await settle();
    expect(api.requests).toEqual([
      { type: 'DeleteCategory', payload: { scope: 'foodCategory', categoryId: 3 } },
      { type: 'GetReferenceData', params: {} },
    ]);
    expect(textsOf('confirm')).toEqual([]);
  });

  it('deletes a cuisine from the cuisine tree, whose recipes move to Other', async () => {
    const { api } = await open();
    await openCategories();
    click('Delete', { slot: 'categories', nth: 9 });
    expect(textsOf('confirm')).toEqual(['Delete French Cuisine?', 'Its recipes move to Other.', 'Delete category', 'Cancel']);
    click('Delete category', { slot: 'confirm' });
    await settle();
    expect(api.sent('DeleteCategory')).toEqual([{ type: 'DeleteCategory', payload: { scope: 'cuisine', categoryId: 12 } }]);
  });

  it('sends nothing on Cancel', async () => {
    const { api } = await open();
    await openCategories();
    click('Delete', { slot: 'categories', nth: 0 });
    api.forget();
    click('Cancel', { slot: 'confirm' });
    await settle();
    expect(api.requests).toEqual([]);
  });
});

describe('TaxonomyCoordinator: setThreshold', () => {
  it('opens with the threshold of the category, sends SetCategoryThreshold with the new days, and an empty field clears it', async () => {
    const { api } = await open();
    await openCategories();
    click('Set threshold', { nth: 0 });
    expect(textsOf('categories')).toContain('Near-expiry threshold of Meat');
    expect(inputOf('Days').value).toBe(String(MEAT.customThresholdDays));
    typeInto('Days', '7');
    click('Save', { slot: 'categories' });
    await settle();
    click('Set threshold', { nth: 3 });
    typeInto('Days', '');
    click('Save', { slot: 'categories' });
    await settle();
    expect(api.sent('SetCategoryThreshold')).toEqual([
      { type: 'SetCategoryThreshold', payload: { categoryId: 3, thresholdDays: 7 } },
      { type: 'SetCategoryThreshold', payload: { categoryId: 6, thresholdDays: null } },
    ]);
  });

  it('sends nothing for days that are not a whole number, and shows the refusal of 0 days (THRESHOLD_INVALID) beside the field', async () => {
    const { api } = await open({ SetCategoryThreshold: errorReply('THRESHOLD_INVALID', 'thresholdDays: 0') });
    await openCategories();
    click('Set threshold', { nth: 0 });
    typeInto('Days', '1.5');
    api.forget();
    click('Save', { slot: 'categories' });
    await settle();
    expect(api.requests).toEqual([]);
    expect(hintOf('Days')).toBe('Use a whole number, like 3.');
    typeInto('Days', '0');
    click('Save', { slot: 'categories' });
    await settle();
    expect(hintOf('Days')).toBe('The threshold must be a whole number of days, at least 1.');
  });
});

describe('TaxonomyCoordinator: redraw', () => {
  it('draws the trees when the Categories tab opens, and again from the new reference data on every refresh, sending nothing of its own', async () => {
    const later = { ...REFERENCE, foodCategories: REFERENCE.foodCategories.map((node) => (node.name === 'Meat' ? { ...node, customThresholdDays: 6 } : node)) };
    const { api, timer } = await open({ GetReferenceData: (_message, earlier) => okReply('GetReferenceData', earlier < 2 ? REFERENCE : later) });
    expect(textsOf('categories')).toEqual([]);
    await openCategories();
    expect(textsOf('categories')).toEqual(expect.arrayContaining(['Food categories', 'Meat', 'Threshold: 5 days', 'Recipe cuisines', 'French Cuisine']));
    api.forget();
    timer.fire();
    await settle();
    expect(api.types()).toEqual(['GetReferenceData']);
    expect(textsOf('categories')).toContain('Threshold: 6 days');
  });
});
