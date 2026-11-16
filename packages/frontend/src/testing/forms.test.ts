import { describe, expect, it } from 'vitest';
import { FORM_KINDS, FORM_SCHEMAS } from '@freshrescue/contract-ui';
import type {
  FormEntry,
  FormKind,
  FormPrefill,
  FormState,
  NavState,
  QueueState,
  RenderTree,
  UiEvent,
  UiEventDescriptor,
  UiEventName,
  UiNamespace,
  UiPayloads,
} from '@freshrescue/contract-ui';
import { formPrefillBuilder } from '../modules/computation/formPrefillBuilder';
import { formSchemaParser } from '../modules/parsing/formSchemaParser';
import { catalogViewSlice } from '../modules/slices/catalogViewSlice';
import { cookQueueSlice } from '../modules/slices/cookQueueSlice';
import { formSlice } from '../modules/slices/formSlice';
import { navigationSlice } from '../modules/slices/navigationSlice';
import { noticeSlice } from '../modules/slices/noticeSlice';
import { appShellView } from '../modules/views/appShellView';
import { batchFormView } from '../modules/views/batchFormView';
import { categoryManagerView } from '../modules/views/categoryManagerView';
import { confirmDialogView } from '../modules/views/confirmDialogView';
import { cookQueueView } from '../modules/views/cookQueueView';
import { demoControlView } from '../modules/views/demoControlView';
import { foodTypeDetailView } from '../modules/views/foodTypeDetailView';
import { foodTypeFormView } from '../modules/views/foodTypeFormView';
import { inventoryListView } from '../modules/views/inventoryListView';
import { noticeBarView } from '../modules/views/noticeBarView';
import { recipeCatalogView } from '../modules/views/recipeCatalogView';
import { recipeFormView } from '../modules/views/recipeFormView';
import { unitConversionModalView } from '../modules/views/unitConversionModalView';
import { CATALOG, CLOSED_FORM, DETAIL, INVENTORY, REFERENCE, TOMATO_EGG, readyOf } from './fixtures';
import { editedFieldsOf, eventsOf, findButton, nodesOf, problemsOf, renderText } from './render';

// Each module is tested alone, and none of them can see another. This test puts them together the
// way the coordinators of phase 9 will: a button of a view is clicked, its event opens a form with
// FormPrefillBuilder and FormSlice, the view of that form draws it, the person types into it, and
// FormSchemaParser reads it. It fails when a view, the prefill builder, the slice or the parser
// disagree, which no test of one module can see.
//
// The events carry the records that the forms are about, so the compiler checks the pairing of an
// event, a kind of form and its data: `opening` below is the table that a coordinator follows, and it
// compiles only because each event's payload is what FormPrefillBuilder asks for.

type Node = RenderTree;
type Payload<N extends UiNamespace, E extends string> = E extends keyof UiPayloads[N] ? UiPayloads[N][E] : never;

/** What the DOM host does: a button relays its event, and an input or a select adds the text that was typed or chosen as `value`. */
function relay(descriptor: UiEventDescriptor, value?: string): UiEvent {
  return (value === undefined ? descriptor : { ...descriptor, payload: { ...descriptor.payload, value } }) as UiEvent;
}

function eventOf(node: Node | undefined): UiEventDescriptor {
  if (node === undefined || (node.kind !== 'button' && node.kind !== 'input' && node.kind !== 'select')) expect.unreachable('a node that carries an event');
  return node.event;
}

const click = (node: Node | undefined): UiEvent => relay(eventOf(node));
const typeInto = (node: Node | undefined, value: string): UiEvent => relay(eventOf(node), value);

/** The payload of an event that is known by its namespace and name: the test fails if it is another event. */
function payloadOf<N extends UiNamespace, E extends UiEventName<N>>(event: UiEvent | UiEventDescriptor, ns: N, name: E): Payload<N, E> {
  expect([event.ns, event.name]).toEqual([ns, name]);
  return event.payload as Payload<N, E>;
}

const control = (tree: Node, label: string): Node | undefined => nodesOf(tree).find((node) => (node.kind === 'input' || node.kind === 'select') && node.label === label);

type Opening = { readonly kind: FormKind; readonly prefill: FormPrefill; readonly at: FormEntry };

