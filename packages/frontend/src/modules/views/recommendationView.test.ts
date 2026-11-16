import { describe, expect, it } from 'vitest';
import type { RecommendationDto } from '@freshrescue/contract-views';
import {
  RECOMMENDATIONS,
  RECOMMENDATIONS_NO_NEAR_EXPIRY,
  RECOMMENDATIONS_NO_RESCUE,
  RECOMMENDATIONS_PARTIAL,
  failedOf,
  idleOf,
  loadingOf,
  readyOf,
} from '../../testing/fixtures';
import { eventsOf, findButton, problemsOf, renderText } from '../../testing/render';
import { recommendationView } from './recommendationView';

describe('FU-11 RecommendationView', () => {
  describe('tier 1: full matches (spec 4.4.B)', () => {
    const tree = recommendationView(readyOf(RECOMMENDATIONS));
    const text = renderText(tree);

    it('draws each recipe with its cuisine, how many ingredients are available, and its ingredients', () => {
      expect(problemsOf(tree)).toEqual([]);
      expect(text).toContain('text: Full matches (title)');
      expect(text).toContain('text: Chicken Fried Rice (title)');
      expect(text).toContain('text: Chinese Cuisine (chip)');
      expect(text).toContain('text: 3 of 3 ingredients available (muted)');
      expect(text).toContain('text: Chicken 200 grams');
      expect(text).toContain('text: Egg 2 pieces');
    });

    it('marks the Rescued Ingredient, the one that uses near-expiry stock', () => {
      expect(text.match(/Rescues near-expiry stock \(warn\)/g)).toHaveLength(1);
    });

    it('has an "Open in Cook" button for the recipe, and no cook control, because Feature 3 only recommends', () => {
      expect(findButton(tree, 'Open in Cook')?.event).toEqual({ ns: 'recommendations', name: 'openInCook', payload: { recipeId: 41 } });
      expect(eventsOf(tree).map((event) => event.ns)).toEqual(['recommendations']);
      expect(text).not.toContain('Cook & Deduct');
    });
  });

  describe('tier 2: partial matches, when there is no full match (exception 11)', () => {
    const tree = recommendationView(readyOf(RECOMMENDATIONS_PARTIAL));
    const text = renderText(tree);

    it('is headed "Partial Matches"', () => {
      expect(problemsOf(tree)).toEqual([]);
      expect(text).toContain('text: Partial Matches (title)');
      expect(text).not.toContain('Full matches');
    });

    it('badges each Missing Ingredient, with what there is of it', () => {
      expect(text).toContain('text: Beef 300 grams');
      expect(text).toContain('text: Missing (bad)');
      expect(text).toContain('text: have 150 grams (muted)');
      expect(text.match(/Missing \(bad\)/g)).toHaveLength(1);
    });

    it('counts the ingredients that are available', () => {
      expect(text).toContain('text: 1 of 2 ingredients available (muted)');
    });
  });

  describe('the two empty states (spec 4.6)', () => {
    it('says that no rescue recipes are needed when nothing is near expiry (exception 13)', () => {
      const text = renderText(recommendationView(readyOf(RECOMMENDATIONS_NO_NEAR_EXPIRY)));

      expect(text).toContain('text: No near-expiry items — no rescue recipes are needed (empty)');
      expect(text).not.toContain('No recipe can rescue');
    });

    it('says that no recipe can rescue the near-expiry items when there are some and no recipe does (exception 17)', () => {
      const text = renderText(recommendationView(readyOf(RECOMMENDATIONS_NO_RESCUE)));

      expect(text).toContain('text: No recipe can rescue your near-expiry items yet (empty)');
      expect(text).not.toContain('no rescue recipes are needed');
    });

    it('draws no recipe and no button in either', () => {
      for (const dto of [RECOMMENDATIONS_NO_NEAR_EXPIRY, RECOMMENDATIONS_NO_RESCUE]) {
        const tree = recommendationView(readyOf(dto));

        expect(problemsOf(tree)).toEqual([]);
        expect(eventsOf(tree)).toEqual([]);
      }
    });

    it('does not say "No recommendations" for an empty state that has a reason', () => {
      expect(renderText(recommendationView(readyOf(RECOMMENDATIONS_NO_RESCUE)))).not.toContain('No recommendations');
    });

    it('still answers when the backend sends neither tier, empty state nor recipe', () => {
      const nothing: RecommendationDto = { tier: null, recipes: [], emptyState: null };

      expect(renderText(recommendationView(readyOf(nothing)))).toContain('text: No recommendations (empty)');
    });
  });

  it('keeps the order of the recipes that the backend sorted', () => {
    const two: RecommendationDto = {
      ...RECOMMENDATIONS,
      recipes: [RECOMMENDATIONS.recipes[0]!, { ...RECOMMENDATIONS.recipes[0]!, recipeId: 99, name: 'Spinach Omelette' }],
    };
    const names = eventsOf(recommendationView(readyOf(two))).flatMap((event) => (event.name === 'openInCook' ? [event.payload.recipeId] : []));

    expect(names).toEqual([41, 99]);
  });

  it('draws what each state of the read has', () => {
    expect(recommendationView(idleOf<RecommendationDto>())).toEqual({ kind: 'box', layout: 'stack', children: [] });
    expect(renderText(recommendationView(loadingOf<RecommendationDto>()))).toContain('text: Loading…');
    expect(renderText(recommendationView(failedOf<RecommendationDto>()))).toContain('text: Could not load the recommendations. (badNote)');
    expect(renderText(recommendationView(loadingOf(RECOMMENDATIONS)))).toContain('Chicken Fried Rice');
  });
});
