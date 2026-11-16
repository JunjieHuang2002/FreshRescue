import { afterEach, describe, expect, it } from 'vitest';
import { errorReply, lostReply } from '../testing/fakeApi';
import { buttonOf, click, isShown, openPage, settle, textsOf } from '../testing/page';
import type { Page } from '../testing/page';

// The three workflows of CookingCoordinator, each started from one event on the painted page.

let page: Page | null = null;
afterEach(() => {
  page?.close();
  page = null;
});

async function open(...args: Parameters<typeof openPage>): Promise<Page> {
  page = await openPage(...args);
  await page.app.dispatch({ ns: 'shell', name: 'navigate', payload: { tab: 'catalog', detail: null } });
  return page;
}

/** The entries of the painted queue, in order. */
const queue = (): string[] => textsOf('cookQueue').filter((text) => /^\d+\. /.test(text));

/** Queues the recipes of the catalog cards with these positions: 0 Beef and Broccoli Stir-Fry, 1 Chicken Fried Rice. */
function queueCards(...cards: number[]): void {
  for (const nth of cards) click('Add to cook queue', { nth });
}

describe('CookingCoordinator: editQueue', () => {
  it('adds, moves and removes entries in the browser only, and sends nothing', async () => {
    const { api } = await open();
    api.forget();
    queueCards(0, 1, 0);
    await settle();
    expect(queue()).toEqual(['1. Beef and Broccoli Stir-Fry', '2. Chicken Fried Rice', '3. Beef and Broccoli Stir-Fry']);
    click('Down', { slot: 'cookQueue', nth: 0 });
    expect(queue()).toEqual(['1. Chicken Fried Rice', '2. Beef and Broccoli Stir-Fry', '3. Beef and Broccoli Stir-Fry']);
    click('Up', { slot: 'cookQueue', nth: 2 });
    click('Remove', { slot: 'cookQueue', nth: 0 });
    expect(queue()).toEqual(['1. Beef and Broccoli Stir-Fry', '2. Beef and Broccoli Stir-Fry']);
    await settle();
    expect(api.requests).toEqual([]);
  });

  it('clears the queue, which then cannot be run', async () => {
    const { api } = await open();
    queueCards(1);
    click('Clear', { slot: 'cookQueue' });
    await settle();
    expect(textsOf('cookQueue')).toContain('The cook queue is empty. Add a recipe from the list.');
    expect(buttonOf('Cook & Deduct').disabled).toBe(true);
    api.forget();
    click('Cook & Deduct');
    await settle();
    expect(api.requests).toEqual([]);
  });
});

describe('CookingCoordinator: runCook', () => {
  it('sends one CookRecipes with the queue in order, paints the report, clears the queue and reloads', async () => {
    const { api } = await open();
    queueCards(0, 1, 1);
    api.forget();
    click('Cook & Deduct');
    await settle();
    expect(api.requests).toEqual([
      { type: 'CookRecipes', payload: { recipeIds: [40, 41, 41] } },
      { type: 'GetReferenceData', params: {} },
      { type: 'GetCatalog', params: { cuisineId: null } },
    ]);
    expect(isShown('cookReport')).toBe(true);
    expect(textsOf('cookReport')).toEqual(
      expect.arrayContaining(['Cook report', 'Beef and Broccoli Stir-Fry', 'Spinach Omelette', 'Nothing available to deduct', 'Dismiss']),
    );
    expect(queue()).toEqual([]);
  });

  it('keeps the queue and shows a notice when the run fails, and reloads anyway, because some recipes may have been cooked', async () => {
    const { api } = await open({ CookRecipes: errorReply('INSUFFICIENT_STOCK', 'recipe 41: Rice') });
    queueCards(0, 1);
    api.forget();
    click('Cook & Deduct');
    await settle();
    expect(api.types()).toEqual(['CookRecipes', 'GetReferenceData', 'GetCatalog']);
    expect(textsOf('notices')[0]).toBe('The server tried to take more than there is, so nothing was changed. (INSUFFICIENT_STOCK: recipe 41: Rice)');
    expect(queue()).toEqual(['1. Beef and Broccoli Stir-Fry', '2. Chicken Fried Rice']);
    expect(textsOf('cookReport')).toEqual([]);
  });

  it('treats a run that gets no answer, NETWORK_ERROR, the same way', async () => {
    await open({ CookRecipes: lostReply('NETWORK_ERROR') });
    queueCards(1);
    click('Cook & Deduct');
    await settle();
    expect(textsOf('notices')[0]).toMatch(/NETWORK_ERROR/);
    expect(queue()).toEqual(['1. Chicken Fried Rice']);
  });

  it('cooks a queue once when Cook & Deduct is pressed twice before the answer comes', async () => {
    const { api } = await open();
    queueCards(1);
    click('Cook & Deduct');
    click('Cook & Deduct');
    await settle();
    expect(api.sent('CookRecipes')).toHaveLength(1);
  });
});

describe('CookingCoordinator: dismissReport', () => {
  it('removes the report, and sends nothing', async () => {
    const { api } = await open();
    queueCards(1);
    click('Cook & Deduct');
    await settle();
    api.forget();
    click('Dismiss', { slot: 'cookReport' });
    await settle();
    expect(textsOf('cookReport')).toEqual([]);
    expect(api.requests).toEqual([]);
  });
});
