import { afterEach, describe, expect, it, vi } from 'vitest';
import { UI_NAMESPACES, UI_ROUTES } from '@freshrescue/contract-ui';
import type { Ctx, Intent, UiEvent, UiNamespace } from '@freshrescue/contract-ui';
import { createDomHostGateway } from '../gateways/domHostGateway';
import { createMidnightTimerGateway } from '../gateways/midnightTimerGateway';
import { createFakeApi, errorReply, lostReply, okReply } from '../testing/fakeApi';
import { DETAIL, FRENCH, INVENTORY, MEAT, REFERENCE, REFERENCE_SIMULATED, STIR_FRY } from '../testing/fixtures';
import { addSlots, click, isShown, openPage, settle, slotElement, textsOf, typeInto, WORLD } from '../testing/page';
import type { Page } from '../testing/page';
import { createAppCoordinator } from './AppCoordinator';

// Each sub-coordinator is the real one, with its `handle` watched, so the test sees which one receives an event.
const { received, watch } = vi.hoisted(() => {
  const received: { coordinator: string; ns: string; name: string }[] = [];
  const watch = <S extends { handle: (event: UiEvent, ctx: Ctx) => Promise<readonly Intent[]> }>(coordinator: string, sub: S): S => ({
    ...sub,
    handle: (event: UiEvent, ctx: Ctx) => {
      received.push({ coordinator, ns: event.ns, name: event.name });
      return sub.handle(event, ctx);
    },
  });
  return { received, watch };
});

vi.mock('./ShellCoordinator', async (importOriginal) => {
  const real = await importOriginal<typeof import('./ShellCoordinator')>();
  return { createShellCoordinator: () => watch('Shell', real.createShellCoordinator()) };
});
vi.mock('./InventoryCoordinator', async (importOriginal) => {
  const real = await importOriginal<typeof import('./InventoryCoordinator')>();
  return { createInventoryCoordinator: () => watch('Inventory', real.createInventoryCoordinator()) };
});
vi.mock('./TaxonomyCoordinator', async (importOriginal) => {
  const real = await importOriginal<typeof import('./TaxonomyCoordinator')>();
  return { createTaxonomyCoordinator: () => watch('Taxonomy', real.createTaxonomyCoordinator()) };
});
vi.mock('./RecipeBookCoordinator', async (importOriginal) => {
  const real = await importOriginal<typeof import('./RecipeBookCoordinator')>();
  return { createRecipeBookCoordinator: () => watch('RecipeBook', real.createRecipeBookCoordinator()) };
});
vi.mock('./CookingCoordinator', async (importOriginal) => {
  const real = await importOriginal<typeof import('./CookingCoordinator')>();
  return { createCookingCoordinator: () => watch('Cooking', real.createCookingCoordinator()) };
});

let page: Page | null = null;
const closers: (() => void)[] = [];

afterEach(() => {
  page?.close();
  page = null;
  closers.splice(0).forEach((close) => close());
  received.length = 0;
  vi.useRealTimers();
});

async function open(...args: Parameters<typeof openPage>): Promise<Page> {
  page = await openPage(...args);
  return page;
}

/** One event of every namespace. The type makes a namespace without an event a compile error. */
const ONE_EVENT_OF: { readonly [N in UiNamespace]: Extract<UiEvent, { readonly ns: N }> } = {
  shell: { ns: 'shell', name: 'navigate', payload: { tab: 'warnings', detail: null } },
  settings: { ns: 'settings', name: 'open', payload: {} },
  inventory: { ns: 'inventory', name: 'openDetail', payload: { foodTypeId: 20 } },
  batch: { ns: 'batch', name: 'edit', payload: { field: 'quantity', value: '1' } },
  batchRemove: { ns: 'batchRemove', name: 'cancel', payload: {} },
  foodType: { ns: 'foodType', name: 'newFoodType', payload: {} },
  unitConversion: { ns: 'unitConversion', name: 'changeUnit', payload: { foodType: DETAIL } },
  foodTypeDelete: { ns: 'foodTypeDelete', name: 'deleteFoodType', payload: { foodType: DETAIL } },
  category: { ns: 'category', name: 'newCategory', payload: { scope: 'foodCategory', parent: null } },
  threshold: { ns: 'threshold', name: 'setThreshold', payload: { category: MEAT } },
  categoryDelete: { ns: 'categoryDelete', name: 'deleteCategory', payload: { scope: 'cuisine', category: FRENCH } },
  recommendations: { ns: 'recommendations', name: 'openInCook', payload: { recipeId: 41 } },
  catalog: { ns: 'catalog', name: 'setCuisineFilter', payload: { cuisineId: 10 } },
  recipe: { ns: 'recipe', name: 'newRecipe', payload: {} },
  recipeDelete: { ns: 'recipeDelete', name: 'deleteRecipe', payload: { recipe: STIR_FRY } },
  cook: { ns: 'cook', name: 'add', payload: { recipeId: 41, recipeName: 'Chicken Fried Rice' } },
};

