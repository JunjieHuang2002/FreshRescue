import { afterEach, describe, expect, it } from 'vitest';
import { TONE_CLASS } from '@freshrescue/contract-ui';
import { errorReply, okReply } from '../testing/fakeApi';
import { CATALOG, RECOMMENDATIONS_NO_NEAR_EXPIRY, RECOMMENDATIONS_NO_RESCUE, RECOMMENDATIONS_PARTIAL } from '../testing/fixtures';
import { buttonOf, choose, click, hintOf, inputOf, isShown, openPage, selectOf, settle, textsOf, typeInto } from '../testing/page';
import type { Page } from '../testing/page';

// The seven workflows of RecipeBookCoordinator, each started from one event on the painted page.

let page: Page | null = null;
afterEach(() => {
  page?.close();
  page = null;
});

async function open(...args: Parameters<typeof openPage>): Promise<Page> {
  page = await openPage(...args);
  return page;
}

async function openTab(label: string): Promise<void> {
  click(label);
  await settle();
}

/** The name of the recipe whose card is marked as opened from the recommendations, or null. */
function markedRecipe(): string | null {
  const texts = textsOf('catalog');
  const mark = texts.indexOf('Opened from Recommendations');
  return mark < 0 ? null : (texts[mark - 3] ?? null);
}

describe('RecipeBookCoordinator: loadRecommendations', () => {
  it('loads Feature 3 when its tab opens and paints the full matches with their rescued ingredients', async () => {
    const { api } = await open();
    api.forget();
    await openTab('Recommendations');
    expect(api.types()).toEqual(['GetReferenceData', 'GetRecommendations']);
    expect(textsOf('recommendations')).toEqual(
      expect.arrayContaining(['Full matches', 'Chicken Fried Rice', '3 of 3 ingredients available', 'Rescues near-expiry stock', 'Open in Cook']),
    );
  });

  it('paints the partial matches when there is no full match, and each empty state of spec 4.6', async () => {
    const answers = [RECOMMENDATIONS_PARTIAL, RECOMMENDATIONS_NO_NEAR_EXPIRY, RECOMMENDATIONS_NO_RESCUE];
    const { timer } = await open({ GetRecommendations: (_message, earlier) => okReply('GetRecommendations', answers[earlier] ?? RECOMMENDATIONS_NO_RESCUE) });
    await openTab('Recommendations');
    expect(textsOf('recommendations')).toEqual(expect.arrayContaining(['Partial Matches', 'Beef and Broccoli Stir-Fry', 'Missing']));
    timer.fire();
    await settle();
    expect(textsOf('recommendations')).toContain('No near-expiry items — no rescue recipes are needed');
    timer.fire();
    await settle();
    expect(textsOf('recommendations')).toContain('No recipe can rescue your near-expiry items yet');
  });
});

describe('RecipeBookCoordinator: openInCook and highlightRecipe', () => {
  it('opens the recipe catalog from a recommendation, where cooking happens, and loads it', async () => {
    const { api } = await open();
    await openTab('Recommendations');
    api.forget();
    click('Open in Cook');
    await settle();
    expect(api.types()).toEqual(['GetReferenceData', 'GetCatalog']);
    expect([isShown('catalog'), isShown('recommendations')]).toEqual([true, false]);
    expect(buttonOf('Recipes').className).toContain(TONE_CLASS.current);
  });

  it('marks the recipe that was opened from the recommendations, and only that one', async () => {
    const { app } = await open();
    await openTab('Recommendations');
    click('Open in Cook');
    await settle();
    expect(markedRecipe()).toBe('Chicken Fried Rice');
    await app.dispatch({ ns: 'recommendations', name: 'openInCook', payload: { recipeId: 40 } });
    expect(markedRecipe()).toBe('Beef and Broccoli Stir-Fry');
    expect(textsOf('catalog').filter((text) => text === 'Opened from Recommendations')).toHaveLength(1);
  });
});

