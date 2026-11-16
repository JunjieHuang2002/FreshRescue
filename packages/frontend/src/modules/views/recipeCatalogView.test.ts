import { describe, expect, it } from 'vitest';
import type { CatalogViewState } from '@freshrescue/contract-ui';
import type { CatalogDto } from '@freshrescue/contract-views';
import { CATALOG, FRIED_RICE, REFERENCE, STIR_FRY, TOMATO_EGG, failedOf, idleOf, loadingOf, readyOf } from '../../testing/fixtures';
import { eventsOf, findButton, nodesOf, problemsOf, renderText } from '../../testing/render';
import { recipeCatalogView } from './recipeCatalogView';

const ALL: CatalogViewState = { cuisineId: null, highlightId: null };

/** The lines of one recipe's card. */
const cardOf = (text: string, name: string): string => {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.includes(`text: ${name} (title)`));
  const next = lines.findIndex((line, index) => index > start && line.includes('(title)'));
  return lines.slice(start, next === -1 ? undefined : next).join('\n');
};

describe('FU-12 RecipeCatalogView', () => {
  const tree = recipeCatalogView(readyOf(CATALOG), ALL, REFERENCE);
  const text = renderText(tree);

  it('draws every recipe as a card with its cuisine and a status badge (spec 4.4.C)', () => {
    expect(problemsOf(tree)).toEqual([]);
    expect(text).toContain('text: Recipes (heading)');
    for (const name of ['Beef and Broccoli Stir-Fry', 'Chicken Fried Rice', 'Spinach Omelette', 'Tomato Egg Stir-Fry', 'Vietnamese Chicken Rice']) {
      expect(text).toContain(`text: ${name} (title)`);
    }
    expect(cardOf(text, 'Chicken Fried Rice')).toContain('text: Full match (good)');
    expect(cardOf(text, 'Beef and Broccoli Stir-Fry')).toContain('text: Partial match (warn)');
    expect(cardOf(text, 'Tomato Egg Stir-Fry')).toContain('text: Blocked (bad)');
  });

  it('keeps the order of the recipes that the backend sorted', () => {
    const names = nodesOf(tree).flatMap((node) => (node.kind === 'button' && node.event.name === 'add' ? [node.event.payload.recipeName] : []));

    expect(names).toEqual(['Beef and Broccoli Stir-Fry', 'Chicken Fried Rice', 'Spinach Omelette', 'Tomato Egg Stir-Fry', 'Vietnamese Chicken Rice']);
  });

  describe('a partial match (spec 4.4.C, exception 10)', () => {
    const card = cardOf(text, 'Beef and Broccoli Stir-Fry');

    it('counts the ingredients that are available, and badges each Missing one', () => {
      expect(card).toContain('text: 1 of 2 ingredients available (muted)');
      expect(card).toContain('text: Beef 300 grams');
      expect(card).toContain('text: Missing (bad)');
      expect(card).toContain('text: have 150 grams (muted)');
      expect(card).toContain('text: Broccoli 200 grams');
    });

    it('can be queued', () => {
      expect(findButton(tree, 'Add to cook queue')).toMatchObject({ disabled: false });
    });
  });

  describe('a recipe with nothing available (exception 16)', () => {
    const card = cardOf(text, 'Spinach Omelette');

    it('says "Nothing available to deduct", and its queue button is disabled', () => {
      expect(card).toContain('text: Nothing available to deduct (warnNote)');
      expect(card).toContain('text: 0 of 3 ingredients available');
      expect(card).toMatch(/button: Add to cook queue \(soft\) disabled -> cook\/add/);
    });
  });

  describe('a blocked recipe is red and cannot be queued (spec 4.4.A, exceptions 6 and 7)', () => {
    it('says "Missing food type: {name}" for a deleted Food Type', () => {
      const card = cardOf(text, 'Tomato Egg Stir-Fry');

      expect(card).toContain('text: Missing food type: Tomato (badNote)');
      expect(card).toMatch(/button: Add to cook queue \(soft\) disabled/);
    });

    it('names both units for a unit conflict, and says what to fix', () => {
      const card = cardOf(text, 'Vietnamese Chicken Rice');

      expect(card).toContain('Unit conflict: Chicken is held in grams, but the recipe needs 250 pieces. Fix the recipe or the unit of Chicken.');
      expect(card).toMatch(/button: Add to cook queue \(soft\) disabled/);
    });

    it('draws the whole card in red', () => {
      const cards = nodesOf(tree).filter((node) => node.kind === 'box' && node.layout === 'card');

      expect(cards.map((card) => (card.kind === 'box' ? card.tone : undefined))).toEqual([undefined, undefined, undefined, 'blocked', 'blocked']);
    });

    it('does not count the ingredients of a recipe that cannot be evaluated', () => {
      expect(cardOf(text, 'Tomato Egg Stir-Fry')).not.toContain('ingredients available');
    });
  });

  it('says "All ingredients available" for a full match', () => {
    expect(cardOf(text, 'Chicken Fried Rice')).toContain('text: All ingredients available (muted)');
  });

  describe('the cuisine filter', () => {
    it('has All, and a button for each cuisine, with the one in use marked', () => {
      const labels = nodesOf(tree).flatMap((node) => (node.kind === 'button' && node.event.name === 'setCuisineFilter' ? [node.label] : []));

      expect(labels).toEqual(['All', 'Chinese Cuisine', 'Vietnamese Cuisine', 'French Cuisine', 'Other']);
      expect(findButton(tree, 'All')).toMatchObject({ tone: 'selected', event: { ns: 'catalog', name: 'setCuisineFilter', payload: { cuisineId: null } } });
      expect(findButton(tree, 'French Cuisine')).not.toHaveProperty('tone');
    });

    it('marks the cuisine that is chosen, and each button carries the id of its cuisine', () => {
      const french = recipeCatalogView(readyOf({ ...CATALOG, cuisineId: 12 }), { cuisineId: 12, highlightId: null }, REFERENCE);

      expect(findButton(french, 'French Cuisine')).toMatchObject({ tone: 'selected', event: { payload: { cuisineId: 12 } } });
      expect(findButton(french, 'All')).not.toHaveProperty('tone');
    });

    it('does not filter the recipes itself: the backend does', () => {
      const french = recipeCatalogView(readyOf(CATALOG), { cuisineId: 12, highlightId: null }, REFERENCE);

      expect(renderText(french)).toContain('Chicken Fried Rice');
    });

    it('draws before the reference data has arrived, with the All button only', () => {
      const bare = recipeCatalogView(readyOf(CATALOG), ALL, null);

      expect(nodesOf(bare).filter((node) => node.kind === 'button' && node.event.name === 'setCuisineFilter')).toHaveLength(1);
    });
  });

  describe('the recipe that was opened from the recommendations', () => {
    it('is marked', () => {
      const marked = recipeCatalogView(readyOf(CATALOG), { cuisineId: null, highlightId: 41 }, REFERENCE);

      expect(cardOf(renderText(marked), 'Chicken Fried Rice')).toContain('text: Opened from Recommendations (muted)');
      expect(renderText(marked).match(/Opened from Recommendations/g)).toHaveLength(1);
      expect(nodesOf(marked).filter((node) => node.kind === 'box' && node.tone === 'chosen')).toHaveLength(1);
    });

    it('stays red when it is also blocked', () => {
      const marked = recipeCatalogView(readyOf(CATALOG), { cuisineId: null, highlightId: 43 }, REFERENCE);

      expect(nodesOf(marked).filter((node) => node.kind === 'box' && node.tone === 'chosen')).toHaveLength(0);
    });
  });

  describe('the buttons of a recipe', () => {
    it('queue it with its id and name', () => {
      expect(eventsOf(tree)).toContainEqual({ ns: 'cook', name: 'add', payload: { recipeId: 41, recipeName: 'Chicken Fried Rice' } });
    });

    it('edit it, carrying the recipe as the catalog shows it, so the form can open without a request', () => {
      expect(eventsOf(tree)).toContainEqual({ ns: 'recipe', name: 'editRecipe', payload: { recipe: STIR_FRY } });
      expect(eventsOf(tree)).toContainEqual({ ns: 'recipe', name: 'editRecipe', payload: { recipe: TOMATO_EGG } });
    });

    it('delete it, carrying the recipe', () => {
      expect(eventsOf(tree)).toContainEqual({ ns: 'recipeDelete', name: 'deleteRecipe', payload: { recipe: FRIED_RICE } });
    });

    it('add a new recipe', () => {
      expect(findButton(tree, 'New recipe')?.event).toEqual({ ns: 'recipe', name: 'newRecipe', payload: {} });
    });

    it('send their events to the catalog, cook, recipe and recipeDelete namespaces', () => {
      expect(new Set(eventsOf(tree).map((event) => event.ns))).toEqual(new Set(['catalog', 'cook', 'recipe', 'recipeDelete']));
    });
  });

  it('says "No recipes" for an empty catalog', () => {
    expect(renderText(recipeCatalogView(readyOf<CatalogDto>({ cuisineId: null, rows: [] }), ALL, REFERENCE))).toContain('text: No recipes (empty)');
  });

  it('draws what each state of the read has', () => {
    expect(renderText(recipeCatalogView(loadingOf<CatalogDto>(), ALL, REFERENCE))).toContain('text: Loading…');
    expect(renderText(recipeCatalogView(failedOf<CatalogDto>(), ALL, REFERENCE))).toContain('text: Could not load the recipes. (badNote)');
    expect(renderText(recipeCatalogView(idleOf<CatalogDto>(), ALL, REFERENCE))).not.toContain('Loading');
    expect(renderText(recipeCatalogView(loadingOf(CATALOG), ALL, REFERENCE))).toContain('Chicken Fried Rice');
    // the filter and the New recipe button are there whatever the state of the read
    expect(findButton(recipeCatalogView(failedOf<CatalogDto>(), ALL, REFERENCE), 'New recipe')).toBeDefined();
  });
});
