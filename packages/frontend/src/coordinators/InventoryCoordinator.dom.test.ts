import { afterEach, describe, expect, it } from 'vitest';
import type { UiEvent } from '@freshrescue/contract-ui';
import { errorReply, heldReply, lostReply, okReply } from '../testing/fakeApi';
import { buttonOf, choose, click, hintOf, inputOf, isShown, openPage, selectOf, settle, textsOf, typeInto } from '../testing/page';
import type { Page } from '../testing/page';

// The seven workflows of InventoryCoordinator, each started from one event on the painted page.

let page: Page | null = null;
afterEach(() => {
  page?.close();
  page = null;
});

async function open(...args: Parameters<typeof openPage>): Promise<Page> {
  page = await openPage(...args);
  return page;
}

/** Opens the detail of Beef from the list. */
async function openBeef(): Promise<void> {
  click('Beef');
  await settle();
}

describe('InventoryCoordinator: loadList', () => {
  it('loads the list on startup and paints every Food Type with its path, total, status breakdown and badge', async () => {
    const { api } = await open();
    expect(api.sent('GetInventoryList')).toEqual([{ type: 'GetInventoryList', params: {} }]);
    expect(textsOf('inventoryList')).toEqual([
      'Inventory', 'Add Food Type', 'Add batch',
      'Beef', 'Meat → Red Meat', '550 grams', 'Fresh 300 · Near-Expiry 150 · Expired 100', 'Expired',
      'Broccoli', 'Vegetables', '250 grams', 'Fresh 250', 'Fresh',
      'Chicken', 'Meat → Poultry', '1.5 grams', 'Near-Expiry 1.5', 'Near-Expiry',
      'Egg', 'Other', '0 pieces', '—',
    ]);
  });

  it('says that the list could not be loaded, and why in a notice, when the read fails', async () => {
    await open({ GetInventoryList: errorReply('STORE_UNAVAILABLE', 'connect ECONNREFUSED') });
    expect(textsOf('inventoryList')).toContain('Could not load the inventory list.');
    expect(textsOf('notices')[0]).toBe('The data store is not available. Try again in a moment. (STORE_UNAVAILABLE: connect ECONNREFUSED)');
  });
});

describe('InventoryCoordinator: openDetail', () => {
  it('loads the detail of the Food Type that is clicked, paints it and shows it instead of the list', async () => {
    const { api } = await open();
    api.forget();
    await openBeef();
    expect(api.requests).toEqual([{ type: 'GetFoodTypeDetail', params: { foodTypeId: 20 } }]);
    expect([isShown('foodTypeDetail'), isShown('inventoryList')]).toEqual([true, false]);
    expect(textsOf('foodTypeDetail')).toEqual(
      expect.arrayContaining(['Beef', 'Meat → Red Meat', 'Unit: grams', 'Total: 550 grams', 'Batches', '150 grams of Beef — expires in 1 day']),
    );
  });

  it('paints the failure, FOOD_TYPE_NOT_FOUND, in the detail and as a notice', async () => {
    await open({ GetFoodTypeDetail: errorReply('FOOD_TYPE_NOT_FOUND', 'no Food Type 20') });
    await openBeef();
    expect(textsOf('foodTypeDetail')).toEqual(['Back to inventory', 'Could not load this Food Type.']);
    expect(textsOf('notices')[0]).toBe('That Food Type no longer exists.');
  });
});

describe('InventoryCoordinator: refresh', () => {
  it('reloads the list and the open detail after a change', async () => {
    const { api } = await open();
    await openBeef();
    click('Edit quantity');
    typeInto('Quantity', '80');
    api.forget();
    click('Save', { slot: 'batchForm' });
    await settle();
    expect(api.requests).toEqual([
      { type: 'EditBatchQuantity', payload: { batchId: 31, quantity: 80_000 } },
      { type: 'GetReferenceData', params: {} },
      { type: 'GetInventoryList', params: {} },
      { type: 'GetFoodTypeDetail', params: { foodTypeId: 20 } },
    ]);
  });

  it('reloads only the list when no detail is open', async () => {
    const { api, timer } = await open();
    api.forget();
    timer.fire();
    await settle();
    expect(api.types()).toEqual(['GetReferenceData', 'GetInventoryList']);
  });
});

describe('InventoryCoordinator: loadWarnings', () => {
  it('loads the warning panel when its tab opens and paints the Near-Expiry and Expired batches', async () => {
    const { api } = await open();
    api.forget();
    click('Warnings');
    await settle();
    expect(api.sent('GetWarningPanel')).toEqual([{ type: 'GetWarningPanel', params: {} }]);
    expect(textsOf('warnings')).toEqual(
      expect.arrayContaining(['150 grams of Beef — expires in 1 day', '1.5 grams of Chicken — expires today', '100 grams of Beef — expired 3 days ago']),
    );
  });
});

