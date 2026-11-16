import type { Empty, Id } from '@freshrescue/contract-primitives';
import type { CategoryScope } from '@freshrescue/contract-rules';
import type { BatchView, CatalogRow, CategoryNode, FoodTypeDetailDto } from '@freshrescue/contract-views';
import type { Tab } from './states';

/**
 * The 16 namespaces of a UI event, as the coordinator flows of blueprint 4.3 name them. A form's
 * slice key is also its namespace. The shell owns the events of the tab bar and of the notice bar
 * (`navigate`, `dismiss`), and the Warning Panel has no event of its own.
 */
export const UI_NAMESPACES = [
  'shell',
  'settings',
  'inventory',
  'batch',
  'batchRemove',
  'foodType',
  'unitConversion',
  'foodTypeDelete',
  'category',
  'threshold',
  'categoryDelete',
  'recommendations',
  'catalog',
  'recipe',
  'recipeDelete',
  'cook',
] as const;

export type UiNamespace = (typeof UI_NAMESPACES)[number];

/** The five frontend sub-coordinators (the word Coordinator is dropped, as in blueprint 3.4). */
export const COORDINATOR_NAMES = ['Shell', 'Inventory', 'Taxonomy', 'RecipeBook', 'Cooking'] as const;

export type CoordinatorName = (typeof COORDINATOR_NAMES)[number];

/**
 * The UI route table: the sub-coordinator that owns each namespace. AppCoordinator hands an event
 * to exactly that coordinator. `satisfies` makes a namespace without an owner a compile error.
 */
export const UI_ROUTES = {
  shell: 'Shell',
  settings: 'Shell',
  inventory: 'Inventory',
  batch: 'Inventory',
  batchRemove: 'Inventory',
  foodType: 'Taxonomy',
  unitConversion: 'Taxonomy',
  foodTypeDelete: 'Taxonomy',
  category: 'Taxonomy',
  threshold: 'Taxonomy',
  categoryDelete: 'Taxonomy',
  recommendations: 'RecipeBook',
  catalog: 'RecipeBook',
  recipe: 'RecipeBook',
  recipeDelete: 'RecipeBook',
  cook: 'Cooking',
} as const satisfies Record<UiNamespace, CoordinatorName>;

/**
 * The catalog of events: every name that a view may emit in each namespace. The names that open a
 * form (`newFoodType`, `changeUnit`, `deleteCategory`, and so on) belong to the namespace of the
 * form they open. The four form events (`edit`, `cancel`, `submit` and `open`) are shared.
 */
export const UI_EVENTS = {
  shell: ['navigate', 'dismiss'],
  settings: ['open', 'edit', 'cancel', 'submit'],
  inventory: ['openDetail', 'addBatch', 'editBatchQuantity', 'removeBatch'],
  batch: ['edit', 'pickFoodType', 'cancel', 'submit'],
  batchRemove: ['cancel', 'submit'],
  foodType: ['newFoodType', 'editFoodType', 'edit', 'cancel', 'submit'],
  unitConversion: ['changeUnit', 'edit', 'cancel', 'submit'],
  foodTypeDelete: ['deleteFoodType', 'cancel', 'submit'],
  category: ['newCategory', 'renameCategory', 'edit', 'cancel', 'submit'],
  threshold: ['setThreshold', 'edit', 'cancel', 'submit'],
  categoryDelete: ['deleteCategory', 'cancel', 'submit'],
  recommendations: ['openInCook'],
  catalog: ['setCuisineFilter'],
  recipe: ['newRecipe', 'editRecipe', 'edit', 'addRow', 'removeRow', 'cancel', 'submit'],
  recipeDelete: ['deleteRecipe', 'cancel', 'submit'],
  cook: ['add', 'remove', 'move', 'clear', 'run', 'dismiss'],
} as const satisfies Record<UiNamespace, readonly string[]>;

export type UiEventName<N extends UiNamespace> = (typeof UI_EVENTS)[N][number];

/** An input or a select: the field it is for, and the text that was typed or chosen, which the DOM host adds as `value`. */
type Typed = { readonly field: string; readonly value: string };

/**
 * What each event carries, by namespace and name (blueprint 4.3): the one table that says what a
 * view may put into an event and what a coordinator may read out of it. It covers exactly the
 * events of `UI_EVENTS`, which the contract test checks.
 *
 * An event that opens a form carries the record that the form is about, as the read model that the
 * `views` contract names, so FormPrefillBuilder is handed "view data" (blueprint 1.7) and nothing is
 * flattened into keys: `ev.batch`, `ev.foodType`, `ev.category`, `ev.parent` and `ev.recipe` of the
 * coordinator flows. The other events carry ids, a tab, a field or a position.
 */