describe('RecipeBookCoordinator: loadCatalog', () => {
  it('loads every recipe A to Z when the Recipes tab opens, and paints each status', async () => {
    const { api } = await open();
    api.forget();
    await openTab('Recipes');
    expect(api.sent('GetCatalog')).toEqual([{ type: 'GetCatalog', params: { cuisineId: null } }]);
    expect(textsOf('catalog')).toEqual(
      expect.arrayContaining([
        'Beef and Broccoli Stir-Fry',
        'Partial match',
        '1 of 2 ingredients available',
        'Nothing available to deduct',
        'Missing food type: Tomato',
        'Blocked',
      ]),
    );
  });

  it('clears the filter and loads every recipe when the cuisine of the filter was deleted meanwhile (CATEGORY_NOT_FOUND), with no notice', async () => {
    let deleted = false;
    const { api, timer } = await open({
      GetCatalog: (message) => (deleted && message.params.cuisineId === 10 ? errorReply('CATEGORY_NOT_FOUND', 'no cuisine 10') : okReply('GetCatalog', CATALOG)),
    });
    await openTab('Recipes');
    click('Chinese Cuisine');
    await settle();
    deleted = true;
    api.forget();
    timer.fire();
    await settle();
    expect(api.requests).toEqual([
      { type: 'GetReferenceData', params: {} },
      { type: 'GetCatalog', params: { cuisineId: 10 } },
      { type: 'GetCatalog', params: { cuisineId: null } },
    ]);
    expect(textsOf('notices')).toEqual([]);
    expect(buttonOf('All', { slot: 'catalog' }).className).toContain(TONE_CLASS.selected);
    expect(textsOf('catalog')).toContain('Chicken Fried Rice');
  });
});

describe('RecipeBookCoordinator: setCuisineFilter', () => {
  it('asks the backend for the recipes of the chosen cuisine, marks the choice, and All asks for every recipe again', async () => {
    const { api } = await open();
    await openTab('Recipes');
    api.forget();
    click('French Cuisine');
    await settle();
    expect(buttonOf('French Cuisine').className).toContain(TONE_CLASS.selected);
    click('All');
    await settle();
    expect(api.requests).toEqual([
      { type: 'GetCatalog', params: { cuisineId: 12 } },
      { type: 'GetCatalog', params: { cuisineId: null } },
    ]);
  });
});

describe('RecipeBookCoordinator: saveRecipe', () => {
  it('creates a recipe with its rows, the unit of a row following its Food Type, and sends SaveRecipe', async () => {
    const { api } = await open();
    await openTab('Recipes');
    click('New recipe');
    typeInto('Recipe name', 'Chicken Soup');
    choose('Cuisine', '10');
    choose('Food Type', '22', { nth: 0 });
    expect(selectOf('Unit', { nth: 0 }).value).toBe('grams');
    typeInto('Quantity', '200', { nth: 0 });
    click('Add ingredient');
    choose('Food Type', '23', { nth: 1 });
    expect(selectOf('Unit', { nth: 1 }).value).toBe('pieces');
    typeInto('Quantity', '2', { nth: 1 });
    click('Add ingredient');
    click('Remove', { slot: 'recipeForm', nth: 2 });
    api.forget();
    click('Save', { slot: 'recipeForm' });
    await settle();
    expect(api.requests).toEqual([
      {
        type: 'SaveRecipe',
        payload: {
          recipeId: null,
          name: 'Chicken Soup',
          draft: {
            cuisineId: 10,
            rows: [
              { foodTypeId: 22, quantity: 200_000, unit: 'grams' },
              { foodTypeId: 23, quantity: 2000, unit: 'pieces' },
            ],
          },
        },
      },
      { type: 'GetReferenceData', params: {} },
      { type: 'GetCatalog', params: { cuisineId: null } },
    ]);
    expect(textsOf('recipeForm')).toEqual([]);
  });

  it('edits a recipe whose Food Type was deleted: that row opens with no Food Type, and picking one sends SaveRecipe with the id of the recipe', async () => {
    const { api } = await open();
    await openTab('Recipes');
    click('Edit', { slot: 'catalog', nth: 3 });
    expect(inputOf('Recipe name').value).toBe('Tomato Egg Stir-Fry');
    expect(selectOf('Food Type', { nth: 0 }).value).toBe('');
    choose('Food Type', '27', { nth: 0 });
    api.forget();
    click('Save', { slot: 'recipeForm' });
    await settle();
    expect(api.sent('SaveRecipe')).toEqual([
      {
        type: 'SaveRecipe',
        payload: {
          recipeId: 43,
          name: 'Tomato Egg Stir-Fry',
          draft: {
            cuisineId: 10,
            rows: [
              { foodTypeId: 27, quantity: 2000, unit: 'pieces' },
              { foodTypeId: 23, quantity: 3000, unit: 'pieces' },
            ],
          },
        },
      },
    ]);
  });

  it('sends nothing while a row has no Food Type (FIELD_REQUIRED), and shows the refusal of a name that is taken (NAME_DUPLICATE) beside the name', async () => {
    const { api } = await open({ SaveRecipe: errorReply('NAME_DUPLICATE', 'name: Chicken Fried Rice') });
    await openTab('Recipes');
    click('New recipe');
    typeInto('Recipe name', 'chicken fried rice');
    typeInto('Quantity', '1');
    choose('Unit', 'grams');
    api.forget();
    click('Save', { slot: 'recipeForm' });
    await settle();
    expect(api.requests).toEqual([]);
    expect(hintOf('Food Type')).toBe('This field is required.');

    choose('Food Type', '25');
    click('Save', { slot: 'recipeForm' });
    await settle();
    expect(api.types()).toEqual(['SaveRecipe']);
    expect(hintOf('Recipe name')).toBe('That name is already used. Choose another name.');
  });
});