describe('InventoryCoordinator: addBatch', () => {
  it('adds a batch under a new Food Type with its category and unit, sends InboundBatch, closes the form and reloads', async () => {
    const { api } = await open();
    click('Add batch', { slot: 'inventoryList' });
    typeInto('New Food Type name', 'Milk');
    choose('Category', '7');
    choose('Unit', 'ml');
    typeInto('Quantity', '500');
    typeInto('Shelf life in days', '5');
    api.forget();
    click('Save', { slot: 'batchForm' });
    await settle();
    expect(api.requests).toEqual([
      { type: 'InboundBatch', payload: { foodTypeId: null, foodName: 'Milk', categoryId: 7, unit: 'ml', quantity: 500_000, expiry: { days: 5 } } },
      { type: 'GetReferenceData', params: {} },
      { type: 'GetInventoryList', params: {} },
    ]);
    expect(textsOf('batchForm')).toEqual([]);
  });

  it('shows the unit and category of a picked Food Type read-only, keeps what was typed, and sends its id and no name', async () => {
    const { api } = await open();
    click('Add batch', { slot: 'inventoryList' });
    typeInto('Quantity', '1.5');
    choose('Food Type', '22');
    expect(textsOf('batchForm')).toEqual(expect.arrayContaining(['Unit: grams', 'Category: Meat → Poultry']));
    expect(textsOf('batchForm')).not.toContain('New Food Type name');
    expect(inputOf('Quantity').value).toBe('1.5');
    choose('Expiry given as', 'date');
    typeInto('Expiration date', '2026-10-09');
    api.forget();
    click('Save', { slot: 'batchForm' });
    await settle();
    expect(api.sent('InboundBatch')).toEqual([
      { type: 'InboundBatch', payload: { foodTypeId: 22, foodName: null, categoryId: 5, unit: 'grams', quantity: 1500, expiry: { date: '2026-10-09' } } },
    ]);
  });

  it('opens with the Food Type of the detail already picked when it is opened from the detail', async () => {
    await open();
    await openBeef();
    click('Add batch', { slot: 'foodTypeDetail' });
    expect(selectOf('Food Type').value).toBe('20');
    expect(textsOf('batchForm')).toEqual(expect.arrayContaining(['Unit: grams', 'Category: Meat → Red Meat']));
  });

  it('sends nothing for a quantity it cannot read, and shows why beside the field (QTY_FORMAT)', async () => {
    const { api } = await open();
    click('Add batch', { slot: 'inventoryList' });
    choose('Food Type', '22');
    typeInto('Quantity', '1,000');
    typeInto('Shelf life in days', '3');
    api.forget();
    click('Save', { slot: 'batchForm' });
    await settle();
    expect(api.requests).toEqual([]);
    expect(hintOf('Quantity')).toBe('Use digits and one decimal point, like 1.5.');
    expect(textsOf('notices')).toEqual([]);
  });

  it('shows a refusal of the backend (CAP_EXCEEDED) as a notice and beside the quantity, keeps the form open, and reloads nothing', async () => {
    const { api } = await open({ InboundBatch: errorReply('CAP_EXCEEDED', 'the total would be 500,001 grams') });
    click('Add batch', { slot: 'inventoryList' });
    choose('Food Type', '20');
    typeInto('Quantity', '499451');
    typeInto('Shelf life in days', '3');
    api.forget();
    click('Save', { slot: 'batchForm' });
    await settle();
    expect(api.types()).toEqual(['InboundBatch']);
    const text = 'That would take this Food Type above 500,000 in total, so nothing was changed.';
    expect(textsOf('notices')[0]).toBe(text);
    expect(hintOf('Quantity')).toBe(text);
    expect(buttonOf('Save', { slot: 'batchForm' }).disabled).toBe(false);
  });

  it('sends a form with neither a Food Type nor a name as it is, and shows the answer, NAME_EMPTY, beside the name', async () => {
    const { api } = await open({ InboundBatch: errorReply('NAME_EMPTY', 'name: empty') });
    click('Add batch', { slot: 'inventoryList' });
    typeInto('Quantity', '1');
    typeInto('Shelf life in days', '2');
    api.forget();
    click('Save', { slot: 'batchForm' });
    await settle();
    expect(api.sent('InboundBatch')[0]?.payload).toMatchObject({ foodTypeId: null, foodName: null });
    expect(textsOf('notices')[0]).toBe('The name is empty. Enter 1 to 200 characters.');
    expect(hintOf('New Food Type name')).toBe('The name is empty. Enter 1 to 200 characters.');
  });

  it('disables the fields and the buttons of the form while its request is on its way, and closes it when the answer comes', async () => {
    const held = heldReply(okReply('InboundBatch', {}));
    const { api } = await open({ InboundBatch: held.reply });
    click('Add batch', { slot: 'inventoryList' });
    choose('Food Type', '22');
    typeInto('Quantity', '2');
    typeInto('Shelf life in days', '4');
    click('Save', { slot: 'batchForm' });
    await settle();
    expect([buttonOf('Saving…', { slot: 'batchForm' }).disabled, buttonOf('Cancel', { slot: 'batchForm' }).disabled, inputOf('Quantity').disabled]).toEqual([true, true, true]);
    click('Saving…', { slot: 'batchForm' });
    held.release();
    await settle();
    expect(api.sent('InboundBatch')).toHaveLength(1);
    expect(textsOf('batchForm')).toEqual([]);
  });

  it('sends one InboundBatch when the form is submitted twice before the answer comes', async () => {
    const { api, app } = await open();
    click('Add batch', { slot: 'inventoryList' });
    choose('Food Type', '22');
    typeInto('Quantity', '2');
    typeInto('Shelf life in days', '4');
    const submit: UiEvent = { ns: 'batch', name: 'submit', payload: {} };
    await Promise.all([app.dispatch(submit), app.dispatch(submit)]);
    expect(api.sent('InboundBatch')).toHaveLength(1);
  });

  it('closes on Cancel and sends nothing', async () => {
    const { api } = await open();
    click('Add batch', { slot: 'inventoryList' });
    typeInto('Quantity', '3');
    api.forget();
    click('Cancel', { slot: 'batchForm' });
    await settle();
    expect(api.requests).toEqual([]);
    expect(textsOf('batchForm')).toEqual([]);
  });
});