/** What a coordinator does with an event that opens a form (blueprint 4.3, OPEN): the kind of form, and its prefill from the payload of the event. */
function opening(event: UiEvent): Opening | undefined {
  if (event.ns === 'settings' && event.name === 'open') return { kind: 'settingsForm', prefill: formPrefillBuilder('settingsForm', event.payload, REFERENCE), at: 'editing' };
  if (event.ns === 'inventory' && event.name === 'addBatch') return { kind: 'batchAdd', prefill: formPrefillBuilder('batchAdd', event.payload, REFERENCE), at: 'editing' };
  if (event.ns === 'batch' && event.name === 'pickFoodType') return { kind: 'batchAdd', prefill: formPrefillBuilder('batchAdd', event.payload, REFERENCE), at: 'editing' };
  if (event.ns === 'inventory' && event.name === 'editBatchQuantity') return { kind: 'batchQty', prefill: formPrefillBuilder('batchQty', event.payload, REFERENCE), at: 'editing' };
  if (event.ns === 'inventory' && event.name === 'removeBatch') return { kind: 'batchRemove', prefill: formPrefillBuilder('batchRemove', event.payload, REFERENCE), at: 'confirming' };
  if (event.ns === 'foodType' && event.name === 'newFoodType') return { kind: 'foodTypeCreate', prefill: formPrefillBuilder('foodTypeCreate', event.payload, REFERENCE), at: 'editing' };
  if (event.ns === 'foodType' && event.name === 'editFoodType') return { kind: 'foodTypeEdit', prefill: formPrefillBuilder('foodTypeEdit', event.payload, REFERENCE), at: 'editing' };
  if (event.ns === 'unitConversion' && event.name === 'changeUnit') return { kind: 'unitChange', prefill: formPrefillBuilder('unitChange', event.payload, REFERENCE), at: 'editing' };
  if (event.ns === 'foodTypeDelete' && event.name === 'deleteFoodType') return { kind: 'foodTypeDelete', prefill: formPrefillBuilder('foodTypeDelete', event.payload, REFERENCE), at: 'confirming' };
  if (event.ns === 'category' && event.name === 'newCategory') return { kind: 'categoryCreate', prefill: formPrefillBuilder('categoryCreate', event.payload, REFERENCE), at: 'editing' };
  if (event.ns === 'category' && event.name === 'renameCategory') return { kind: 'categoryRename', prefill: formPrefillBuilder('categoryRename', event.payload, REFERENCE), at: 'editing' };
  if (event.ns === 'threshold' && event.name === 'setThreshold') return { kind: 'thresholdSet', prefill: formPrefillBuilder('thresholdSet', event.payload, REFERENCE), at: 'editing' };
  if (event.ns === 'categoryDelete' && event.name === 'deleteCategory') return { kind: 'categoryDelete', prefill: formPrefillBuilder('categoryDelete', event.payload, REFERENCE), at: 'confirming' };
  if (event.ns === 'recipe' && event.name === 'newRecipe') return { kind: 'recipeCreate', prefill: formPrefillBuilder('recipeCreate', event.payload, REFERENCE), at: 'editing' };
  if (event.ns === 'recipe' && event.name === 'editRecipe') return { kind: 'recipeEdit', prefill: formPrefillBuilder('recipeEdit', event.payload, REFERENCE), at: 'editing' };
  if (event.ns === 'recipeDelete' && event.name === 'deleteRecipe') return { kind: 'recipeDelete', prefill: formPrefillBuilder('recipeDelete', event.payload, REFERENCE), at: 'confirming' };
  return undefined;
}

/** A form that is open, from the event that opens it: what a coordinator does in OPEN. */
function open(event: UiEvent): FormState {
  const opened = opening(event);
  if (opened === undefined) expect.unreachable(`${event.ns}/${event.name} does not open a form`);
  return formSlice(CLOSED_FORM, { type: 'open', ...opened });
}

/** What a coordinator does for an `edit` event: the slice learns the new text. */
function edit(form: FormState, event: UiEvent): FormState {
  if (event.name !== 'edit') expect.unreachable(`${event.ns}/${event.name} is not an edit`);
  return formSlice(form, { type: 'edit', field: event.payload.field, value: event.payload.value });
}

/** What a coordinator does for a pick event: the form is refilled from the choice. */
function pick(form: FormState, event: UiEvent): FormState {
  const opened = opening(event);
  if (opened === undefined) expect.unreachable('a pick event');
  return formSlice(form, { type: 'refill', prefill: opened.prefill });
}

