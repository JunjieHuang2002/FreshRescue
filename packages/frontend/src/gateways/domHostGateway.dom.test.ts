import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONTROL_CLASS, FIELD_CLASS, ICON_CLASS, LAYOUT_CLASS, SLOT_IDS, TONE_CLASS } from '@freshrescue/contract-ui';
import type { RenderTree, SlotId, UiEvent } from '@freshrescue/contract-ui';
import { createDomHostGateway, SLOT_ATTRIBUTE } from './domHostGateway';

const slots: HTMLElement[] = [];

/** Puts empty slot elements into the page, as AppHost renders them. */
function addSlots(ids: readonly SlotId[] = SLOT_IDS): void {
  for (const id of ids) {
    const element = document.createElement('div');
    element.setAttribute(SLOT_ATTRIBUTE, id);
    document.body.append(element);
    slots.push(element);
  }
}

const slot = (id: SlotId): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-slot="${id}"]`);
  if (element === null) expect.unreachable(`no slot ${id}`);
  return element;
};

beforeEach(() => addSlots());
afterEach(() => {
  slots.splice(0).forEach((element) => element.remove());
});

const FORM: RenderTree = {
  kind: 'box',
  layout: 'modal',
  children: [
    { kind: 'text', text: 'Add batch', tone: 'title' },
    { kind: 'text', text: 'Unit: grams' },
    {
      kind: 'select',
      label: 'Food Type',
      value: '22',
      choices: [
        { value: '', label: 'New Food Type' },
        { value: '22', label: 'Chicken' },
      ],
      event: { ns: 'batch', name: 'pickFoodType', payload: {} },
    },
    { kind: 'input', label: 'Quantity', value: '1.5', event: { ns: 'batch', name: 'edit', payload: { field: 'quantity' } }, hint: 'Enter a number.' },
    { kind: 'input', label: 'Expiration date', value: '', inputType: 'date', event: { ns: 'batch', name: 'edit', payload: { field: 'expiry.date' } } },
    {
      kind: 'box',
      layout: 'row',
      children: [
        { kind: 'button', label: 'Save', event: { ns: 'batch', name: 'submit', payload: {} } },
        { kind: 'button', label: 'Cancel', event: { ns: 'batch', name: 'cancel', payload: {} }, disabled: true },
      ],
    },
  ],
};

/** Every class string of the tokens. An element takes one, or joins several whole ones: a button with its tone and its icon. */
const TOKENS: readonly string[] = [TONE_CLASS, LAYOUT_CLASS, CONTROL_CLASS, FIELD_CLASS, ICON_CLASS].flatMap((table) => Object.values(table));

const fromTokens = (value: string): boolean =>
  value === '' || TOKENS.some((token) => (value === token || value.startsWith(`${token} `)) && fromTokens(value.slice(token.length).trimStart()));

describe('domHostGateway: painting', () => {
  it('paints a tree into its slot: a box is a div, a text a span, a button a button, a field a label around its control', () => {
    expect(createDomHostGateway().mount('batchForm', FORM)).toEqual({ ok: true, value: {} });
    const root = slot('batchForm').firstElementChild;
    expect(root?.tagName).toBe('DIV');
    expect(root?.className).toBe(LAYOUT_CLASS.modal);
    expect([...(root?.children ?? [])].map((child) => child.tagName)).toEqual(['SPAN', 'SPAN', 'LABEL', 'LABEL', 'LABEL', 'DIV']);

    const [title, unit] = slot('batchForm').querySelectorAll('span');
    expect([title?.textContent, title?.className, unit?.textContent, unit?.hasAttribute('class')]).toEqual(['Add batch', TONE_CLASS.title, 'Unit: grams', false]);

    const select = slot('batchForm').querySelector('select');
    expect([...(select?.options ?? [])].map((option) => [option.value, option.textContent])).toEqual([
      ['', 'New Food Type'],
      ['22', 'Chicken'],
    ]);
    expect(select?.value).toBe('22');

    const [quantity, date] = slot('batchForm').querySelectorAll('input');
    expect([quantity?.type, quantity?.value, date?.type, date?.value]).toEqual(['text', '1.5', 'date', '']);
    const quantityLabel = quantity?.closest('label');
    expect([...(quantityLabel?.children ?? [])].map((part) => part.textContent)).toEqual(['Quantity', '', 'Enter a number.']);

    const [save, cancel] = slot('batchForm').querySelectorAll('button');
    expect([save?.textContent, save?.type, save?.disabled, cancel?.textContent, cancel?.disabled]).toEqual(['Save', 'button', false, 'Cancel', true]);
  });

  it('takes every class from the style tokens of the ui contract', () => {
    const gateway = createDomHostGateway();
    gateway.mount('batchForm', FORM);
    gateway.mount('catalog', {
      kind: 'box',
      layout: 'stack',
      children: [
        { kind: 'box', layout: 'card', tone: 'chosen', children: [{ kind: 'text', text: 'Chicken Fried Rice', tone: 'title', icon: 'sparkle' }] },
        { kind: 'button', label: 'All', tone: 'selected', event: { ns: 'catalog', name: 'setCuisineFilter', payload: { cuisineId: null } } },
        { kind: 'button', label: 'Edit', tone: 'quiet', icon: 'pencil', event: { ns: 'recipe', name: 'editRecipe', payload: { recipe: {} as never } } },
      ],
    });
    const classes = [...document.querySelectorAll('[class]')].map((element) => element.getAttribute('class') ?? '');
    expect(classes.length).toBeGreaterThan(10);
    expect(classes.filter((value) => !fromTokens(value))).toEqual([]);
  });

  it('paints a box with a tone as a frame in that tone around the box, and a button with a tone with the classes of its tone beside its own', () => {
    createDomHostGateway().mount('catalog', {
      kind: 'box',
      layout: 'stack',
      children: [
        { kind: 'box', layout: 'card', tone: 'blocked', children: [{ kind: 'text', text: 'Tomato Egg Stir-Fry' }] },
        { kind: 'button', label: 'Delete', tone: 'danger', event: { ns: 'recipeDelete', name: 'deleteRecipe', payload: { recipe: {} as never } } },
      ],
    });
    const [frame, button] = slot('catalog').firstElementChild?.children ?? [];
    expect(frame?.className).toBe(TONE_CLASS.blocked);
    expect(frame?.firstElementChild?.className).toBe(LAYOUT_CLASS.card);
    expect(frame?.firstElementChild?.textContent).toBe('Tomato Egg Stir-Fry');
    expect(button?.className).toBe(`${CONTROL_CLASS.button} ${TONE_CLASS.danger}`);
    expect([button?.children.length, button?.textContent]).toEqual([0, 'Delete']);
  });

  it('gives a text and a button the classes of their icon, paints the parts of a field with the field classes, and marks a field with a hint invalid', () => {
    const gateway = createDomHostGateway();
    gateway.mount('catalog', {
      kind: 'box',
      layout: 'stack',
      children: [
        { kind: 'text', text: 'Full matches', tone: 'title', icon: 'sparkle' },
        { kind: 'text', text: 'Other', icon: 'lock' },
        { kind: 'button', label: 'Edit', tone: 'quiet', icon: 'pencil', event: { ns: 'recipe', name: 'editRecipe', payload: { recipe: {} as never } } },
        { kind: 'button', label: 'Add batch', icon: 'plus', event: { ns: 'inventory', name: 'addBatch', payload: { foodTypeId: null } } },
      ],
    });
    const [title, other] = slot('catalog').querySelectorAll('span');
    const [edit, add] = slot('catalog').querySelectorAll('button');
    expect([title?.className, other?.className]).toEqual([`${TONE_CLASS.title} ${ICON_CLASS.sparkle}`, ICON_CLASS.lock]);
    expect([edit?.className, add?.className]).toEqual([
      `${CONTROL_CLASS.button} ${TONE_CLASS.quiet} ${ICON_CLASS.pencil}`,
      `${CONTROL_CLASS.button} ${ICON_CLASS.plus}`,
    ]);

    gateway.mount('batchForm', FORM);
    const [quantity, date] = slot('batchForm').querySelectorAll('input');
    const label = quantity?.closest('label');
    expect([label?.className, label?.children[0]?.className, label?.children[2]?.className]).toEqual([FIELD_CLASS.label, FIELD_CLASS.caption, FIELD_CLASS.hint]);
    expect([quantity?.getAttribute('aria-invalid'), date?.hasAttribute('aria-invalid')]).toEqual(['true', false]);

    const fixed = FORM.kind === 'box' ? FORM.children.map((child) => (child.kind === 'input' && child.label === 'Quantity' ? { ...child, hint: undefined } : child)) : [];
    gateway.mount('batchForm', { kind: 'box', layout: 'modal', children: fixed });
    expect(quantity?.hasAttribute('aria-invalid')).toBe(false);
  });

  it('shows and hides the slots that slot nodes name, and paints nothing where a slot node stands', () => {
    const gateway = createDomHostGateway();
    gateway.mount('shell', {
      kind: 'box',
      layout: 'stack',
      children: [
        { kind: 'text', text: 'FreshRescue' },
        { kind: 'slot', slot: 'inventoryList', shown: true },
        { kind: 'slot', slot: 'warnings', shown: false },
      ],
    });
    expect(slot('shell').firstElementChild?.children).toHaveLength(1);
    expect([slot('inventoryList').hidden, slot('warnings').hidden]).toEqual([false, true]);

    gateway.mount('shell', { kind: 'box', layout: 'stack', children: [{ kind: 'slot', slot: 'warnings', shown: true }, { kind: 'slot', slot: 'inventoryList', shown: false }] });
    expect([slot('inventoryList').hidden, slot('warnings').hidden]).toEqual([true, false]);
  });

  it('returns SLOT_NOT_FOUND for a slot that the page does not have, and paints nothing', () => {
    slot('confirm').remove();
    expect(createDomHostGateway().mount('confirm', { kind: 'text', text: 'Delete Beef?' })).toEqual({
      ok: false,
      err: { code: 'SLOT_NOT_FOUND', detail: 'the page has no slot "confirm"' },
    });
    expect(document.body.textContent).not.toContain('Delete Beef?');
  });

  it('returns SLOT_NOT_FOUND for every slot node whose slot is missing, and still paints the rest', () => {
    slot('warnings').remove();
    slot('catalog').remove();
    const painted = createDomHostGateway().mount('shell', {
      kind: 'box',
      layout: 'stack',
      children: [
        { kind: 'text', text: 'FreshRescue' },
        { kind: 'slot', slot: 'warnings', shown: false },
        { kind: 'slot', slot: 'inventoryList', shown: false },
        { kind: 'slot', slot: 'catalog', shown: true },
      ],
    });
    expect(painted).toEqual({ ok: false, err: { code: 'SLOT_NOT_FOUND', detail: 'the page has no slot "warnings", "catalog"' } });
    expect(slot('shell').textContent).toBe('FreshRescue');
    expect(slot('inventoryList').hidden).toBe(true);
  });

  it('changes a repainted tree in place, so the field that is being typed into keeps its focus and its caret', () => {
    const gateway = createDomHostGateway();
    gateway.mount('batchForm', FORM);
    const quantity = slot('batchForm').querySelectorAll('input')[0];
    if (quantity === undefined) expect.unreachable('a quantity field');
    quantity.focus();
    quantity.value = '1.25';
    quantity.setSelectionRange(2, 2);

    const typed: RenderTree = {
      ...FORM,
      kind: 'box',
      layout: 'modal',
      children: FORM.kind === 'box' ? FORM.children.map((child) => (child.kind === 'input' && child.label === 'Quantity' ? { ...child, value: '1.25', hint: 'Too many decimals.' } : child)) : [],
    };
    gateway.mount('batchForm', typed);

    expect(slot('batchForm').querySelectorAll('input')[0]).toBe(quantity);
    expect(document.activeElement).toBe(quantity);
    expect([quantity.value, quantity.selectionStart]).toEqual(['1.25', 2]);
    expect(quantity.closest('label')?.lastElementChild?.textContent).toBe('Too many decimals.');
  });

  it('replaces a node that became another kind, removes what is left over, and drops a hint that went away', () => {
    const gateway = createDomHostGateway();
    gateway.mount('batchForm', FORM);
    const before = [...(slot('batchForm').firstElementChild?.children ?? [])];
    gateway.mount('batchForm', {
      kind: 'box',
      layout: 'modal',
      children: [
        { kind: 'text', text: 'Edit quantity', tone: 'title' },
        { kind: 'button', label: 'Back', event: { ns: 'shell', name: 'navigate', payload: { tab: 'inventory', detail: null } } },
        { kind: 'text', text: 'Only the quantity' },
        { kind: 'input', label: 'Quantity', value: '2', event: { ns: 'batch', name: 'edit', payload: { field: 'quantity' } } },
      ],
    });
    const after = [...(slot('batchForm').firstElementChild?.children ?? [])];
    expect(after.map((child) => child.tagName)).toEqual(['SPAN', 'BUTTON', 'SPAN', 'LABEL']);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[3]).toBe(before[3]);
    expect(after[3]?.textContent).toBe('Quantity');
    expect(after[3]?.lastElementChild instanceof HTMLElement && after[3].lastElementChild.hidden).toBe(true);
  });

  it('disables an input, a select and a button with their tree, and enables them again with it', () => {
    const gateway = createDomHostGateway();
    const form = (disabled: boolean): RenderTree => ({
      kind: 'box',
      layout: 'stack',
      children: [
        { kind: 'input', label: 'Quantity', value: '1', event: { ns: 'batch', name: 'edit', payload: { field: 'quantity' } }, disabled },
        { kind: 'select', label: 'Unit', value: 'kg', choices: [{ value: 'kg', label: 'kg' }], event: { ns: 'batch', name: 'edit', payload: { field: 'unit' } }, disabled },
        { kind: 'button', label: 'Save', event: { ns: 'batch', name: 'submit', payload: {} }, disabled },
      ],
    });
    const controls = (): (boolean | undefined)[] => [
      slot('batchForm').querySelector('input')?.disabled,
      slot('batchForm').querySelector('select')?.disabled,
      slot('batchForm').querySelector('button')?.disabled,
    ];
    gateway.mount('batchForm', form(true));
    expect(controls()).toEqual([true, true, true]);
    gateway.mount('batchForm', form(false));
    expect(controls()).toEqual([false, false, false]);
  });

  it('changes the entries of a select when they change, and chooses the value of the tree', () => {
    const gateway = createDomHostGateway();
    const select = (value: string, labels: readonly string[]): RenderTree => ({
      kind: 'select',
      label: 'Unit',
      value,
      choices: labels.map((label) => ({ value: label, label })),
      event: { ns: 'batch', name: 'edit', payload: { field: 'unit' } },
    });
    gateway.mount('batchForm', select('kg', ['grams', 'kg']));
    const control = slot('batchForm').querySelector('select');
    gateway.mount('batchForm', select('pieces', ['grams', 'kg', 'pieces']));
    expect(slot('batchForm').querySelector('select')).toBe(control);
    expect([...(control?.options ?? [])].map((option) => option.value)).toEqual(['grams', 'kg', 'pieces']);
    expect(control?.value).toBe('pieces');
  });

  it('paints into the page that it is given, and touches no page when it is created', () => {
    const other = document.implementation.createHTMLDocument('another page');
    const target = other.createElement('div');
    target.setAttribute(SLOT_ATTRIBUTE, 'notices');
    other.body.append(target);
    expect(createDomHostGateway(other).mount('notices', { kind: 'text', text: 'Saved.' }).ok).toBe(true);
    expect(target.textContent).toBe('Saved.');
    expect(slot('notices').textContent).toBe('');

    let touched = false;
    const watched = new Proxy({}, { get: () => ((touched = true), undefined) }) as unknown as Document;
    createDomHostGateway(watched);
    expect(touched).toBe(false);
  });
});

describe('domHostGateway: events', () => {
  let detach: () => void = () => {};
  afterEach(() => detach());

  function listening(): UiEvent[] {
    const events: UiEvent[] = [];
    const gateway = createDomHostGateway();
    gateway.mount('batchForm', FORM);
    detach = gateway.onEvent((event) => events.push(event));
    return events;
  }

  it('relays a click on a painted button as the event that the button carries', () => {
    const events = listening();
    slot('batchForm').querySelectorAll('button')[0]?.click();
    expect(events).toEqual([{ ns: 'batch', name: 'submit', payload: {} }]);
  });

  it('relays nothing for a disabled button, for a click beside the buttons, or for a button that it did not paint', () => {
    const events = listening();
    const disabled = slot('batchForm').querySelectorAll('button')[1];
    disabled?.click();
    disabled?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    slot('batchForm').querySelector('span')?.click();
    const stranger = document.createElement('button');
    slot('notices').append(stranger);
    stranger.click();
    expect(events).toEqual([]);
  });

  it('relays a click on a button with a tone and an icon as the event of the button', () => {
    const events: UiEvent[] = [];
    const gateway = createDomHostGateway();
    gateway.mount('confirm', { kind: 'button', label: 'Delete Food Type', tone: 'danger', icon: 'trash', event: { ns: 'foodTypeDelete', name: 'submit', payload: {} } });
    detach = gateway.onEvent((event) => events.push(event));
    slot('confirm').querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(events).toEqual([{ ns: 'foodTypeDelete', name: 'submit', payload: {} }]);
  });

  it('relays typing with the text of the field added as `value`', () => {
    const events = listening();
    const quantity = slot('batchForm').querySelectorAll('input')[0];
    if (quantity === undefined) expect.unreachable('a quantity field');
    quantity.value = '2.5';
    quantity.dispatchEvent(new Event('input', { bubbles: true }));
    expect(events).toEqual([{ ns: 'batch', name: 'edit', payload: { field: 'quantity', value: '2.5' } }]);
  });

  it('relays a choice once, from `change`, with the chosen value added as `value`', () => {
    const events = listening();
    const select = slot('batchForm').querySelector('select');
    if (select === null) expect.unreachable('a select');
    select.value = '';
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(events).toEqual([{ ns: 'batch', name: 'pickFoodType', payload: { value: '' } }]);
  });

  it('relays the event of the latest paint, and nothing once it is detached', () => {
    const events: UiEvent[] = [];
    const gateway = createDomHostGateway();
    const button = (index: number): RenderTree => ({ kind: 'button', label: 'Remove', event: { ns: 'cook', name: 'remove', payload: { index } } });
    gateway.mount('cookQueue', button(0));
    gateway.mount('cookQueue', button(3));
    detach = gateway.onEvent((event) => events.push(event));
    slot('cookQueue').querySelector('button')?.click();
    detach();
    slot('cookQueue').querySelector('button')?.click();
    expect(events).toEqual([{ ns: 'cook', name: 'remove', payload: { index: 3 } }]);
  });
});
