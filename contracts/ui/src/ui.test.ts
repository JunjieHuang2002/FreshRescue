import type { DomainError } from '@freshrescue/contract-errors';
import type { CommandPayloads, Envelope } from '@freshrescue/contract-messages';
import { COMMAND_TYPES } from '@freshrescue/contract-messages';
import type { Empty, Result } from '@freshrescue/contract-primitives';
import { CATEGORY_SCOPES, UNIT_LIST } from '@freshrescue/contract-rules';
import type { CatalogDto, FoodTypeDetailDto } from '@freshrescue/contract-views';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CONTROLS,
  CONTROL_CLASS,
  FIELD_CLASS,
  FIELD_PARTS,
  FORM_KINDS,
  FORM_MODES,
  FORM_SCHEMAS,
  ICONS,
  ICON_CLASS,
  INTENT_KINDS,
  LAYOUTS,
  LAYOUT_CLASS,
  NODE_KINDS,
  RESOURCE_VALUES,
  SLOT_IDS,
  TABS,
  TONES,
  TONE_CLASS,
  UI_EVENTS,
  UI_NAMESPACES,
  UI_ROUTES,
} from './index';
import type {
  CatalogViewAction,
  CatalogViewState,
  ConfirmModel,
  Ctx,
  FormAction,
  FormErrorCode,
  FormState,
  Intent,
  NavAction,
  NavState,
  NodeKind,
  NoticeAction,
  NoticeState,
  QueueAction,
  QueueState,
  RenderTree,
  ResourceAction,
  ResourceState,
  ResourceValue,
  SchemaName,
  UiEvent,
  UiEventDescriptor,
  UiEventName,
  UiNamespace,
  UiPayloads,
} from './index';

type FieldKeys<S extends SchemaName> = keyof (typeof FORM_SCHEMAS)[S]['fields'];

