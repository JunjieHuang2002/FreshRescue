import type { DomainError } from '@freshrescue/contract-errors';
import type { Id } from '@freshrescue/contract-primitives';
import type { FieldHints, FormKind, FormPrefill } from './forms';
import type { NoticeModel } from './notice';
import type { FormEntry, Tab } from './states';

// What can happen to each slice. A slice never fails: an action that is illegal in the current
// state returns the state unchanged.

/** ResourceSlice: a read starts (`loading`), ends (`ready`, `failed`), or is forgotten (`idle`). */
export type ResourceAction<T> =
  | { readonly type: 'idle' }
  | { readonly type: 'loading' }
  | { readonly type: 'ready'; readonly data: T }
  | { readonly type: 'failed'; readonly error: DomainError };

/** FormSlice. */
export type FormAction =
  /** Open a form with its initial texts, in `editing`, or in `confirming` for a destructive action. */
  | { readonly type: 'open'; readonly kind: FormKind; readonly prefill: FormPrefill; readonly at: FormEntry }
  /** The person typed or chose something. */
  | { readonly type: 'edit'; readonly field: string; readonly value: string }
  /** Put new initial texts and drop-down entries into the open form, for example after a Food Type is picked. */
  | { readonly type: 'refill'; readonly prefill: FormPrefill }
  /** Add an empty row to a `rows` field. `fields` names the fields of the new row. */
  | { readonly type: 'addRow'; readonly group: string; readonly fields: readonly string[] }
  | { readonly type: 'removeRow'; readonly group: string; readonly index: number }
  /** The person cancelled. */
  | { readonly type: 'close' }
  /** The request is on its way. */
  | { readonly type: 'submitting' }
  /** The submit was refused, or never sent: back to where the form was, with hints. */
  | { readonly type: 'rejected'; readonly hints: FieldHints }
  /** The request succeeded. */
  | { readonly type: 'closed' };

/** NavigationSlice: go to a tab, with a Food Type detail open inside it or none. */
export type NavAction = { readonly type: 'go'; readonly tab: Tab; readonly detail: Id | null };

/** NoticeSlice. */
export type NoticeAction =
  | { readonly type: 'push'; readonly notice: NoticeModel }
  | { readonly type: 'dismiss'; readonly id: number };

/** CatalogViewSlice. */
export type CatalogViewAction =
  | { readonly type: 'cuisine'; readonly cuisineId: Id | null }
  | { readonly type: 'highlight'; readonly recipeId: Id | null };

/** CookQueueSlice. */
export type QueueAction =
  | { readonly type: 'add'; readonly recipeId: Id; readonly recipeName: string }
  | { readonly type: 'remove'; readonly index: number }
  | { readonly type: 'move'; readonly index: number; readonly direction: 'up' | 'down' }
  /** Remove every entry of a recipe that was deleted. */
  | { readonly type: 'prune'; readonly recipeId: Id }
  | { readonly type: 'clear' };
