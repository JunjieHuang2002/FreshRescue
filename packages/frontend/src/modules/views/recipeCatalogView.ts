import type { Id } from '@freshrescue/contract-primitives';
import type { CatalogViewState, RenderTree, ResourceState, Tone } from '@freshrescue/contract-ui';
import type { CatalogDto, CatalogRow, RecipeLine, ReferenceDataDto } from '@freshrescue/contract-views';

const STATUS_LABEL = { full: 'Full match', partial: 'Partial match', nothing: 'Partial match', blocked: 'Blocked' } as const;
const STATUS_TONE: Record<CatalogRow['status'], Tone> = { full: 'good', partial: 'warn', nothing: 'warn', blocked: 'bad' };

function lineOf(line: RecipeLine): RenderTree {
  const quantity = `${line.requiredQuantity / 1000} ${line.requiredUnit}`;
  if (line.state === 'missingFoodType') return { kind: 'text', text: `Missing food type: ${line.name}`, tone: 'badNote' };
  if (line.state === 'unitConflict') {
    return {
      kind: 'text',
      text: `Unit conflict: ${line.name} is held in ${line.foodTypeUnit ?? '?'}, but the recipe needs ${quantity}. Fix the recipe or the unit of ${line.name}.`,
      tone: 'badNote',
    };
  }
  const marks: RenderTree[] =
    line.state === 'missing'
      ? [
          { kind: 'text', text: 'Missing', tone: 'bad' },
          ...(line.available === null ? [] : [{ kind: 'text', text: `have ${line.available / 1000} ${line.requiredUnit}`, tone: 'muted' } as const]),
        ]
      : [];
  return { kind: 'box', layout: 'ingredient', children: [{ kind: 'text', text: `${line.name} ${quantity}`, tone: 'plain' }, ...marks] };
}

function cardOf(row: CatalogRow, marked: boolean): RenderTree {
  const cookable = row.status === 'full' || row.status === 'partial';
  const count: RenderTree[] =
    row.status === 'blocked'
      ? []
      : [{ kind: 'text', text: row.status === 'full' ? 'All ingredients available' : `${row.availableCount} of ${row.totalCount} ingredients available`, tone: 'muted' }];
  const note: RenderTree[] = row.status === 'nothing' ? [{ kind: 'text', text: 'Nothing available to deduct', tone: 'warnNote' }] : [];
  const tone: Tone | undefined = row.status === 'blocked' ? 'blocked' : marked ? 'chosen' : undefined;
  return {
    kind: 'box',
    layout: 'card',
    ...(tone === undefined ? {} : { tone }),
    children: [
      {
        kind: 'box',
        layout: 'caption',
        children: [
          { kind: 'text', text: row.name, tone: 'title' },
          { kind: 'text', text: row.cuisineName, tone: 'chip' },
          { kind: 'text', text: STATUS_LABEL[row.status], tone: STATUS_TONE[row.status] },
        ],
      },
      ...(marked ? [{ kind: 'text', text: 'Opened from Recommendations', tone: 'muted', icon: 'sparkle' } as const] : []),
      ...count,
      ...note,
      ...row.ingredients.map(lineOf),
      {
        kind: 'box',
        layout: 'actions',
        children: [
          {
            kind: 'button',
            label: 'Add to cook queue',
            tone: 'soft',
            icon: 'plus',
            event: { ns: 'cook', name: 'add', payload: { recipeId: row.recipeId, recipeName: row.name } },
            disabled: !cookable,
          },
          {
            kind: 'box',
            layout: 'tools',
            children: [
              { kind: 'button', label: 'Edit', tone: 'quiet', icon: 'pencil', event: { ns: 'recipe', name: 'editRecipe', payload: { recipe: row } } },
              { kind: 'button', label: 'Delete', tone: 'remove', icon: 'trash', event: { ns: 'recipeDelete', name: 'deleteRecipe', payload: { recipe: row } } },
            ],
          },
        ],
      },
    ],
  };
}

function filterOf(view: CatalogViewState, reference: ReferenceDataDto | null): RenderTree {
  const choice = (label: string, cuisineId: Id | null): RenderTree => ({
    kind: 'button',
    label,
    event: { ns: 'catalog', name: 'setCuisineFilter', payload: { cuisineId } },
    ...(view.cuisineId === cuisineId ? { tone: 'selected' as const } : {}),
  });
  return {
    kind: 'box',
    layout: 'chips',
    children: [{ kind: 'text', text: 'Cuisine', tone: 'muted' }, choice('All', null), ...(reference?.cuisines ?? []).map((cuisine) => choice(cuisine.name, cuisine.id))],
  };
}

/**
 * FU-12 RecipeCatalogView. Draws Feature 4, the catalog of every recipe (spec 4.4.C, blueprint 1.8):
 * a cuisine filter with "All" first, and each recipe as a card with its cuisine, a status badge, how
 * many ingredients are available ("2 of 3 ingredients available"), and its ingredient rows.
 *
 * - A Missing ingredient is badged. A recipe with nothing available says "Nothing available to
 *   deduct" (exception 16), and its queue button is disabled.
 * - A Blocked recipe is red: a deleted Food Type reads "Missing food type: {name}" (exception 7), and
 *   a unit conflict names both units and says what to fix (exception 6). It cannot be queued.
 * - The recipe that was opened from the recommendations is marked.
 * - Each card has buttons to queue the recipe (an event of the `cook` namespace), edit it and delete
 *   it. The edit button carries the whole recipe, so the form can open without a request.
 *
 * The recipes come in the order that the backend sorted them, and filtered by the cuisine that it
 * was asked for: the view filters nothing itself.
 */
export function recipeCatalogView(
  resource: ResourceState<CatalogDto>,
  view: CatalogViewState,
  reference: ReferenceDataDto | null,
): RenderTree {
  const { data } = resource.context;
  let body: RenderTree[] = [];
  if (resource.value === 'loading' && data === null) body = [{ kind: 'text', text: 'Loading…', tone: 'muted' }];
  else if (resource.value === 'failed') body = [{ kind: 'text', text: 'Could not load the recipes.', tone: 'badNote' }];
  else if (resource.value === 'ready' || (resource.value === 'loading' && data !== null)) {
    if (data !== null && data.rows.length === 0) body = [{ kind: 'text', text: 'No recipes', tone: 'empty', icon: 'pot' }];
    else if (data !== null) body = [{ kind: 'box', layout: 'cards', children: data.rows.map((row) => cardOf(row, row.recipeId === view.highlightId)) }];
  }
  return {
    kind: 'box',
    layout: 'stack',
    children: [
      {
        kind: 'box',
        layout: 'header',
        children: [
          { kind: 'text', text: 'Recipes', tone: 'heading' },
          { kind: 'button', label: 'New recipe', tone: 'primary', icon: 'plus', event: { ns: 'recipe', name: 'newRecipe', payload: {} } },
        ],
      },
      filterOf(view, reference),
      ...body,
    ],
  };
}
