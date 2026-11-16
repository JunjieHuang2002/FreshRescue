import type { RenderTree, ResourceState } from '@freshrescue/contract-ui';
import type { RecipeLine, RecommendationDto, RecommendationRow } from '@freshrescue/contract-views';

const EMPTY_TEXT = {
  noNearExpiry: 'No near-expiry items — no rescue recipes are needed',
  noRescue: 'No recipe can rescue your near-expiry items yet',
} as const;

function lineOf(line: RecipeLine): RenderTree {
  const marks: RenderTree[] = [];
  if (line.state === 'missing') {
    marks.push({ kind: 'text', text: 'Missing', tone: 'bad' });
    if (line.available !== null) marks.push({ kind: 'text', text: `have ${line.available / 1000} ${line.requiredUnit}`, tone: 'muted' });
  }
  if (line.rescued) marks.push({ kind: 'text', text: 'Rescues near-expiry stock', tone: 'warn' });
  return {
    kind: 'box',
    layout: 'ingredient',
    children: [{ kind: 'text', text: `${line.name} ${line.requiredQuantity / 1000} ${line.requiredUnit}`, tone: 'plain' }, ...marks],
  };
}

const cardOf = (recipe: RecommendationRow): RenderTree => ({
  kind: 'box',
  layout: 'card',
  children: [
    {
      kind: 'box',
      layout: 'caption',
      children: [
        { kind: 'text', text: recipe.name, tone: 'title' },
        { kind: 'text', text: recipe.cuisineName, tone: 'chip' },
      ],
    },
    { kind: 'text', text: `${recipe.availableCount} of ${recipe.totalCount} ingredients available`, tone: 'muted' },
    ...recipe.ingredients.map(lineOf),
    {
      kind: 'box',
      layout: 'actions',
      children: [
        {
          kind: 'button',
          label: 'Open in Cook',
          tone: 'soft',
          icon: 'forward',
          event: { ns: 'recommendations', name: 'openInCook', payload: { recipeId: recipe.recipeId } },
        },
      ],
    },
  ],
});

function listOf(dto: RecommendationDto): RenderTree[] {
  if (dto.emptyState !== null) return [{ kind: 'text', text: EMPTY_TEXT[dto.emptyState], tone: 'empty', icon: 'leaf' }];
  if (dto.tier === null || dto.recipes.length === 0) return [{ kind: 'text', text: 'No recommendations', tone: 'empty', icon: 'leaf' }];
  const heading: RenderTree[] =
    dto.tier === 'full'
      ? [{ kind: 'text', text: 'Full matches', tone: 'title', icon: 'sparkle' }]
      : [
          { kind: 'text', text: 'Partial Matches', tone: 'title', icon: 'sparkle' },
          { kind: 'text', text: 'No recipe is a full match, so these are missing an ingredient. Each missing one is marked.', tone: 'muted' },
        ];
  return [...heading, { kind: 'box', layout: 'cards', children: dto.recipes.map(cardOf) }];
}

/**
 * FU-11 RecommendationView. Draws Feature 3 (spec 4.4.B and 4.6, blueprint 1.8): the recipes that
 * rescue near-expiry stock, as full matches (tier 1), or as Partial Matches when there is no full
 * match (tier 2), with each Missing ingredient badged and each Rescued ingredient marked. Each recipe
 * has an "Open in Cook" button and no cook control, because Feature 3 only recommends. With nothing
 * to recommend it says why, in the words of the two empty states: "No near-expiry items — no rescue
 * recipes are needed" (exception 13), or "No recipe can rescue your near-expiry items yet" (exception
 * 17). The order of the recipes is the backend's, A to Z.
 */
export function recommendationView(resource: ResourceState<RecommendationDto>): RenderTree {
  const { data } = resource.context;
  if (resource.value === 'idle') return { kind: 'box', layout: 'stack', children: [] };
  let body: RenderTree[] = [];
  if (resource.value === 'loading' && data === null) body = [{ kind: 'text', text: 'Loading…', tone: 'muted' }];
  else if (resource.value === 'failed') body = [{ kind: 'text', text: 'Could not load the recommendations.', tone: 'badNote' }];
  else if (data !== null) body = listOf(data);
  return { kind: 'box', layout: 'stack', children: [{ kind: 'text', text: 'Recommendations', tone: 'heading' }, ...body] };
}