describe('InventoryCoordinator: editBatchQuantity', () => {
  it('opens with the quantity of the batch, sends EditBatchQuantity and reloads', async () => {
    const { api } = await open();
    await openBeef();
    click('Edit quantity', { nth: 1 });
    expect(textsOf('batchForm')).toEqual(expect.arrayContaining(['Edit quantity', 'Beef · grams']));
    expect(inputOf('Quantity').value).toBe('150');
    typeInto('Quantity', '120.5');
    api.forget();
    click('Save', { slot: 'batchForm' });
    await settle();
    expect(api.requests[0]).toEqual({ type: 'EditBatchQuantity', payload: { batchId: 32, quantity: 120_500 } });
    expect(textsOf('batchForm')).toEqual([]);
  });

  it('shows the refusal of a quantity of 0 (QTY_NOT_POSITIVE) beside the field', async () => {
    await open({ EditBatchQuantity: errorReply('QTY_NOT_POSITIVE', 'quantity: 0') });
    await openBeef();
    click('Edit quantity');
    typeInto('Quantity', '0');
    click('Save', { slot: 'batchForm' });
    await settle();
    expect(hintOf('Quantity')).toBe('The quantity must be at least 0.001.');
  });
});

describe('InventoryCoordinator: removeBatch', () => {
  it('asks first, naming the batch, then sends RemoveBatch, closes the dialog and reloads', async () => {
    const { api } = await open();
    await openBeef();
    click('Remove batch', { slot: 'foodTypeDetail', nth: 1 });
    expect(textsOf('confirm')).toEqual(['Remove this batch?', '150 grams of Beef — expires in 1 day', 'Remove batch', 'Cancel']);
    api.forget();
    click('Remove batch', { slot: 'confirm' });
    await settle();
    expect(api.requests).toEqual([
      { type: 'RemoveBatch', payload: { batchId: 32 } },
      { type: 'GetReferenceData', params: {} },
      { type: 'GetInventoryList', params: {} },
      { type: 'GetFoodTypeDetail', params: { foodTypeId: 20 } },
    ]);
    expect(textsOf('confirm')).toEqual([]);
  });

  it('keeps the dialog open with its buttons usable when the removal fails', async () => {
    await open({ RemoveBatch: lostReply('TIMEOUT') });
    await openBeef();
    click('Remove batch', { slot: 'foodTypeDetail' });
    click('Remove batch', { slot: 'confirm' });
    await settle();
    expect(textsOf('confirm')[0]).toBe('Remove this batch?');
    expect(buttonOf('Remove batch', { slot: 'confirm' }).disabled).toBe(false);
  });

  it('sends nothing on Cancel', async () => {
    const { api } = await open();
    await openBeef();
    click('Remove batch', { slot: 'foodTypeDetail' });
    api.forget();
    click('Cancel', { slot: 'confirm' });
    await settle();
    expect(api.requests).toEqual([]);
    expect(textsOf('confirm')).toEqual([]);
  });
});