describe('RecipeBookCoordinator: a form on its way', () => {
  it('sends one SaveRecipe, and one DeleteRecipe, when a form is submitted twice before the answer comes', async () => {
    const { api, app } = await open();
    await openTab('Recipes');
    click('New recipe');
    typeInto('Recipe name', 'Rice Bowl');
    choose('Food Type', '25');
    typeInto('Quantity', '300');
    const saveRecipe = { ns: 'recipe', name: 'submit', payload: {} } as const;
    await Promise.all([app.dispatch(saveRecipe), app.dispatch(saveRecipe)]);
    click('Delete', { slot: 'catalog', nth: 0 });
    const deleteRecipe = { ns: 'recipeDelete', name: 'submit', payload: {} } as const;
    await Promise.all([app.dispatch(deleteRecipe), app.dispatch(deleteRecipe)]);
    expect([api.sent('SaveRecipe').length, api.sent('DeleteRecipe').length]).toEqual([1, 1]);
  });
});

describe('RecipeBookCoordinator: deleteRecipe', () => {
  it('asks first, sends DeleteRecipe, takes every entry of the recipe out of the cook queue, and reloads', async () => {
    const { api } = await open();
    await openTab('Recipes');
    click('Add to cook queue', { nth: 0 });
    click('Add to cook queue', { nth: 1 });
    click('Add to cook queue', { nth: 0 });
    await settle();
    expect(textsOf('cookQueue')).toContain('3 in the queue');

    click('Delete', { slot: 'catalog', nth: 0 });
    expect(textsOf('confirm')).toEqual(['Delete Beef and Broccoli Stir-Fry?', 'The recipe is also removed from the cook queue.', 'Delete recipe', 'Cancel']);
    api.forget();
    click('Delete recipe', { slot: 'confirm' });
    await settle();
    expect(api.requests).toEqual([
      { type: 'DeleteRecipe', payload: { recipeId: 40 } },
      { type: 'GetReferenceData', params: {} },
      { type: 'GetCatalog', params: { cuisineId: null } },
    ]);
    expect(textsOf('cookQueue')).toEqual(expect.arrayContaining(['1 in the queue', '1. Chicken Fried Rice']));
    expect(textsOf('confirm')).toEqual([]);
  });

  it('leaves the cook queue alone when the deletion fails', async () => {
    await open({ DeleteRecipe: errorReply('RECIPE_NOT_FOUND', 'no recipe 40') });
    await openTab('Recipes');
    click('Add to cook queue', { nth: 0 });
    click('Delete', { slot: 'catalog', nth: 0 });
    click('Delete recipe', { slot: 'confirm' });
    await settle();
    expect(textsOf('notices')[0]).toBe('That recipe no longer exists.');
    expect(textsOf('cookQueue')).toContain('1. Beef and Broccoli Stir-Fry');
  });
});