const detail = foodTypeDetailView(readyOf(DETAIL));
const list = inventoryListView(readyOf(INVENTORY));
const catalog = recipeCatalogView(readyOf(CATALOG), { cuisineId: null, highlightId: null }, REFERENCE);
const categories = categoryManagerView(CLOSED_FORM, CLOSED_FORM, REFERENCE);
const demo = demoControlView(CLOSED_FORM, REFERENCE);

/** For each kind of form: the view that draws it, the button that opens it, the schema that reads it, and what is still to be filled in. */
const CASES: readonly {
  readonly kind: FormKind;
  readonly ns: UiNamespace;
  readonly opener: () => Node | undefined;
  readonly draw: (form: FormState) => Node;
  readonly schema: keyof typeof FORM_SCHEMAS;
  readonly confirming?: true;
  readonly unfilled: readonly string[];
}[] = [
  { kind: 'settingsForm', ns: 'settings', opener: () => findButton(demo, 'Set Simulated Today'), draw: (form) => demoControlView(form, REFERENCE), schema: 'settings', unfilled: [] },
  { kind: 'batchAdd', ns: 'batch', opener: () => findButton(list, 'Add batch'), draw: batchFormView, schema: 'batchAdd', unfilled: ['quantity', 'expiry.days'] },
  { kind: 'batchAdd', ns: 'batch', opener: () => findButton(detail, 'Add batch'), draw: batchFormView, schema: 'batchAdd', unfilled: ['quantity', 'expiry.days'] },
  { kind: 'batchQty', ns: 'batch', opener: () => findButton(detail, 'Edit quantity'), draw: batchFormView, schema: 'batchQty', unfilled: [] },
  { kind: 'batchRemove', ns: 'batchRemove', opener: () => findButton(detail, 'Remove batch'), draw: confirmDialogView, schema: 'target', confirming: true, unfilled: [] },
  { kind: 'foodTypeCreate', ns: 'foodType', opener: () => findButton(list, 'Add Food Type'), draw: foodTypeFormView, schema: 'foodType', unfilled: ['name'] },
  { kind: 'foodTypeEdit', ns: 'foodType', opener: () => findButton(detail, 'Edit Food Type'), draw: foodTypeFormView, schema: 'foodType', unfilled: [] },
  {
    kind: 'unitChange',
    ns: 'unitConversion',
    opener: () => findButton(detail, 'Change unit'),
    draw: unitConversionModalView,
    schema: 'unitChange',
    unfilled: ['unit', 'batches.0.quantity', 'batches.1.quantity', 'batches.2.quantity'],
  },
  { kind: 'foodTypeDelete', ns: 'foodTypeDelete', opener: () => findButton(detail, 'Delete Food Type'), draw: confirmDialogView, schema: 'target', confirming: true, unfilled: [] },
  { kind: 'categoryCreate', ns: 'category', opener: () => findButton(categories, 'Add food category'), draw: (form) => categoryManagerView(form, CLOSED_FORM, REFERENCE), schema: 'category', unfilled: ['name'] },
  { kind: 'categoryCreate', ns: 'category', opener: () => findButton(categories, 'Add child'), draw: (form) => categoryManagerView(form, CLOSED_FORM, REFERENCE), schema: 'category', unfilled: ['name'] },
  { kind: 'categoryCreate', ns: 'category', opener: () => findButton(categories, 'Add cuisine'), draw: (form) => categoryManagerView(form, CLOSED_FORM, REFERENCE), schema: 'category', unfilled: ['name'] },
  { kind: 'categoryRename', ns: 'category', opener: () => findButton(categories, 'Rename'), draw: (form) => categoryManagerView(form, CLOSED_FORM, REFERENCE), schema: 'category', unfilled: [] },
  { kind: 'thresholdSet', ns: 'threshold', opener: () => findButton(categories, 'Set threshold'), draw: (form) => categoryManagerView(CLOSED_FORM, form, REFERENCE), schema: 'threshold', unfilled: [] },
  { kind: 'categoryDelete', ns: 'categoryDelete', opener: () => findButton(categories, 'Delete'), draw: confirmDialogView, schema: 'target', confirming: true, unfilled: [] },
  { kind: 'recipeCreate', ns: 'recipe', opener: () => findButton(catalog, 'New recipe'), draw: recipeFormView, schema: 'recipe', unfilled: ['name', 'draft.rows.0.foodTypeId', 'draft.rows.0.quantity', 'draft.rows.0.unit'] },
  { kind: 'recipeEdit', ns: 'recipe', opener: () => findButton(catalog, 'Edit'), draw: recipeFormView, schema: 'recipe', unfilled: [] },
  { kind: 'recipeDelete', ns: 'recipeDelete', opener: () => findButton(catalog, 'Delete'), draw: confirmDialogView, schema: 'target', confirming: true, unfilled: [] },
];