export type UiPayloads = {
  readonly shell: {
    /** A tab, with the Food Type detail that is open inside it, or none. */
    readonly navigate: { readonly tab: Tab; readonly detail: Id | null };
    readonly dismiss: { readonly noticeId: number };
  };
  readonly settings: {
    readonly open: Empty;
    readonly edit: Typed;
    readonly cancel: Empty;
    readonly submit: Empty;
  };
  readonly inventory: {
    readonly openDetail: { readonly foodTypeId: Id };
    /** The Food Type that the batch is added to, or null to start from "New Food Type". */
    readonly addBatch: { readonly foodTypeId: Id | null };
    /** The batch, and the Food Type whose name and unit the form shows. */
    readonly editBatchQuantity: { readonly batch: BatchView; readonly foodType: FoodTypeDetailDto };
    /** `summary` is the line that describes the batch in the confirmation, such as `500 ml of Milk — expires in 4 days`. */
    readonly removeBatch: { readonly batch: BatchView; readonly summary: string };
  };
  readonly batch: {
    readonly edit: Typed;
    /** A Food Type was picked: `value` is its id as text, or an empty text for "New Food Type". */
    readonly pickFoodType: { readonly value: string };
    readonly cancel: Empty;
    readonly submit: Empty;
  };
  readonly batchRemove: {
    readonly cancel: Empty;
    readonly submit: Empty;
  };
  readonly foodType: {
    readonly newFoodType: Empty;
    readonly editFoodType: { readonly foodType: FoodTypeDetailDto };
    readonly edit: Typed;
    readonly cancel: Empty;
    readonly submit: Empty;
  };
  readonly unitConversion: {
    readonly changeUnit: { readonly foodType: FoodTypeDetailDto };
    readonly edit: Typed;
    readonly cancel: Empty;
    readonly submit: Empty;
  };
  readonly foodTypeDelete: {
    readonly deleteFoodType: { readonly foodType: FoodTypeDetailDto };
    readonly cancel: Empty;
    readonly submit: Empty;
  };
  readonly category: {
    /** A new Parent (no `parent`), a new Child under `parent`, or a new cuisine (the cuisine scope). */
    readonly newCategory: { readonly scope: CategoryScope; readonly parent: CategoryNode | null };
    readonly renameCategory: { readonly scope: CategoryScope; readonly category: CategoryNode };
    readonly edit: Typed;
    readonly cancel: Empty;
    readonly submit: Empty;
  };
  readonly threshold: {
    readonly setThreshold: { readonly category: CategoryNode };
    readonly edit: Typed;
    readonly cancel: Empty;
    readonly submit: Empty;
  };
  readonly categoryDelete: {
    readonly deleteCategory: { readonly scope: CategoryScope; readonly category: CategoryNode };
    readonly cancel: Empty;
    readonly submit: Empty;
  };
  readonly recommendations: {
    readonly openInCook: { readonly recipeId: Id };
  };
  readonly catalog: {
    readonly setCuisineFilter: { readonly cuisineId: Id | null };
  };
  readonly recipe: {
    readonly newRecipe: Empty;
    readonly editRecipe: { readonly recipe: CatalogRow };
    readonly edit: Typed;
    /** `fields` names the fields of the new row. */
    readonly addRow: { readonly group: string; readonly fields: readonly string[] };
    readonly removeRow: { readonly group: string; readonly index: number };
    readonly cancel: Empty;
    readonly submit: Empty;
  };
  readonly recipeDelete: {
    readonly deleteRecipe: { readonly recipe: CatalogRow };
    readonly cancel: Empty;
    readonly submit: Empty;
  };
  readonly cook: {
    readonly add: { readonly recipeId: Id; readonly recipeName: string };
    readonly remove: { readonly index: number };
    readonly move: { readonly index: number; readonly direction: 'up' | 'down' };
    readonly clear: Empty;
    readonly run: Empty;
    readonly dismiss: Empty;
  };
};

/** The payload of one event of the catalog. */
type PayloadOf<N extends UiNamespace, E extends string> = E extends keyof UiPayloads[N] ? UiPayloads[N][E] : never;

/** A payload without the `value` that the DOM host adds. A payload that is only `value` becomes empty. */
type WithoutValue<P> = P extends { readonly value: string }
  ? [keyof Omit<P, 'value'>] extends [never]
    ? Empty
    : Omit<P, 'value'>
  : P;

/** A user action, as the DOM host relays it to AppCoordinator (blueprint 2.5): the name of the event and its payload, `value` included. */
export type UiEvent = {
  [N in UiNamespace]: {
    [E in UiEventName<N>]: {
      readonly ns: N;
      readonly name: E;
      readonly payload: PayloadOf<N, E>;
    };
  }[UiEventName<N>];
}[UiNamespace];

/**
 * The event that a node of a view carries (blueprint 1.8: "a namespaced `UiEvent` descriptor"). It is
 * the event without the `value` of an input or a select, because the view cannot know the text yet:
 * the DOM host adds it when the person types or chooses, and so makes the `UiEvent` of the same name.
 */
export type UiEventDescriptor = {
  [N in UiNamespace]: {
    [E in UiEventName<N>]: {
      readonly ns: N;
      readonly name: E;
      readonly payload: WithoutValue<PayloadOf<N, E>>;
    };
  }[UiEventName<N>];
}[UiNamespace];
