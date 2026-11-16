import type { DomainError } from '@freshrescue/contract-errors';
import type { Empty, Result } from '@freshrescue/contract-primitives';
import { CONTROL_CLASS, FIELD_CLASS, ICON_CLASS, LAYOUT_CLASS, TONE_CLASS } from '@freshrescue/contract-ui';
import type {
  BoxNode,
  ButtonNode,
  Choice,
  InputNode,
  RenderTree,
  SelectNode,
  SlotId,
  SlotNode,
  TextNode,
  UiEvent,
  UiEventDescriptor,
} from '@freshrescue/contract-ui';

/** The attribute that names the slot of a page element. AppHost renders `<div data-slot="inventoryList">` and so on, one for each of the 16 slots. */
export const SLOT_ATTRIBUTE = 'data-slot';

/** What AppCoordinator needs of the page (blueprint 1.7, FG-03). */
export type DomHostPort = {
  /** Paints a tree into its slot, and shows or hides the slots that the slot nodes of the tree name. */
  mount(slot: SlotId, tree: RenderTree): Result<Empty, DomainError>;
  /** Hands every click on a painted button, and every text typed or chosen in a painted control, to `handler` as a `UiEvent`. The function it returns detaches the listeners. */
  onEvent(handler: (event: UiEvent) => void): () => void;
};

type Paintable = Exclude<RenderTree, SlotNode>;

/** A painted input or select: the label around it, the caption above it and the hint below it. */
type Field<C> = {
  readonly label: HTMLLabelElement;
  readonly caption: HTMLSpanElement;
  readonly control: C;
  readonly hint: HTMLSpanElement;
};

/** What an element was painted as, with the parts that a repaint changes in place. */
type Painted =
  | { readonly kind: 'box'; readonly framed: boolean; readonly inner: HTMLDivElement }
  | { readonly kind: 'text' }
  | { readonly kind: 'button' }
  | ({ readonly kind: 'input' } & Field<HTMLInputElement>)
  | ({ readonly kind: 'select'; readonly choices: readonly Choice[] } & Field<HTMLSelectElement>);

type Host = {
  /** The page. It is looked up when it is used, never when the gateway is created. */
  readonly doc: () => Document;
  readonly painted: WeakMap<Element, Painted>;
  /** The event of every painted button, input and select. */
  readonly events: WeakMap<Element, UiEventDescriptor>;
};

const DONE: Result<Empty, DomainError> = { ok: true, value: {} };

const missing = (slots: readonly SlotId[]): Result<Empty, DomainError> => ({
  ok: false,
  err: { code: 'SLOT_NOT_FOUND', detail: `the page has no slot ${slots.map((slot) => `"${slot}"`).join(', ')}` },
});

const slotOf = (doc: Document, slot: SlotId): HTMLElement | null => doc.querySelector<HTMLElement>(`[${SLOT_ATTRIBUTE}="${slot}"]`);

function setClass(element: Element, value: string): void {
  if (value === '') element.removeAttribute('class');
  else if (element.getAttribute('class') !== value) element.setAttribute('class', value);
}

function setText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

/** The class attribute of an element: the classes of its kind, of its tone and of its icon. Each comes whole from the tokens. */
const classesOf = (...parts: readonly (string | undefined)[]): string => parts.filter((part) => part !== undefined && part !== '').join(' ');

/** A field with a hint is marked invalid, for a screen reader and for the style of its control. */
function setHint(hint: HTMLSpanElement, control: HTMLInputElement | HTMLSelectElement, text: string | undefined): void {
  setText(hint, text ?? '');
  hint.hidden = text === undefined;
  if (text === undefined) control.removeAttribute('aria-invalid');
  else if (control.getAttribute('aria-invalid') !== 'true') control.setAttribute('aria-invalid', 'true');
}

// ---- painting -------------------------------------------------------------------------------

function paintBox(host: Host, current: Element | null, before: Painted | undefined, tree: BoxNode): Element {
  // A box with a tone is a frame in the colours of the tone around the box, so the classes of the tone
  // and of the layout never set the same property of one element.
  const framed = tree.tone !== undefined;
  let element: Element;
  let inner: HTMLDivElement;
  if (current !== null && before?.kind === 'box' && before.framed === framed) {
    element = current;
    inner = before.inner;
  } else {
    inner = host.doc().createElement('div');
    element = inner;
    if (framed) {
      element = host.doc().createElement('div');
      element.append(inner);
    }
    host.painted.set(element, { kind: 'box', framed, inner });
  }
  if (tree.tone !== undefined) setClass(element, TONE_CLASS[tree.tone]);
  setClass(inner, LAYOUT_CLASS[tree.layout]);
  paintChildren(host, inner, tree.children);
  return element;
}