describe('the views, FormPrefillBuilder, FormSlice and FormSchemaParser agree', () => {
  it('covers all 15 kinds of form', () => {
    expect([...new Set(CASES.map((one) => one.kind))].sort()).toEqual([...FORM_KINDS].sort());
  });

  for (const one of CASES) {
    describe(`${one.kind}, opened by "${(one.opener() as { label?: string } | undefined)?.label ?? '?'}"`, () => {
      const event = click(one.opener());
      const form = open(event);

      it('is opened by an event of the namespace that owns the form, and opens the form that it is for', () => {
        expect(opening(event)?.kind).toBe(one.kind);
        expect(form.value).toBe(one.confirming ? 'confirming' : 'editing');
        expect(form.context.kind).toBe(one.kind);
        expect(form.context.returnTo).toBe(one.confirming ? 'confirming' : 'editing');
      });

      it('carries the record that the form is about, whole, and not keys made from it', () => {
        expect(Object.keys(event.payload).every((key) => !/\.\d+\./.test(key))).toBe(true);
        for (const value of Object.values(event.payload)) expect(['string', 'number', 'object', 'undefined']).toContain(typeof value);
      });

      it('is drawn by its view as a tree that is fit to paint', () => {
        const tree = one.draw(form);

        expect(problemsOf(tree)).toEqual([]);
        expect(nodesOf(tree).length).toBeGreaterThan(3);
      });

      it('lets the person edit only fields that the form has, in the namespace of the form', () => {
        const tree = one.draw(form);

        for (const field of editedFieldsOf(tree)) expect(Object.keys(form.context.values), field).toContain(field);
        for (const each of eventsOf(tree).filter((candidate) => candidate.name === 'edit')) expect(each.ns).toBe(one.ns);
        if (!one.confirming && one.unfilled.length > 0) expect(editedFieldsOf(tree).length).toBeGreaterThan(0);
      });

      it('is read by FormSchemaParser, with nothing missing but what the person still has to fill in', () => {
        const parsed = formSchemaParser(FORM_SCHEMAS[one.schema] as never, form.context.values) as { ok: boolean; err?: readonly { field: string; code: string }[] };

        expect(parsed.ok ? [] : parsed.err?.map((error) => error.field)).toEqual(one.unfilled);
        for (const error of parsed.err ?? []) expect(error.code).toBe('FIELD_REQUIRED');
      });
    });
  }

  describe('a confirmation', () => {
    it('is read as the id of the record, and its dialog says what the confirm button does', () => {
      const removeBatch = open(click(findButton(detail, 'Remove batch')));
      const dialog = confirmDialogView(removeBatch);

      // the first batch of the detail is the Expired batch A of spec 4.5
      expect(formSchemaParser(FORM_SCHEMAS.target, removeBatch.context.values)).toEqual({ ok: true, value: { id: 31, scope: null } });
      expect(renderText(dialog)).toContain('text: Remove this batch? (title)');
      expect(renderText(dialog)).toContain('text: 100 grams of Beef — expired 1 day ago');
      expect(findButton(dialog, 'Remove batch')).toMatchObject({ tone: 'danger', event: { ns: 'batchRemove', name: 'submit' } });
      expect(eventsOf(dialog).map((each) => `${each.ns}/${each.name}`)).toEqual(['batchRemove/submit', 'batchRemove/cancel']);
    });

    it('lists the recipes that a deleted Food Type would block', () => {
      const form = open(click(findButton(detail, 'Delete Food Type')));

      expect(renderText(confirmDialogView(form))).toContain('text: These recipes will become blocked: Beef and Broccoli Stir-Fry.');
    });

    it('is disabled while its request is on the way, and enabled again when the request is rejected', () => {
      const form = open(click(findButton(detail, 'Delete Food Type')));
      const sending = formSlice(form, { type: 'submitting' });
      const rejected = formSlice(sending, { type: 'rejected', hints: {} });

      expect(findButton(confirmDialogView(sending), 'Delete Food Type')).toMatchObject({ disabled: true });
      expect(rejected.value).toBe('confirming');
      expect(findButton(confirmDialogView(rejected), 'Delete Food Type')).toMatchObject({ disabled: false });
      expect(confirmDialogView(formSlice(rejected, { type: 'close' }))).toEqual({ kind: 'box', layout: 'stack', children: [] });
    });

    it('keeps the tree of a category, so that the deletion is read in the right one', () => {
      const cuisine = nodesOf(categories).find((node) => node.kind === 'button' && node.event.name === 'deleteCategory' && node.event.payload.scope === 'cuisine');
      const form = open(click(cuisine));

      expect(formSchemaParser(FORM_SCHEMAS.target, form.context.values)).toEqual({ ok: true, value: { id: 10, scope: 'cuisine' } });
    });
  });

  describe('adding a batch, from the first click to the payload (spec 4.2.5)', () => {
    const opened = open(click(findButton(list, 'Add batch')));

    it('sends the id and no name when a Food Type is picked, and the name and no id when a name is typed', () => {
      // pick Chicken
      let form = opened;
      form = pick(form, typeInto(control(batchFormView(form), 'Food Type'), '22'));
      form = edit(form, typeInto(control(batchFormView(form), 'Quantity'), '2.5'));
      form = edit(form, typeInto(control(batchFormView(form), 'Shelf life in days'), '3'));

      expect(formSchemaParser(FORM_SCHEMAS.batchAdd, form.context.values)).toEqual({
        ok: true,
        value: { foodTypeId: 22, foodName: null, categoryId: 5, unit: 'grams', quantity: 2500, expiry: { days: 3 } },
      });

      // type a new name
      form = opened;
      form = edit(form, typeInto(control(batchFormView(form), 'New Food Type name'), 'Kale'));
      form = edit(form, typeInto(control(batchFormView(form), 'Category'), '9'));
      form = edit(form, typeInto(control(batchFormView(form), 'Unit'), 'grams'));
      form = edit(form, typeInto(control(batchFormView(form), 'Quantity'), '1'));
      form = edit(form, typeInto(control(batchFormView(form), 'Shelf life in days'), '2'));

      expect(formSchemaParser(FORM_SCHEMAS.batchAdd, form.context.values)).toEqual({
        ok: true,
        value: { foodTypeId: null, foodName: 'Kale', categoryId: 9, unit: 'grams', quantity: 1000, expiry: { days: 2 } },
      });
    });

    it('sends two nulls when the name is left blank, which the backend answers with NAME_EMPTY (exception 3)', () => {
      let form = opened;
      form = edit(form, typeInto(control(batchFormView(form), 'Unit'), 'grams'));
      form = edit(form, typeInto(control(batchFormView(form), 'Quantity'), '1'));
      form = edit(form, typeInto(control(batchFormView(form), 'Shelf life in days'), '2'));

      expect(formSchemaParser(FORM_SCHEMAS.batchAdd, form.context.values)).toMatchObject({ ok: true, value: { foodTypeId: null, foodName: null } });
    });

    it('keeps the quantity that was typed when a Food Type is picked afterwards, and clears the name that was typed', () => {
      let form = opened;
      form = edit(form, typeInto(control(batchFormView(form), 'New Food Type name'), 'Kale'));
      form = edit(form, typeInto(control(batchFormView(form), 'Quantity'), '4'));
      form = pick(form, typeInto(control(batchFormView(form), 'Food Type'), '24'));

      expect(form.context.values).toMatchObject({ foodTypeId: '24', foodName: '', quantity: '4', unit: 'ml', categoryId: '7' });
      expect(renderText(batchFormView(form))).toContain('text: Unit: ml');
      expect(control(batchFormView(form), 'New Food Type name')).toBeUndefined();
    });

    it('sends the pick as the value that the DOM host adds, with nothing else in the event of the select', () => {
      const select = control(batchFormView(opened), 'Food Type');

      expect(eventOf(select)).toEqual({ ns: 'batch', name: 'pickFoodType', payload: {} });
      expect(payloadOf(typeInto(select, '22'), 'batch', 'pickFoodType')).toEqual({ value: '22' });
    });

    it('goes back to a new Food Type when the pick is cleared', () => {
      let form = open(click(findButton(detail, 'Add batch')));
      form = pick(form, typeInto(control(batchFormView(form), 'Food Type'), ''));

      expect(form.context.values).toMatchObject({ foodTypeId: '', foodName: '', unit: '', categoryId: '1' });
      expect(control(batchFormView(form), 'New Food Type name')).toBeDefined();
    });

    it('sends a date when the expiry is given as a date', () => {
      let form = opened;
      form = edit(form, typeInto(control(batchFormView(form), 'Expiry given as'), 'date'));
      form = edit(form, typeInto(control(batchFormView(form), 'Expiration date'), '2026-10-06'));
      form = edit(form, typeInto(control(batchFormView(form), 'Quantity'), '1'));

      expect(formSchemaParser(FORM_SCHEMAS.batchAdd, form.context.values)).toMatchObject({ ok: true, value: { expiry: { date: '2026-10-06' } } });
    });
  });

  describe('changing a unit, with the example of spec 4.2.2', () => {
    it('sends the new unit and the new quantity of every batch, once every field is valid', () => {
      let form = open(click(findButton(detail, 'Change unit')));
      expect(findButton(unitConversionModalView(form), 'Save')).toMatchObject({ disabled: true });

      form = edit(form, typeInto(control(unitConversionModalView(form), 'New unit'), 'pieces'));
      for (const [index, quantity] of ['0.5', '1', '2'].entries()) {
        const field = nodesOf(unitConversionModalView(form)).filter((node) => node.kind === 'input')[index];
        form = edit(form, typeInto(field, quantity));
      }

      expect(findButton(unitConversionModalView(form), 'Save')).toMatchObject({ disabled: false });
      expect(formSchemaParser(FORM_SCHEMAS.unitChange, form.context.values)).toEqual({
        ok: true,
        value: {
          foodTypeId: 20,
          unit: 'pieces',
          batches: [
            { batchId: 31, quantity: 500 },
            { batchId: 32, quantity: 1000 },
            { batchId: 33, quantity: 2000 },
          ],
        },
      });
    });
  });

  describe('a recipe, with the rows that are added and removed', () => {
    it('defaults the unit of a row to the unit of the Food Type that is picked in it (spec section 3)', () => {
      let form = open(click(findButton(catalog, 'New recipe')));
      form = edit(form, typeInto(control(recipeFormView(form), 'Recipe name'), 'Chicken Soup'));
      form = edit(form, typeInto(control(recipeFormView(form), 'Food Type'), '22'));
      form = edit(form, typeInto(control(recipeFormView(form), 'Quantity'), '300'));

      expect(form.context.values['draft.rows.0.unit']).toBe('grams');
      expect(formSchemaParser(FORM_SCHEMAS.recipe, form.context.values)).toEqual({
        ok: true,
        value: { recipeId: null, name: 'Chicken Soup', draft: { cuisineId: 2, rows: [{ foodTypeId: 22, quantity: 300_000, unit: 'grams' }] } },
      });
    });

    it('adds a row from the button of the view, which names the fields of the row, and removes one from its button', () => {
      let form = open(click(findButton(catalog, 'Edit')));
      const add = payloadOf(click(findButton(recipeFormView(form), 'Add ingredient')), 'recipe', 'addRow');

      // the fields that the button names are the fields that the schema reads in a row
      expect([...add.fields]).toEqual(Object.keys(FORM_SCHEMAS.recipe.fields.draft.fields.rows.fields));
      form = formSlice(form, { type: 'addRow', group: add.group, fields: add.fields });

      expect(nodesOf(recipeFormView(form)).filter((node) => node.kind === 'select' && node.label === 'Food Type')).toHaveLength(3);
      expect(formSchemaParser(FORM_SCHEMAS.recipe, form.context.values)).toMatchObject({ ok: false });

      const remove = payloadOf(click(nodesOf(recipeFormView(form)).filter((node) => node.kind === 'button' && node.label === 'Remove')[2]), 'recipe', 'removeRow');
      form = formSlice(form, { type: 'removeRow', group: remove.group, index: remove.index });

      expect(formSchemaParser(FORM_SCHEMAS.recipe, form.context.values)).toMatchObject({ ok: true });
    });

    it('draws a recipe whose Food Type was deleted with that row empty, until another Food Type is picked (exception 7)', () => {
      const blocked = nodesOf(catalog).find((node) => node.kind === 'button' && node.label === 'Edit' && node.event.name === 'editRecipe' && node.event.payload.recipe === TOMATO_EGG);
      let form = open(click(blocked));

      expect(formSchemaParser(FORM_SCHEMAS.recipe, form.context.values)).toMatchObject({ ok: false, err: [{ field: 'draft.rows.0.foodTypeId', code: 'FIELD_REQUIRED' }] });
      form = edit(form, typeInto(nodesOf(recipeFormView(form)).find((node) => node.kind === 'select' && node.label === 'Food Type'), '27'));

      expect(formSchemaParser(FORM_SCHEMAS.recipe, form.context.values)).toMatchObject({ ok: true });
    });
  });

  describe('the buttons that are not forms', () => {
    it('go to a tab, and open a Food Type detail, with the payload that NavigationSlice reads', () => {
      let nav: NavState = { tab: 'inventory', detail: null };
      const opens = payloadOf(click(findButton(list, 'Beef')), 'inventory', 'openDetail');
      nav = navigationSlice(nav, { type: 'go', tab: 'inventory', detail: opens.foodTypeId });

      expect(nav).toEqual({ tab: 'inventory', detail: 20 });
      const back = payloadOf(click(findButton(detail, 'Back to inventory')), 'shell', 'navigate');
      nav = navigationSlice(nav, { type: 'go', ...back });

      expect(nav).toEqual({ tab: 'inventory', detail: null });
      const catalogTab = payloadOf(click(findButton(appShellView(nav, ''), 'Recipes')), 'shell', 'navigate');
      nav = navigationSlice(nav, { type: 'go', ...catalogTab });

      expect(nav.tab).toBe('catalog');
    });

    it('dismiss a notice by the id that the slice gave it', () => {
      let notices = noticeSlice({ items: [], nextId: 1 }, { type: 'push', notice: { severity: 'error', text: 'Cannot reach the server.', fieldHints: {} } });
      const dismiss = payloadOf(click(findButton(noticeBarView(notices.items), 'Dismiss')), 'shell', 'dismiss');
      notices = noticeSlice(notices, { type: 'dismiss', id: dismiss.noticeId });

      expect(notices.items).toEqual([]);
    });

    it('queue a recipe, move it and remove it, with the payloads that CookQueueSlice reads', () => {
      let queue: QueueState = { entries: [] };
      for (const name of ['Chicken Fried Rice', 'Spinach Omelette']) {
        const card = nodesOf(catalog).find((node) => node.kind === 'button' && node.event.name === 'add' && node.event.payload.recipeName === name);
        const add = payloadOf(click(card), 'cook', 'add');
        queue = cookQueueSlice(queue, { type: 'add', ...add });
      }

      expect(queue.entries.map((entry) => entry.recipeName)).toEqual(['Chicken Fried Rice', 'Spinach Omelette']);
      const down = payloadOf(click(nodesOf(cookQueueView(queue)).find((node) => node.kind === 'button' && node.label === 'Down')), 'cook', 'move');
      queue = cookQueueSlice(queue, { type: 'move', ...down });

      expect(queue.entries.map((entry) => entry.recipeName)).toEqual(['Spinach Omelette', 'Chicken Fried Rice']);
      const remove = payloadOf(click(findButton(cookQueueView(queue), 'Remove')), 'cook', 'remove');
      queue = cookQueueSlice(queue, { type: 'remove', index: remove.index });

      expect(queue.entries).toHaveLength(1);
    });

    it('filter the catalog by a cuisine, with the payload that CatalogViewSlice reads', () => {
      const french = payloadOf(click(findButton(catalog, 'French Cuisine')), 'catalog', 'setCuisineFilter');
      const view = catalogViewSlice({ cuisineId: null, highlightId: null }, { type: 'cuisine', cuisineId: french.cuisineId });

      expect(view.cuisineId).toBe(12);
    });

    it('open a recommended recipe in Cook, with the id of the recipe', () => {
      expect(payloadOf({ ns: 'recommendations', name: 'openInCook', payload: { recipeId: 41 } }, 'recommendations', 'openInCook')).toEqual({ recipeId: 41 });
    });
  });
});
