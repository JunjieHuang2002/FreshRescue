import type { DomainError } from '@freshrescue/contract-errors';
import type { Id } from '@freshrescue/contract-primitives';
import type { FieldHints, FormKind, FormValues, OptionLists } from './forms';
import type { NoticeModel } from './notice';

// The state of each slice (blueprint 2.5). A slice is a pure reducer: it takes a state and an action
// and returns the next state. ResourceSlice and FormSlice are real state machines, run through
// XState's `getNextSnapshot` on plain `{ value, context }` data, so their states have that shape.
// The other four slices are one-line reducers over plain records.

/** The five tabs. The Categories tab holds the category trees. */
export const TABS = ['inventory', 'warnings', 'recommendations', 'catalog', 'categories'] as const;

export type Tab = (typeof TABS)[number];

/** NavigationSlice: the active tab, and the Food Type detail that is open inside the Inventory tab. */
export type NavState = {
  readonly tab: Tab;
  readonly detail: Id | null;
};

export const RESOURCE_VALUES = ['idle', 'loading', 'ready', 'failed'] as const;

export type ResourceValue = (typeof RESOURCE_VALUES)[number];

/** ResourceSlice: one remote read. `data` is set when it is ready, `error` when it has failed. */
export type ResourceState<T> = {
  readonly value: ResourceValue;
  readonly context: {
    readonly data: T | null;
    readonly error: DomainError | null;
  };
};

export const FORM_MODES = ['closed', 'editing', 'confirming', 'submitting'] as const;

export type FormMode = (typeof FORM_MODES)[number];

/** The mode a form opens in, and the mode a rejected submit returns to. A destructive action opens in `confirming`. */
export type FormEntry = Extract<FormMode, 'editing' | 'confirming'>;

/** FormSlice: one form, closed, being edited, being confirmed, or being submitted. */
export type FormState = {
  readonly value: FormMode;
  readonly context: {
    /** Which form is open. null while it is closed. */
    readonly kind: FormKind | null;
    readonly values: FormValues;
    readonly options: OptionLists;
    readonly hints: FieldHints;
    /** Where a rejected submit returns to: `editing`, or `confirming` for a confirmation. */
    readonly returnTo: FormEntry;
  };
};

/** A notice in the queue, with the id that dismisses it. */
export type NoticeItem = {
  readonly id: number;
  readonly notice: NoticeModel;
};

/** NoticeSlice: the visible notices, oldest first, and the id of the next one. */
export type NoticeState = {
  readonly items: readonly NoticeItem[];
  readonly nextId: number;
};

/** CatalogViewSlice: the cuisine filter (null for all) and the recipe highlighted after "Open in Cook". */
export type CatalogViewState = {
  readonly cuisineId: Id | null;
  readonly highlightId: Id | null;
};

/** A recipe in the cook queue. The name is kept so that the queue draws without a request. */
export type QueueEntry = {
  readonly recipeId: Id;
  readonly recipeName: string;
};

/** CookQueueSlice: the recipes in the order they will run. The same recipe may appear twice. */
export type QueueState = {
  readonly entries: readonly QueueEntry[];
};