describe('AppCoordinator: startup', () => {
  it('sends GetReferenceData and then the query of the first screen, and paints the answers', async () => {
    const { api, timer } = await open();
    expect(api.types()).toEqual(['GetReferenceData', 'GetInventoryList']);

    expect(textsOf('shell')).toEqual(['FreshRescue', '2026-10-02', 'Inventory', 'Warnings', 'Recommendations', 'Recipes', 'Categories']);
    expect(textsOf('demo')).toEqual(['Today: 2026-10-02', 'Set Simulated Today']);
    expect(textsOf('inventoryList')).toEqual(expect.arrayContaining(['Beef', 'Meat → Red Meat', 'Egg', '—']));
    expect(textsOf('notices')).toEqual([]);

    // the Inventory tab shows its list, and every other tab is hidden
    expect(isShown('inventoryList')).toBe(true);
    expect(['foodTypeDetail', 'warnings', 'recommendations', 'catalog', 'categories', 'cookQueue', 'cookReport'].filter((slot) => isShown(slot as never))).toEqual([]);
    expect(timer.subscribers()).toBe(1);
  });

  it('starts once: a second start while it runs adds no listener and no timer', async () => {
    const { api, app, timer } = await open();
    await app.start();
    expect(timer.subscribers()).toBe(1);
    api.forget();
    click('Warnings');
    await settle();
    expect(api.types()).toEqual(['GetReferenceData', 'GetWarningPanel']);
  });
});

describe('AppCoordinator: dispatch', () => {
  it('hands one event of each of the 16 namespaces to exactly one sub-coordinator, the one that UI_ROUTES names', async () => {
    await open();
    expect(Object.keys(ONE_EVENT_OF)).toEqual([...UI_NAMESPACES]);
    for (const ns of UI_NAMESPACES) {
      received.length = 0;
      await page?.app.dispatch(ONE_EVENT_OF[ns]);
      expect(received, ns).toEqual([{ coordinator: UI_ROUTES[ns], ns, name: ONE_EVENT_OF[ns].name }]);
    }
  });

  it('hands the events of the page to the same sub-coordinators: a click goes through the DOM host to dispatch', async () => {
    await open();
    click('Add batch', { slot: 'inventoryList' });
    await settle();
    expect(received).toEqual([{ coordinator: 'Inventory', ns: 'inventory', name: 'addBatch' }]);
  });

  it('drops an event of a namespace that no coordinator owns and shows a notice, BAD_ENVELOPE', async () => {
    const { api } = await open();
    api.forget();
    await page?.app.dispatch({ ns: 'pantry', name: 'open', payload: {} } as unknown as UiEvent);
    expect(received).toEqual([]);
    expect(api.requests).toEqual([]);
    expect(textsOf('notices')).toEqual(['The server did not understand the request. (BAD_ENVELOPE: no coordinator owns the events of "pantry")', 'Dismiss']);
  });
});

describe('AppCoordinator: onTick', () => {
  it('reloads the visible screen at midnight without any user action, and paints the statuses of the new day', async () => {
    const tomorrow = { ...INVENTORY, rows: INVENTORY.rows.map((row) => (row.name === 'Chicken' ? { ...row, byStatus: { fresh: 0, nearExpiry: 0, expired: 1500 }, overall: 'expired' as const } : row)) };
    const { api, timer } = await open({
      GetReferenceData: (_message, earlier) => okReply('GetReferenceData', earlier === 0 ? REFERENCE : { ...REFERENCE, today: '2026-10-03' }),
      GetInventoryList: (_message, earlier) => okReply('GetInventoryList', earlier === 0 ? INVENTORY : tomorrow),
    });
    expect(textsOf('inventoryList')).toContain('Near-Expiry 1.5');
    api.forget();

    timer.fire();
    await settle();
    expect(api.types()).toEqual(['GetReferenceData', 'GetInventoryList']);
    expect(textsOf('inventoryList')).toContain('Expired 1.5');
    expect(textsOf('inventoryList')).not.toContain('Near-Expiry 1.5');
    expect(textsOf('shell')).toContain('2026-10-03');
  });

  it('reloads the tab that is open at midnight', async () => {
    const { api, timer } = await open();
    click('Recommendations');
    await settle();
    api.forget();
    timer.fire();
    await settle();
    expect(api.types()).toEqual(['GetReferenceData', 'GetRecommendations']);
  });
});

