import type { Id } from '@freshrescue/contract-primitives';
import type { NoticeModel } from './notice';
import type { Tab } from './states';

/**
 * What a sub-coordinator asks of the top coordinator (blueprint 3.3). A sub-coordinator never calls
 * another one: it returns intents, and the top applies each, which is how a form in one coordinator
 * refreshes a list that another owns.
 *   navigate       go to a tab, with a detail open or not
 *   notify         show a notice
 *   dataChanged    reload the visible views
 *   openInCook     show a recipe in the catalog, highlighted
 *   recipeDeleted  drop the recipe from the cook queue
 */
export type Intent =
  | { readonly kind: 'navigate'; readonly tab: Tab; readonly detail: Id | null }
  | { readonly kind: 'notify'; readonly notice: NoticeModel }
  | { readonly kind: 'dataChanged' }
  | { readonly kind: 'openInCook'; readonly recipeId: Id }
  | { readonly kind: 'recipeDeleted'; readonly recipeId: Id };

/** Every kind of `Intent`. */
export const INTENT_KINDS = [
  'navigate',
  'notify',
  'dataChanged',
  'openInCook',
  'recipeDeleted',
] as const satisfies readonly Intent['kind'][];