describe('ui', () => {
  it('gives each of the 16 namespaces to exactly one of the five coordinators', () => {
    const ownedBy = (coordinator: string): number => UI_NAMESPACES.filter((ns) => UI_ROUTES[ns] === coordinator).length;

    expect(UI_NAMESPACES).toHaveLength(16);
    expect(new Set(UI_NAMESPACES).size).toBe(16);
    expect(Object.keys(UI_ROUTES).sort()).toEqual([...UI_NAMESPACES].sort());
    expect(Object.keys(UI_EVENTS).sort()).toEqual([...UI_NAMESPACES].sort());
    expect({
      Shell: ownedBy('Shell'),
      Inventory: ownedBy('Inventory'),
      Taxonomy: ownedBy('Taxonomy'),
      RecipeBook: ownedBy('RecipeBook'),
      Cooking: ownedBy('Cooking'),
    }).toEqual({ Shell: 2, Inventory: 3, Taxonomy: 6, RecipeBook: 4, Cooking: 1 });
    for (const ns of UI_NAMESPACES) expect(new Set(UI_EVENTS[ns]).size).toBe(UI_EVENTS[ns].length);

    // the route table and the catalog of events that a view may emit, namespace by namespace
    expect(UI_ROUTES).toEqual({
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
    });
    expect(UI_EVENTS).toEqual({
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
    });

    // an event is one of the names of its namespace, and the table of payloads covers exactly those names
    expectTypeOf<UiEvent['ns']>().toEqualTypeOf<UiNamespace>();
    expectTypeOf<keyof UiPayloads>().toEqualTypeOf<UiNamespace>();
    expectTypeOf<{ [N in UiNamespace]: keyof UiPayloads[N] }>().toEqualTypeOf<{ [N in UiNamespace]: UiEventName<N> }>();
    const pick: UiEvent = { ns: 'batch', name: 'pickFoodType', payload: { value: '5' } };
    expect(UI_EVENTS[pick.ns]).toContain(pick.name);
    // @ts-expect-error `submit` is not an event of the shell
    const _wrong: UiEvent = { ns: 'shell', name: 'submit', payload: {} };
    void _wrong;

    // an event that opens a form carries the record of the `views` contract, not keys made from it
    const foodType: FoodTypeDetailDto = {
      foodTypeId: 20,
      name: 'Beef',
      categoryId: 4,
      categoryPath: ['Meat', 'Red Meat'],
      unit: 'grams',
      customThresholdDays: null,
      threshold: { days: 5, source: 'parent' },
      total: 0,
      byStatus: { fresh: 0, nearExpiry: 0, expired: 0 },
      overall: null,
      batches: [],
      referencingRecipes: [],
    };
    const edit: UiEvent = { ns: 'foodType', name: 'editFoodType', payload: { foodType } };
    expect(edit.payload).toEqual({ foodType });
    // @ts-expect-error a key of the record is not the record
    const _flat: UiEvent = { ns: 'foodType', name: 'editFoodType', payload: { foodTypeId: 20 } };
    void _flat;
    // @ts-expect-error a quantity edit needs the batch as well as the Food Type
    const _half: UiEvent = { ns: 'inventory', name: 'editBatchQuantity', payload: { foodType } };
    void _half;

    // the event that a node carries has no `value`, which the DOM host adds when the person types or
    // chooses, and the event that is relayed has it
    const descriptor: UiEventDescriptor = { ns: 'batch', name: 'edit', payload: { field: 'quantity' } };
    const relayed: UiEvent = { ns: 'batch', name: 'edit', payload: { field: 'quantity', value: '1.5' } };
    expect([descriptor.payload, relayed.payload]).toEqual([{ field: 'quantity' }, { field: 'quantity', value: '1.5' }]);
    // @ts-expect-error a node cannot know the text yet
    const _early: UiEventDescriptor = { ns: 'batch', name: 'edit', payload: { field: 'quantity', value: '1.5' } };
    void _early;
    // @ts-expect-error a relayed edit must say what was typed
    const _late: UiEvent = { ns: 'batch', name: 'edit', payload: { field: 'quantity' } };
    void _late;
    expectTypeOf<Extract<UiEventDescriptor, { name: 'pickFoodType' }>['payload']>().toEqualTypeOf<Empty>();
    expectTypeOf<Extract<UiEventDescriptor, { ns: 'cook'; name: 'move' }>['payload']>().toEqualTypeOf<UiPayloads['cook']['move']>();
    expectTypeOf<Extract<UiEventDescriptor, { ns: 'recipe'; name: 'edit' }>['payload']>().toEqualTypeOf<{ readonly field: string }>();
  });

  it('reads the 8 edit forms and the TARGET confirmation, which cover the payloads of 12 commands', () => {
    const editForms = ['settings', 'batchAdd', 'batchQty', 'foodType', 'unitChange', 'category', 'threshold', 'recipe'] as const;
    const editCommands: readonly string[] = editForms.map((name) => FORM_SCHEMAS[name].command);
    const covered: readonly string[] = [...editCommands, ...FORM_SCHEMAS.target.commands];

    expect(Object.keys(FORM_SCHEMAS)).toEqual([...editForms, 'target']);
    expect(new Set(editCommands).size).toBe(8);
    // the four deletions share the one confirmation schema
    expect(FORM_SCHEMAS.target.commands).toEqual(['DeleteCategory', 'DeleteFoodType', 'RemoveBatch', 'DeleteRecipe']);
    // twelve commands are written by a form. The 13th, CookRecipes, takes its recipeIds from the cook queue
    expect(new Set(covered).size).toBe(12);
    expect(COMMAND_TYPES.filter((type) => !covered.includes(type))).toEqual(['CookRecipes']);
    expect(FORM_KINDS).toHaveLength(15);

    // what the parser has to read: quantities are decimal text in thousandths, days are whole
    // numbers, an inbound has a shelf life or a date, and a recipe needs at least one row
    const { batchAdd, batchQty, unitChange, recipe, foodType, threshold, settings, category } = FORM_SCHEMAS;
    expect(batchAdd.fields.quantity).toEqual({ kind: 'qty', required: true });
    expect(batchQty.fields.quantity).toEqual({ kind: 'qty', required: true });
    expect(unitChange.fields.batches.fields.quantity).toEqual({ kind: 'qty', required: true });
    expect(recipe.fields.draft.fields.rows).toMatchObject({ kind: 'rows', min: 1 });
    expect(recipe.fields.draft.fields.rows.fields.quantity).toEqual({ kind: 'qty', required: true });
    expect(batchAdd.fields.expiry).toEqual({
      kind: 'either',
      branches: { days: { kind: 'int', required: true }, date: { kind: 'date', required: true } },
    });
    expect(foodType.fields.thresholdDays).toEqual({ kind: 'int', required: false });
    expect(threshold.fields.thresholdDays).toEqual({ kind: 'int', required: false });
    expect(settings.fields.date).toEqual({ kind: 'date', required: false });
    // a unit is one of the six, and a category scope is one of the two trees
    expect(batchAdd.fields.unit).toEqual({ kind: 'choice', required: false, options: UNIT_LIST });
    expect(category.fields.scope).toEqual({ kind: 'choice', required: true, options: CATEGORY_SCOPES });

    // the fields of a form are exactly the keys of the payload that it writes
    expectTypeOf<FieldKeys<'settings'>>().toEqualTypeOf<keyof CommandPayloads['SetSimulatedToday']>();
    expectTypeOf<FieldKeys<'batchAdd'>>().toEqualTypeOf<keyof CommandPayloads['InboundBatch']>();
    expectTypeOf<FieldKeys<'batchQty'>>().toEqualTypeOf<keyof CommandPayloads['EditBatchQuantity']>();
    expectTypeOf<FieldKeys<'foodType'>>().toEqualTypeOf<keyof CommandPayloads['SaveFoodType']>();
    expectTypeOf<FieldKeys<'unitChange'>>().toEqualTypeOf<keyof CommandPayloads['ChangeFoodTypeUnit']>();
    expectTypeOf<FieldKeys<'category'>>().toEqualTypeOf<keyof CommandPayloads['SaveCategory']>();
    expectTypeOf<FieldKeys<'threshold'>>().toEqualTypeOf<keyof CommandPayloads['SetCategoryThreshold']>();
    expectTypeOf<FieldKeys<'recipe'>>().toEqualTypeOf<keyof CommandPayloads['SaveRecipe']>();
    // the confirmation reads a target: the id of the record, and for a category the tree it is in
    expect(FORM_SCHEMAS.target.fields).toEqual({
      id: { kind: 'id', required: true },
      scope: { kind: 'choice', required: false, options: CATEGORY_SCOPES },
    });
    expectTypeOf<FieldKeys<'target'>>().toEqualTypeOf<'id' | 'scope'>();
    expectTypeOf<(typeof FORM_SCHEMAS)['target']['commands'][number]>().toEqualTypeOf<
      'DeleteCategory' | 'DeleteFoodType' | 'RemoveBatch' | 'DeleteRecipe'
    >();
    expectTypeOf<FormErrorCode>().toEqualTypeOf<
      'FIELD_REQUIRED' | 'QTY_FORMAT' | 'QTY_DECIMALS' | 'INT_FORMAT' | 'DATE_FORMAT' | 'CHOICE_UNKNOWN'
    >();
  });

  it('draws with six kinds of node in 16 slots, using only the style tokens', () => {
    const wholeClassNames = (classes: string): boolean => classes.split(' ').every((name) => /^[a-z0-9:/.[\]-]+$/.test(name));

    expect(NODE_KINDS).toHaveLength(6);
    expectTypeOf<NodeKind>().toEqualTypeOf<RenderTree['kind']>();
    expect(SLOT_IDS).toHaveLength(16);
    expect(new Set(SLOT_IDS).size).toBe(16);

    expect(Object.keys(TONE_CLASS).sort()).toEqual([...TONES].sort());
    expect(Object.keys(LAYOUT_CLASS).sort()).toEqual([...LAYOUTS].sort());
    expect(Object.keys(CONTROL_CLASS).sort()).toEqual([...CONTROLS].sort());
    expect(Object.keys(FIELD_CLASS).sort()).toEqual([...FIELD_PARTS].sort());
    expect(Object.keys(ICON_CLASS).sort()).toEqual([...ICONS].sort());
    const tables = [TONE_CLASS, LAYOUT_CLASS, CONTROL_CLASS, FIELD_CLASS, ICON_CLASS];
    for (const classes of tables.flatMap((table) => Object.values(table))) {
      expect(wholeClassNames(classes)).toBe(true);
    }

    // a frame with a node of each kind
    const frame: RenderTree = {
      kind: 'box',
      layout: 'tabs',
      children: [
        { kind: 'button', label: 'Inventory', tone: 'current', icon: 'fridge', event: { ns: 'shell', name: 'navigate', payload: { tab: 'inventory', detail: null } } },
        { kind: 'text', text: 'Today 2026-10-01', tone: 'muted', icon: 'calendar' },
        { kind: 'input', label: 'Quantity', value: '1.5', event: { ns: 'batch', name: 'edit', payload: { field: 'quantity' } } },
        { kind: 'select', label: 'Unit', value: 'ml', choices: [{ value: 'ml', label: 'ml' }], event: { ns: 'batch', name: 'edit', payload: { field: 'unit' } } },
        { kind: 'slot', slot: 'inventoryList', shown: true },
      ],
    };
    expect(frame.kind).toBe('box');
    // @ts-expect-error a slot that is not one of the 16
    const _sidebar: RenderTree = { kind: 'slot', slot: 'sidebar', shown: true };
    void _sidebar;
  });

  it('describes the state and the actions of the six slices, and the services of a coordinator', async () => {
    expect(TABS).toEqual(['inventory', 'warnings', 'recommendations', 'catalog', 'categories']);
    expect(RESOURCE_VALUES).toEqual(['idle', 'loading', 'ready', 'failed']);
    expect(FORM_MODES).toEqual(['closed', 'editing', 'confirming', 'submitting']);
    expect(INTENT_KINDS).toHaveLength(5);
    expectTypeOf<(typeof INTENT_KINDS)[number]>().toEqualTypeOf<Intent['kind']>();

    expectTypeOf<ResourceState<number>>().toEqualTypeOf<{
      readonly value: ResourceValue;
      readonly context: { readonly data: number | null; readonly error: DomainError | null };
    }>();
    expectTypeOf<FormState['value']>().toEqualTypeOf<'closed' | 'editing' | 'confirming' | 'submitting'>();
    expectTypeOf<ResourceAction<string>['type']>().toEqualTypeOf<ResourceValue>();
    expectTypeOf<FormAction['type']>().toEqualTypeOf<
      'open' | 'edit' | 'refill' | 'addRow' | 'removeRow' | 'close' | 'submitting' | 'rejected' | 'closed'
    >();
    expectTypeOf<NavAction['type']>().toEqualTypeOf<'go'>();
    expectTypeOf<NoticeAction['type']>().toEqualTypeOf<'push' | 'dismiss'>();
    expectTypeOf<CatalogViewAction['type']>().toEqualTypeOf<'cuisine' | 'highlight'>();
    expectTypeOf<QueueAction['type']>().toEqualTypeOf<'add' | 'remove' | 'move' | 'prune' | 'clear'>();

    // one complete example of every state and every action: the compiler checks each field
    const nav: NavState = { tab: 'inventory', detail: 5 };
    const resource: ResourceState<number> = { value: 'ready', context: { data: 3, error: null } };
    const form: FormState = {
      value: 'editing',
      context: {
        kind: 'batchAdd',
        values: { quantity: '1.5', 'expiry.mode': 'days', 'expiry.days': '5' },
        options: { unit: [{ value: 'ml', label: 'ml' }] },
        hints: {},
        returnTo: 'editing',
      },
    };
    const notices: NoticeState = {
      items: [{ id: 1, notice: { severity: 'error', text: 'Remove all 3 batches first.', fieldHints: {} } }],
      nextId: 2,
    };
    const catalogView: CatalogViewState = { cuisineId: null, highlightId: 12 };
    const queue: QueueState = {
      entries: [
        { recipeId: 12, recipeName: 'Chicken Fried Rice' },
        { recipeId: 12, recipeName: 'Chicken Fried Rice' },
      ],
    };
    const prefill = { values: {}, options: {} };
    const formActions: FormAction[] = [
      { type: 'open', kind: 'batchAdd', prefill, at: 'editing' },
      { type: 'edit', field: 'quantity', value: '1.5' },
      { type: 'refill', prefill },
      { type: 'addRow', group: 'draft.rows', fields: ['foodTypeId', 'quantity', 'unit'] },
      { type: 'removeRow', group: 'draft.rows', index: 0 },
      { type: 'close' },
      { type: 'submitting' },
      { type: 'rejected', hints: { quantity: 'Use at most 3 decimals' } },
      { type: 'closed' },
    ];
    const queueActions: QueueAction[] = [
      { type: 'add', recipeId: 12, recipeName: 'Chicken Fried Rice' },
      { type: 'remove', index: 0 },
      { type: 'move', index: 1, direction: 'up' },
      { type: 'prune', recipeId: 12 },
      { type: 'clear' },
    ];
    const intents: Intent[] = [
      { kind: 'navigate', tab: 'inventory', detail: null },
      { kind: 'notify', notice: { severity: 'info', text: 'Saved', fieldHints: {} } },
      { kind: 'dataChanged' },
      { kind: 'openInCook', recipeId: 12 },
      { kind: 'recipeDeleted', recipeId: 12 },
    ];
    expect([nav.tab, resource.value, form.value, notices.nextId, catalogView.highlightId, queue.entries.length]).toEqual([
      'inventory',
      'ready',
      'editing',
      2,
      12,
      2,
    ]);
    expect(formActions).toHaveLength(9);
    expect(queueActions).toHaveLength(5);
    expect(intents.map((intent) => intent.kind)).toEqual([...INTENT_KINDS]);

    // a confirmation names the form that its buttons send their events to
    const confirm: ConfirmModel = {
      ns: 'foodTypeDelete',
      title: 'Delete Chicken?',
      lines: ['These recipes will become blocked: Chicken Fried Rice'],
      confirmLabel: 'Delete',
    };
    expect(UI_EVENTS[confirm.ns]).toContain('submit');

    // callApi answers with the data that its message promises
    const ctx: Ctx = {
      callApi: async () => ({ ok: false, err: { code: 'NETWORK_ERROR' } }),
      mount: () => undefined,
      reference: () => null,
    };
    const message: Envelope = { type: 'GetCatalog', params: { cuisineId: null } };
    const reply = await ctx.callApi({ type: 'GetCatalog', params: { cuisineId: null } });
    expectTypeOf(reply).toEqualTypeOf<Result<CatalogDto, DomainError>>();
    expect(reply).toEqual({ ok: false, err: { code: 'NETWORK_ERROR' } });
    expect(message.type).toBe('GetCatalog');
    expect(ctx.reference()).toBeNull();
  });
});