describe('AppCoordinator: intents', () => {
  it('reloads what is on screen after a command works, and paints the figures the backend sent, never one of its own', async () => {
    const after = { rows: [{ ...INVENTORY.rows[3]!, total: 6000, byStatus: { fresh: 6000, nearExpiry: 0, expired: 0 }, overall: 'fresh' as const }] };
    const { api } = await open({ GetInventoryList: (_message, earlier) => okReply('GetInventoryList', earlier === 0 ? INVENTORY : after) });
    click('Add batch', { slot: 'inventoryList' });
    typeInto('New Food Type name', 'Egg');
    typeInto('Quantity', '6');
    typeInto('Shelf life in days', '10');
    api.forget();
    click('Save');
    await settle();
    expect(api.types()).toEqual(['InboundBatch', 'GetReferenceData', 'GetInventoryList']);
    expect(textsOf('inventoryList')).toEqual(['Inventory', 'Add Food Type', 'Add batch', 'Egg', 'Other', '6 pieces', 'Fresh 6', 'Fresh']);
  });

  it('shows a command that fails as a notice in the notice bar, and leaves the data on screen as it was', async () => {
    const { api } = await open({ InboundBatch: errorReply('CAP_EXCEEDED', 'the total would be 500001 grams') });
    const before = textsOf('inventoryList');
    click('Add batch', { slot: 'inventoryList' });
    typeInto('New Food Type name', 'Beef');
    typeInto('Quantity', '500001');
    typeInto('Shelf life in days', '3');
    api.forget();
    click('Save');
    await settle();
    expect(api.types()).toEqual(['InboundBatch']);
    expect(textsOf('notices')[0]).toMatch(/500,000/);
    expect(textsOf('inventoryList')).toEqual(before);
  });

  it('treats a request that gets no answer, NETWORK_ERROR, the same way', async () => {
    const { api } = await open({ RemoveBatch: lostReply('NETWORK_ERROR') });
    click('Beef');
    await settle();
    click('Remove batch');
    api.forget();
    click('Remove batch', { slot: 'confirm' });
    await settle();
    expect(api.types()).toEqual(['RemoveBatch']);
    expect(textsOf('notices')[0]).toMatch(/NETWORK_ERROR/);
    expect(textsOf('confirm')).toContain('Remove this batch?');
  });

  it('reloads with the new date after Simulated Today is set, so the statuses painted afterwards are what the backend works out for that day', async () => {
    const later = { ...INVENTORY, rows: INVENTORY.rows.map((row) => (row.name === 'Broccoli' ? { ...row, byStatus: { fresh: 0, nearExpiry: 250_000, expired: 0 }, overall: 'nearExpiry' as const } : row)) };
    const { api } = await open({
      GetReferenceData: (_message, earlier) => okReply('GetReferenceData', earlier === 0 ? REFERENCE : REFERENCE_SIMULATED),
      GetInventoryList: (_message, earlier) => okReply('GetInventoryList', earlier === 0 ? INVENTORY : later),
    });
    expect(textsOf('inventoryList')).toContain('Fresh 250');
    click('Set Simulated Today');
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
    expect(textsOf('inventoryList')).toContain('Near-Expiry 250');
    expect(textsOf('inventoryList')).not.toContain('Fresh 250');
  });
});

describe('AppCoordinator: the page', () => {
  it('shows a notice, SLOT_NOT_FOUND, when a slot of a view is missing, and goes on working', async () => {
    const { api } = await open();
    slotElement('warnings').remove();
    click('Warnings');
    await settle();
    expect(api.types()).toContain('GetWarningPanel');
    expect(textsOf('notices').some((text) => text.includes('SLOT_NOT_FOUND') && text.includes('"warnings"'))).toBe(true);
    click('Inventory');
    await settle();
    expect(isShown('inventoryList')).toBe(true);
  });

  it('does not loop when the notice bar itself is missing: there is nowhere to show that notice', async () => {
    const { api } = await open();
    slotElement('notices').remove();
    slotElement('warnings').remove();
    api.forget();
    click('Warnings');
    await settle();
    await settle();
    expect(api.types()).toEqual(['GetReferenceData', 'GetWarningPanel']);
  });

  it('leaves one timer and one set of page listeners after start, stop, start, which is what React does in development', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 2, 9, 0));
    closers.push(addSlots());
    const api = createFakeApi(WORLD);
    const app = createAppCoordinator({ api, dom: createDomHostGateway(), timer: createMidnightTimerGateway() });
    closers.push(() => app.stop());

    const first = app.start();
    app.stop();
    await app.start();
    await first;
    expect(vi.getTimerCount()).toBe(1);

    api.forget();
    click('Recommendations');
    await vi.advanceTimersByTimeAsync(0);
    expect(api.types()).toEqual(['GetReferenceData', 'GetRecommendations']);

    app.stop();
    expect(vi.getTimerCount()).toBe(0);
    api.forget();
    click('Warnings');
    await vi.advanceTimersByTimeAsync(0);
    expect(api.requests).toEqual([]);
  });

  it('subscribes no timer when it is stopped before its first screen has loaded', async () => {
    closers.push(addSlots());
    const subscribed: string[] = [];
    const api = createFakeApi(WORLD);
    const app = createAppCoordinator({ api, dom: createDomHostGateway(), timer: { subscribe: () => (subscribed.push('timer'), () => {}) } });
    const starting = app.start();
    app.stop();
    await starting;
    expect(subscribed).toEqual([]);
  });
});
