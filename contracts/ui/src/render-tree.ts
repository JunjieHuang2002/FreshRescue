import type { UiEventDescriptor } from './events';
import type { Icon, Layout, Tone } from './tokens';

/**
 * The 16 slots of the page, one for each puppet view. The four confirmation dialogs share the
 * `confirm` slot, because only one is open at a time. The page (AppHost) renders all 16 empty
 * slot elements, and the DOM host paints a tree into one of them.
 */
export const SLOT_IDS = [
  'shell',
  'notices',
  'demo',
  'inventoryList',
  'foodTypeDetail',
  'warnings',
  'recommendations',
  'catalog',
  'categories',
  'cookQueue',
  'cookReport',
  'batchForm',
  'foodTypeForm',
  'unitConversion',
  'recipeForm',
  'confirm',
] as const;

export type SlotId = (typeof SLOT_IDS)[number];

/** The six kinds of node. A view returns a tree of these and never touches the DOM. */
export const NODE_KINDS = ['box', 'text', 'button', 'input', 'select', 'slot'] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

/** A container that arranges its children. */
export type BoxNode = {
  readonly kind: 'box';
  readonly layout: Layout;
  readonly tone?: Tone;
  readonly children: readonly RenderTree[];
};

/** Plain text, or a heading, a chip, a badge or a note when it has a tone. */
export type TextNode = {
  readonly kind: 'text';
  readonly text: string;
  readonly tone?: Tone;
  /** An icon beside the text. */
  readonly icon?: Icon;
};

/** A button. Clicking it relays `event` to AppCoordinator. */
export type ButtonNode = {
  readonly kind: 'button';
  readonly label: string;
  readonly event: UiEventDescriptor;
  readonly tone?: Tone;
  /** An icon beside the label. A button inside `tools` shows its icon only, and keeps the label for a screen reader. */
  readonly icon?: Icon;
  readonly disabled?: boolean;
};

/** A text field. Typing relays `event` with the new text added to its payload as `value`. */
export type InputNode = {
  readonly kind: 'input';
  readonly label: string;
  readonly value: string;
  readonly event: UiEventDescriptor;
  readonly inputType?: 'text' | 'date';
  /** A message about the value, shown beside the field. */
  readonly hint?: string;
  readonly disabled?: boolean;
};

/** One choice of a select. */
export type Choice = {
  readonly value: string;
  readonly label: string;
};

/** A drop-down. Choosing relays `event` with the chosen value added to its payload as `value`. */
export type SelectNode = {
  readonly kind: 'select';
  readonly label: string;
  readonly value: string;
  readonly choices: readonly Choice[];
  readonly event: UiEventDescriptor;
  readonly hint?: string;
  readonly disabled?: boolean;
};

/**
 * A directive for one of the 16 slots: it says whether the slot's own content is visible. The
 * shell frame draws one for each content slot so that a tab shows its content and hides the
 * others. The DOM host shows or hides the slot element and never creates it.
 */
export type SlotNode = {
  readonly kind: 'slot';
  readonly slot: SlotId;
  readonly shown: boolean;
};

export type RenderTree = BoxNode | TextNode | ButtonNode | InputNode | SelectNode | SlotNode;
