import { afterEach, describe, expect, it } from 'vitest';
import { TONE_CLASS } from '@freshrescue/contract-ui';
import type { SlotId } from '@freshrescue/contract-ui';
import { errorReply, lostReply, okReply } from '../testing/fakeApi';
import { REFERENCE, REFERENCE_SIMULATED } from '../testing/fixtures';
import { buttonOf, click, hintOf, inputOf, isShown, openPage, settle, textsOf, typeInto } from '../testing/page';
import type { Page } from '../testing/page';

// The five workflows of ShellCoordinator, each started from one event on the painted page.

let page: Page | null = null;
afterEach(() => {
  page?.close();
  page = null;
});

async function open(...args: Parameters<typeof openPage>): Promise<Page> {
  page = await openPage(...args);
  return page;
}

const CONTENT: readonly SlotId[] = ['inventoryList', 'foodTypeDetail', 'warnings', 'recommendations', 'catalog', 'categories', 'cookQueue', 'cookReport'];
const shownContent = (): SlotId[] => CONTENT.filter(isShown);

describe('ShellCoordinator: navigate', () => {
  it('opens the tab that is clicked, marks it, shows its slots and hides the others, and loads it', async () => {
    const { api } = await open();
    api.forget();
    click('Recipes');
    await settle();
    expect(api.types()).toEqual(['GetReferenceData', 'GetCatalog']);
    expect(shownContent()).toEqual(['catalog', 'cookQueue', 'cookReport']);
    expect(buttonOf('Recipes').className).toContain(TONE_CLASS.current);
    expect(buttonOf('Inventory').className).not.toContain(TONE_CLASS.current);
    expect(buttonOf('Inventory').className).toContain(TONE_CLASS.tab);
  });

  it('loads each tab with its own query when it opens', async () => {
    const { api } = await open();
    const queries: Record<string, string> = {};
    for (const tab of ['Warnings', 'Recommendations', 'Recipes', 'Categories', 'Inventory']) {
      api.forget();
      click(tab);
      await settle();
      queries[tab] = api.types().join(' ');
    }
    expect(queries).toEqual({
      Warnings: 'GetReferenceData GetWarningPanel',
      Recommendations: 'GetReferenceData GetRecommendations',
      Recipes: 'GetReferenceData GetCatalog',
      Categories: 'GetReferenceData',
      Inventory: 'GetReferenceData GetInventoryList',
    });
  });

  it('sends nothing for the tab that is already open', async () => {
    const { api } = await open();
    api.forget();
    click('Inventory');
    await settle();
    expect(api.requests).toEqual([]);
  });

  it('records the detail that opens inside the Inventory tab and shows it, and the back button shows the list again, sending nothing for either move', async () => {
    const { api } = await open();
    api.forget();
    click('Beef');
    await settle();
    expect(api.types()).toEqual(['GetFoodTypeDetail']);
    expect(shownContent()).toEqual(['foodTypeDetail']);
    api.forget();
    click('Back to inventory');
    await settle();
    expect(api.requests).toEqual([]);
    expect(shownContent()).toEqual(['inventoryList']);
  });
});

describe('ShellCoordinator: pushNotice and dismissNotice', () => {
  it('pushes a notice for a read that failed, in the tone of its severity', async () => {
    await open({ GetWarningPanel: lostReply('TIMEOUT') });
    click('Warnings');
    await settle();
    expect(textsOf('notices')).toEqual(['The server took too long to answer. Try again. (TIMEOUT: the stand-in API did not answer)', 'Dismiss']);
    expect(document.querySelector('[data-slot="notices"] span')?.className).toBe(TONE_CLASS.bad);
  });

  it('keeps the notices in the order they came, and dismisses only the one whose Dismiss is clicked', async () => {
    const { api } = await open({ GetWarningPanel: lostReply('NETWORK_ERROR'), GetRecommendations: errorReply('STORE_UNAVAILABLE', 'no connection') });
    click('Warnings');
    await settle();
    click('Recommendations');
    await settle();
    expect(textsOf('notices').filter((text) => text !== 'Dismiss')).toHaveLength(2);
    api.forget();
    click('Dismiss', { slot: 'notices' });
    await settle();
    expect(api.requests).toEqual([]);
    expect(textsOf('notices')).toHaveLength(2);
    expect(textsOf('notices')[0]).toMatch(/STORE_UNAVAILABLE/);
    click('Dismiss', { slot: 'notices' });
    await settle();
    expect(textsOf('notices')).toEqual([]);
  });
});

describe('ShellCoordinator: loadReferenceData', () => {
  it('loads the reference data first on every refresh, and paints its date in the frame and in the demo control', async () => {
    const { api } = await open();
    expect(api.types()[0]).toBe('GetReferenceData');
    expect(textsOf('shell')).toContain('2026-10-02');
    expect(textsOf('demo')).toContain('Today: 2026-10-02');
  });

  it('keeps the last good reference data when a reload fails, so the forms still have their lists, and says so in a notice', async () => {
    await open({ GetReferenceData: (_message, earlier) => (earlier === 0 ? okReply('GetReferenceData', REFERENCE) : lostReply('NETWORK_ERROR')) });
    click('Warnings');
    await settle();
    expect(textsOf('notices')[0]).toMatch(/NETWORK_ERROR/);
    expect(textsOf('demo')).toContain('Today: 2026-10-02');
    click('Inventory');
    await settle();
    click('Add batch', { slot: 'inventoryList' });
    expect(textsOf('batchForm')).toContain('Food Type');
    expect([...document.querySelectorAll('[data-slot="batchForm"] option')].map((option) => option.textContent)).toContain('Chicken');
  });
});