function paintText(host: Host, current: Element | null, before: Painted | undefined, tree: TextNode): Element {
  const span = current !== null && before?.kind === 'text' ? current : host.doc().createElement('span');
  setClass(span, classesOf(tree.tone && TONE_CLASS[tree.tone], tree.icon && ICON_CLASS[tree.icon]));
  setText(span, tree.text);
  host.painted.set(span, { kind: 'text' });
  return span;
}

// A button with a tone carries the classes of its tone beside those of a button. The tokens are written so
// that the two never set the same property: a tone sets the colours, the button and its contexts the size.
function paintButton(host: Host, current: Element | null, before: Painted | undefined, tree: ButtonNode): Element {
  const button = current instanceof HTMLButtonElement && before?.kind === 'button' ? current : host.doc().createElement('button');
  button.type = 'button';
  setClass(button, classesOf(CONTROL_CLASS.button, tree.tone && TONE_CLASS[tree.tone], tree.icon && ICON_CLASS[tree.icon]));
  setText(button, tree.label);
  button.disabled = tree.disabled === true;
  host.events.set(button, tree.event);
  host.painted.set(button, { kind: 'button' });
  return button;
}

function fieldOf<C extends HTMLInputElement | HTMLSelectElement>(doc: Document, control: C, controlClass: string): Field<C> {
  const label = doc.createElement('label');
  const caption = doc.createElement('span');
  const hint = doc.createElement('span');
  label.className = FIELD_CLASS.label;
  caption.className = FIELD_CLASS.caption;
  control.className = controlClass;
  hint.className = FIELD_CLASS.hint;
  label.append(caption, control, hint);
  return { label, caption, control, hint };
}

// The control of a field is changed in place and never replaced, so the field that the person is typing
// into keeps its focus and its caret when the form is painted again after each keystroke.
function paintInput(host: Host, before: Painted | undefined, tree: InputNode): Element {
  const field = before?.kind === 'input' ? before : fieldOf(host.doc(), host.doc().createElement('input'), CONTROL_CLASS.input);
  const { control } = field;
  setText(field.caption, tree.label);
  const type = tree.inputType ?? 'text';
  if (control.type !== type) control.type = type;
  if (control.value !== tree.value) control.value = tree.value;
  control.disabled = tree.disabled === true;
  setHint(field.hint, control, tree.hint);
  host.events.set(control, tree.event);
  host.painted.set(field.label, { kind: 'input', label: field.label, caption: field.caption, control, hint: field.hint });
  return field.label;
}

const sameChoices = (left: readonly Choice[], right: readonly Choice[]): boolean =>
  left.length === right.length && left.every((choice, index) => choice.value === right[index]?.value && choice.label === right[index]?.label);

function paintSelect(host: Host, before: Painted | undefined, tree: SelectNode): Element {
  const doc = host.doc();
  const field = before?.kind === 'select' ? before : { ...fieldOf(doc, doc.createElement('select'), CONTROL_CLASS.select), choices: [] };
  const { control } = field;
  setText(field.caption, tree.label);
  if (!sameChoices(field.choices, tree.choices)) {
    control.replaceChildren(
      ...tree.choices.map((choice) => {
        const option = doc.createElement('option');
        option.value = choice.value;
        option.textContent = choice.label;
        return option;
      }),
    );
  }
  if (control.value !== tree.value) control.value = tree.value;
  control.disabled = tree.disabled === true;
  setHint(field.hint, control, tree.hint);
  host.events.set(control, tree.event);
  host.painted.set(field.label, { kind: 'select', label: field.label, caption: field.caption, control, hint: field.hint, choices: tree.choices });
  return field.label;
}

function paint(host: Host, current: Element | null, tree: Paintable): Element {
  const before = current === null ? undefined : host.painted.get(current);
  switch (tree.kind) {
    case 'box':
      return paintBox(host, current, before, tree);
    case 'text':
      return paintText(host, current, before, tree);
    case 'button':
      return paintButton(host, current, before, tree);
    case 'input':
      return paintInput(host, before, tree);
    case 'select':
      return paintSelect(host, before, tree);
  }
}

/**
 * Makes the children of `parent` match `trees`, position by position: an element that was painted as
 * the same kind of node is changed in place, any other is replaced, and what is left over is removed.
 * A slot node paints nothing where it stands: it is a directive for a slot element of the page.
 */
