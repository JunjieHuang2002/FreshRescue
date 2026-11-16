import {
  CONTROL_CLASS,
  ICONS,
  ICON_CLASS,
  LAYOUTS,
  LAYOUT_CLASS,
  NODE_KINDS,
  SLOT_IDS,
  TONES,
  TONE_CLASS,
  UI_EVENTS,
  UI_NAMESPACES,
} from '@freshrescue/contract-ui';
import type { ButtonNode, RenderTree, UiEventDescriptor } from '@freshrescue/contract-ui';

// Helpers for the tests of the puppet views: they read a `RenderTree` the way a person reads the
// page. This is not a module and production code never imports it.

/** Every node of the tree, depth first, the root included. */
export function nodesOf(tree: RenderTree): RenderTree[] {
  return tree.kind === 'box' ? [tree, ...tree.children.flatMap(nodesOf)] : [tree];
}

/** The event of every button, input and select of the tree, in the order of the page. */
export function eventsOf(tree: RenderTree): UiEventDescriptor[] {
  return nodesOf(tree).flatMap((node) => (node.kind === 'button' || node.kind === 'input' || node.kind === 'select' ? [node.event] : []));
}

/** The field that each `edit` event of the tree is for, in the order of the page: what each input and select of a form edits. */
export function editedFieldsOf(tree: RenderTree): string[] {
  return eventsOf(tree).flatMap((event) => (event.name === 'edit' ? [event.payload.field] : []));
}

/** The button with this label, or undefined. */
export function findButton(tree: RenderTree, label: string): ButtonNode | undefined {
  return nodesOf(tree).find((node): node is ButtonNode => node.kind === 'button' && node.label === label);
}

const tone = (name: string | undefined): string => (name === undefined ? '' : ` (${name})`);
const flags = (...names: (string | false | undefined)[]): string => names.filter((name) => typeof name === 'string').map((name) => ` ${name}`).join('');
const where = (event: UiEventDescriptor): string => ` -> ${event.ns}/${event.name}`;

/**
 * The tree as indented text, one node to a line, so that a test can read what a view shows:
 *
 *     box stack
 *       text: Inventory (title)
 *       button: Add batch -> inventory/addBatch
 *       input Quantity: 1.5 [hint] -> batch/edit
 *       select Unit: ml of grams, kg, ml -> batch/edit
 *       slot catalog shown
 */
export function renderText(tree: RenderTree, depth = 0): string {
  const pad = '  '.repeat(depth);
  switch (tree.kind) {
    case 'box':
      return [`${pad}box ${tree.layout}${tone(tree.tone)}`, ...tree.children.map((child) => renderText(child, depth + 1))].join('\n');
    case 'text':
      return `${pad}text: ${tree.text}${tone(tree.tone)}`;
    case 'button':
      return `${pad}button: ${tree.label}${tone(tree.tone)}${flags(tree.disabled && 'disabled')}${where(tree.event)}`;
    case 'input':
      return `${pad}input ${tree.label}: ${tree.value}${flags(tree.inputType === 'date' && 'date', tree.disabled && 'disabled')}${
        tree.hint === undefined ? '' : ` [${tree.hint}]`
      }${where(tree.event)}`;
    case 'select':
      return `${pad}select ${tree.label}: ${tree.value} of ${tree.choices.map((choice) => choice.label).join(', ')}${flags(tree.disabled && 'disabled')}${
        tree.hint === undefined ? '' : ` [${tree.hint}]`
      }${where(tree.event)}`;
    case 'slot':
      return `${pad}slot ${tree.slot} ${tree.shown ? 'shown' : 'hidden'}`;
  }
}

/**
 * What is wrong with the tree, as a list of sentences; an empty list means that it is fit to paint:
 * every node is one of the six kinds, every slot is one of the 16 slot ids, every tone, layout and icon
 * has a class in the tokens of the `ui` contract, every event is one that its namespace has in the
 * catalog, every button has a label, and the value of a select is one of its choices.
 */
export function problemsOf(tree: RenderTree): string[] {
  const problems: string[] = [];
  for (const node of nodesOf(tree)) {
    const kind: string = node.kind;
    if (!(NODE_KINDS as readonly string[]).includes(kind)) {
      problems.push(`${kind} is not a kind of node`);
      continue;
    }
    if (node.kind === 'box') {
      if (!(LAYOUTS as readonly string[]).includes(node.layout) || !LAYOUT_CLASS[node.layout]) problems.push(`layout ${node.layout} has no class`);
    }
    if ('tone' in node && node.tone !== undefined && (!(TONES as readonly string[]).includes(node.tone) || !TONE_CLASS[node.tone])) {
      problems.push(`tone ${node.tone} has no class`);
    }
    if ((node.kind === 'text' || node.kind === 'button') && node.icon !== undefined && (!(ICONS as readonly string[]).includes(node.icon) || !ICON_CLASS[node.icon])) {
      problems.push(`icon ${node.icon} has no class`);
    }
    if (node.kind === 'slot' && !(SLOT_IDS as readonly string[]).includes(node.slot)) problems.push(`${node.slot} is not one of the 16 slots`);
    if (node.kind === 'button' && node.label.trim() === '') problems.push('a button has no label');
    if (node.kind === 'select' && !node.choices.some((choice) => choice.value === node.value)) {
      problems.push(`select ${node.label} holds ${JSON.stringify(node.value)}, which is not one of its choices`);
    }
    if (node.kind === 'button' || node.kind === 'input' || node.kind === 'select') {
      const { ns, name } = node.event;
      if (!(UI_NAMESPACES as readonly string[]).includes(ns)) problems.push(`${ns} is not a namespace`);
      else if (!(UI_EVENTS[ns] as readonly string[]).includes(name)) problems.push(`${ns}/${name} is not an event of ${ns}`);
      if (!CONTROL_CLASS[node.kind]) problems.push(`${node.kind} has no control class`);
    }
  }
  return problems;
}