describe('ShellCoordinator: submitSimulatedToday', () => {
  it('sends SetSimulatedToday with the date, closes the control and reloads the screen with the new today', async () => {
    const { api } = await open({ GetReferenceData: (_message, earlier) => okReply('GetReferenceData', earlier === 0 ? REFERENCE : REFERENCE_SIMULATED) });
    click('Set Simulated Today');
    expect(inputOf('Simulated Today').value).toBe('');
    typeInto('Simulated Today', '2026-10-05');
    api.forget();
    click('Save', { slot: 'demo' });
    await settle();
    expect(api.requests).toEqual([
      { type: 'SetSimulatedToday', payload: { date: '2026-10-05' } },
      { type: 'GetReferenceData', params: {} },
      { type: 'GetInventoryList', params: {} },
    ]);
    expect(textsOf('demo')).toEqual(['Today: 2026-10-05', 'Simulated', 'Set Simulated Today']);
    expect(textsOf('shell')).toContain('2026-10-05');
  });

  it('opens at the current Simulated Today, and an empty date clears it', async () => {
    const { api } = await open({ GetReferenceData: okReply('GetReferenceData', REFERENCE_SIMULATED) });
    click('Set Simulated Today');
    expect(inputOf('Simulated Today').value).toBe('2026-10-05');
    typeInto('Simulated Today', '');
    api.forget();
    click('Save', { slot: 'demo' });
    await settle();
    expect(api.sent('SetSimulatedToday')).toEqual([{ type: 'SetSimulatedToday', payload: { date: null } }]);
  });

  // A date field holds only real dates, as in a browser, so these two send the edit that a browser which
  // shows the field as plain text relays: the text as it was typed.
  it('sends nothing for a date that is not written as YYYY-MM-DD, and shows why beside the field (DATE_FORMAT)', async () => {
    const { api, app } = await open();
    click('Set Simulated Today');
    await app.dispatch({ ns: 'settings', name: 'edit', payload: { field: 'date', value: 'next friday' } });
    api.forget();
    click('Save', { slot: 'demo' });
    await settle();
    expect(api.requests).toEqual([]);
    expect(hintOf('Simulated Today')).toBe('Use a date like 2026-10-01.');
    expect(textsOf('notices')).toEqual([]);
  });

  it('shows the answer of the backend for a day that does not exist (DATE_INVALID) as a notice and beside the field, and keeps the form open', async () => {
    const { api, app } = await open({ SetSimulatedToday: errorReply('DATE_INVALID', 'date: 2026-02-30 is not a calendar date') });
    click('Set Simulated Today');
    await app.dispatch({ ns: 'settings', name: 'edit', payload: { field: 'date', value: '2026-02-30' } });
    api.forget();
    click('Save', { slot: 'demo' });
    await settle();
    expect(api.requests).toEqual([{ type: 'SetSimulatedToday', payload: { date: '2026-02-30' } }]);
    expect(textsOf('notices')[0]).toBe('That date does not exist. Enter a real calendar date, like 2026-10-01.');
    expect(hintOf('Simulated Today')).toBe('That date does not exist. Enter a real calendar date, like 2026-10-01.');
    expect(buttonOf('Save', { slot: 'demo' }).disabled).toBe(false);
  });

  it('reads a date field that holds no real date as empty, as a browser does, which clears Simulated Today', async () => {
    const { api } = await open();
    click('Set Simulated Today');
    typeInto('Simulated Today', '2026-02-30');
    expect(inputOf('Simulated Today').value).toBe('');
    api.forget();
    click('Save', { slot: 'demo' });
    await settle();
    expect(api.sent('SetSimulatedToday')).toEqual([{ type: 'SetSimulatedToday', payload: { date: null } }]);
  });

  it('sends one SetSimulatedToday when the control is submitted twice before the answer comes', async () => {
    const { api, app } = await open();
    click('Set Simulated Today');
    typeInto('Simulated Today', '2026-10-05');
    const submit = { ns: 'settings', name: 'submit', payload: {} } as const;
    await Promise.all([app.dispatch(submit), app.dispatch(submit)]);
    expect(api.sent('SetSimulatedToday')).toHaveLength(1);
  });

  it('closes the control on Cancel and sends nothing', async () => {
    const { api } = await open();
    click('Set Simulated Today');
    typeInto('Simulated Today', '2026-10-09');
    api.forget();
    click('Cancel', { slot: 'demo' });
    await settle();
    expect(api.requests).toEqual([]);
    expect(textsOf('demo')).toEqual(['Today: 2026-10-02', 'Set Simulated Today']);
  });
});