function paintChildren(host: Host, parent: Element, trees: readonly RenderTree[]): void {
  const shown = trees.filter((tree): tree is Paintable => tree.kind !== 'slot');
  shown.forEach((tree, index) => {
    const current = parent.children.item(index);
    const element = paint(host, current, tree);
    if (current === null) parent.append(element);
    else if (element !== current) current.replaceWith(element);
  });
  while (parent.children.length > shown.length) parent.lastElementChild?.remove();
}

const directivesOf = (tree: RenderTree): SlotNode[] =>
  tree.kind === 'slot' ? [tree] : tree.kind === 'box' ? tree.children.flatMap(directivesOf) : [];

function mount(host: Host, slot: SlotId, tree: RenderTree): Result<Empty, DomainError> {
  const doc = host.doc();
  const element = slotOf(doc, slot);
  if (element === null) return missing([slot]);
  paintChildren(host, element, [tree]);
  const lost: SlotId[] = [];
  for (const directive of directivesOf(tree)) {
    const target = slotOf(doc, directive.slot);
    if (target === null) lost.push(directive.slot);
    else target.hidden = !directive.shown;
  }
  return lost.length === 0 ? DONE : missing(lost);
}

// ---- events ---------------------------------------------------------------------------------

/** The event of a node as AppCoordinator receives it: an input or a select adds the text that was typed or chosen as `value`. */
function relay(descriptor: UiEventDescriptor, value?: string): UiEvent {
  return (value === undefined ? descriptor : { ...descriptor, payload: { ...descriptor.payload, value } }) as UiEvent;
}

function listen(host: Host, handler: (event: UiEvent) => void): () => void {
  const doc = host.doc();
  const clicked = (event: Event): void => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    const descriptor = button === null || button.disabled ? undefined : host.events.get(button);
    if (descriptor !== undefined) handler(relay(descriptor));
  };
  // A select fires `input` too, but it is relayed from `change` only, so that a choice counts once.
  const typed = (event: Event): void => {
    const field = event.target;
    const descriptor = field instanceof HTMLInputElement ? host.events.get(field) : undefined;
    if (field instanceof HTMLInputElement && descriptor !== undefined) handler(relay(descriptor, field.value));
  };
  const chosen = (event: Event): void => {
    const field = event.target;
    const descriptor = field instanceof HTMLSelectElement ? host.events.get(field) : undefined;
    if (field instanceof HTMLSelectElement && descriptor !== undefined) handler(relay(descriptor, field.value));
  };
  doc.addEventListener('click', clicked);
  doc.addEventListener('input', typed);
  doc.addEventListener('change', chosen);
  return () => {
    doc.removeEventListener('click', clicked);
    doc.removeEventListener('input', typed);
    doc.removeEventListener('change', chosen);
  };
}

/**
 * FG-03 DomHostGateway. Binds `RenderTree`s to the slots of the page and relays what the person does as
 * `UiEvent`s (blueprint 1.7, 1.8).
 *
 * - `mount` finds the slot element by its `data-slot` attribute and paints the tree into it. A box is a
 *   `div`, a text a `span`, a button a `button`, an input and a select a `label` that holds the caption,
 *   the control and the hint. Every class comes from the style tokens of the `ui` contract: a box takes
 *   its layout (a box with a tone sits in a frame of that tone), a text its tone and its icon, a button
 *   the button class with its tone and its icon, a field the field classes, and a control with a hint is
 *   marked `aria-invalid`. A repaint changes the elements in place, so a field keeps its focus while the
 *   person types. A slot node shows or hides the slot element it
 *   names and never creates one. A slot that the page does not have is SLOT_NOT_FOUND; the rest of the
 *   tree is still painted.
 * - `onEvent` listens on the page for clicks on painted buttons (a disabled one relays nothing), for
 *   typing in painted inputs and for choices in painted selects, and hands each to the handler with the
 *   event that its node carries, plus the text as `value` for an input or a select.
 *
 * Nothing is touched when the gateway is created, so it can be imported and created where there is no
 * page. `root` is the page to use; it is the document of the browser unless a test passes another.
 */
export function createDomHostGateway(root?: Document): DomHostPort {
  const host: Host = { doc: () => root ?? document, painted: new WeakMap(), events: new WeakMap() };
  return {
    mount: (slot, tree) => mount(host, slot, tree),
    onEvent: (handler) => listen(host, handler),
  };
}
