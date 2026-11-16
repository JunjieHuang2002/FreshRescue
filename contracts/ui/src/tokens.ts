// The style tokens: the only CSS classes a view may use, and the whole look of the app. A view names a
// tone, a layout or an icon, and the DOM host looks up its classes here, so no view invents a class and no
// stylesheet needs to know how a view builds its tree. Tailwind finds these classes by scanning this
// folder (the `@source` line in apps/web/src/app/globals.css), so each class is written out in full and
// never built from pieces. A few groups of whole classes are shared by several tokens and joined to them.
//
// Theme. The classes use Tailwind's utilities with the theme that apps/web/src/app/globals.css declares:
// the colours (surface, soft, sunken, line, ink, muted, brand, fresh, near, expired, info, danger, cook,
// glass), the shadows, the animations and the icon images. That file also defines the few utilities that
// Tailwind has no word for: `glyph`, `glyph-after`, `icon-*` and `glyph-tint-*` draw an icon, `grid-fill-*`
// fits as many columns as there is room for, `grid-fields` lays out a row of fields, `pb-safe-*` keeps clear
// of the home bar of a phone, `sheet-width` takes the width that the page gives a sheet, and `bg-logo`,
// `bg-alarm`, `select-chevron` and `scrollbar-hidden` do what they say.
//
// Context. Some tokens change inside a box of another layout, through the `in-[.ui-...]` variant, which
// matches an element anywhere inside that box: a button inside `tabs` is a tab, inside `tools` an icon.
// The `ui-...` classes are those hooks; they carry no style of their own. A box finds the status inside it
// with `has-[.ui-good]` and the like, so a tile or a batch takes the colour of its badge.
//
// Buttons. A button with a tone carries the classes of its tone beside the classes of a button, so the two
// never set the same property: a tone sets colours, borders and shadows only, and the button with its
// contexts sets the size. The look of a button without a tone applies through `not-[.toned]`, because
// every button tone has the class `toned`.

/**
 * The tones.
 *
 * - Text: plain; muted; title (of a card, a section or a form); heading (of a page); figure (a big
 *   quantity); brand (the name of the app); chip (a small fact); empty (nothing to show); the status
 *   badges good, warn, bad and info; and warnNote and badNote, a sentence about something to fix.
 * - Button: primary (the main action), soft, quiet, remove (takes one thing away), danger (confirms a
 *   deletion), cook (Cook & Deduct), link (opens what the whole tile shows), outline (adds a row), tab and
 *   current (the open tab), selected (the chosen filter).
 * - Box: blocked and chosen, the frames of a recipe that cannot be cooked and of the one opened from
 *   Recommendations.
 */
export const TONES = [
  'plain',
  'muted',
  'title',
  'heading',
  'figure',
  'brand',
  'chip',
  'empty',
  'good',
  'warn',
  'bad',
  'info',
  'warnNote',
  'badNote',
  'primary',
  'soft',
  'quiet',
  'remove',
  'danger',
  'cook',
  'link',
  'outline',
  'tab',
  'current',
  'selected',
  'blocked',
  'chosen',
] as const;

export type Tone = (typeof TONES)[number];

/** A status badge: a pill with a dot in the colour of its status. In a tile it goes first, in a banner it is the sentence of the notice. */
const BADGE =
  'inline-flex w-fit items-center gap-1.5 rounded-full py-[3px] pr-2.5 pl-2 text-xs leading-[1.35] font-bold tracking-[0.01em] whitespace-nowrap ' +
  'before:size-[7px] before:flex-none before:rounded-full ' +
  'in-[.ui-tile]:order-first in-[.ui-tile]:mb-2 ' +
  'in-[.ui-clock]:py-0.5 in-[.ui-clock]:pr-2 in-[.ui-clock]:pl-[7px] in-[.ui-clock]:text-[11px] ' +
  'in-[.ui-banner]:flex-1 in-[.ui-banner]:items-start in-[.ui-banner]:gap-2.5 in-[.ui-banner]:rounded-none in-[.ui-banner]:bg-transparent ' +
  'in-[.ui-banner]:p-0 in-[.ui-banner]:pt-[7px] in-[.ui-banner]:text-sm in-[.ui-banner]:leading-[1.45] in-[.ui-banner]:font-medium ' +
  'in-[.ui-banner]:tracking-normal in-[.ui-banner]:whitespace-normal in-[.ui-banner]:text-ink in-[.ui-banner]:before:mt-1.5 in-[.ui-banner]:before:size-2';

/** A sentence about something to fix, on a tint of its colour. */
const NOTE =
  'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[13.5px] leading-[1.45] font-medium ' +
  'before:mt-1.5 before:size-[7px] before:flex-none before:rounded-full ' +
  'in-[.ui-entry]:px-2.5 in-[.ui-entry]:py-2 in-[.ui-entry]:text-[13px]';

export const TONE_CLASS = {
  plain: 'leading-[1.45] text-ink-2 in-[.ui-ingredient]:mr-auto in-[.ui-ingredient]:text-ink in-[.ui-entry]:text-sm',
  muted:
    'text-[13.5px] leading-[1.45] text-muted ' +
    'in-[.ui-masthead]:sr-only ' +
    'in-[.ui-ingredient]:text-xs ' +
    'in-[.ui-entry]:text-[12.5px] ' +
    'in-[.ui-chips]:shrink-0 in-[.ui-chips]:text-[11.5px] in-[.ui-chips]:font-bold in-[.ui-chips]:tracking-[0.12em] in-[.ui-chips]:uppercase ' +
    'in-[.ui-list]:rounded-full in-[.ui-list]:bg-sunken in-[.ui-list]:px-[9px] in-[.ui-list]:py-0.5 in-[.ui-list]:text-xs ' +
    'in-[.ui-list]:font-semibold in-[.ui-list]:text-ink-2 ' +
    'in-[.ui-clock]:whitespace-nowrap in-[.ui-clock]:text-[12.5px] in-[.ui-clock]:font-semibold in-[.ui-clock]:text-ink-2 ' +
    'lg:in-[.ui-clock]:text-[15px] lg:in-[.ui-clock]:font-bold lg:in-[.ui-clock]:text-ink ' +
    'in-[.ui-tile]:text-[13px] in-[.ui-tile]:last:order-first in-[.ui-tile]:last:mb-2 in-[.ui-tile]:last:flex ' +
    'in-[.ui-tile]:last:min-h-[23px] in-[.ui-tile]:last:items-center',
  title:
    'text-[1.05rem] leading-[1.3] font-bold tracking-[-0.012em] text-ink not-first:mt-2 ' +
    'in-[.ui-header]:mr-auto in-[.ui-header]:font-display in-[.ui-header]:text-[1.2rem] in-[.ui-header]:font-extrabold ' +
    'in-[.ui-header]:tracking-[-0.02em] ' +
    'in-[.ui-sheet]:in-[.ui-header]:first:pr-6 in-[.ui-sheet]:in-[.ui-header]:first:text-[1.45rem] ' +
    'in-[.ui-sheet]:in-[.ui-header]:first:leading-[1.15] in-[.ui-sheet]:in-[.ui-header]:first:tracking-[-0.025em] ' +
    'in-[.ui-caption]:basis-full in-[.ui-caption]:font-display in-[.ui-caption]:text-[1.2rem] in-[.ui-caption]:leading-[1.2] ' +
    'in-[.ui-caption]:font-extrabold in-[.ui-caption]:tracking-[-0.02em] ' +
    'in-[.ui-spotlight]:first:font-display in-[.ui-spotlight]:first:text-[1.9rem] in-[.ui-spotlight]:first:leading-[1.05] ' +
    'in-[.ui-spotlight]:first:font-extrabold in-[.ui-spotlight]:first:tracking-[-0.035em] sm:in-[.ui-spotlight]:first:text-[2.4rem] ' +
    'in-[.ui-entry]:text-base',
  heading:
    'mr-auto font-display text-[1.65rem] leading-[1.08] font-extrabold tracking-[-0.03em] text-ink sm:text-[1.9rem] lg:text-[2.15rem]',
  figure:
    'font-display text-[1.65rem] leading-[1.1] font-extrabold tracking-[-0.03em] text-ink tabular-nums ' +
    'in-[.ui-tile]:mt-4 in-[.ui-spotlight]:text-[1.45rem] in-[.ui-spotlight]:tracking-[-0.02em]',
  brand:
    'inline-flex items-center gap-2.5 font-display text-[1.2rem] font-extrabold tracking-[-0.025em] text-ink ' +
    'before:size-[34px] before:flex-none before:rounded-[11px] before:bg-logo before:shadow-logo ' +
    'lg:text-[1.35rem] lg:before:size-[38px] lg:before:rounded-xl',
  chip:
    'inline-flex w-fit items-center rounded-full bg-sunken px-2.5 py-0.5 text-xs font-semibold text-ink-2 ' +
    'in-[.ui-dock]:font-bold ' +
    'in-[.ui-spotlight]:px-[11px] in-[.ui-spotlight]:py-1 in-[.ui-spotlight]:text-[12.5px] ' +
    'in-[.ui-sheet]:rounded-[10px] in-[.ui-sheet]:border in-[.ui-sheet]:border-line in-[.ui-sheet]:bg-soft in-[.ui-sheet]:px-3 ' +
    'in-[.ui-sheet]:py-[7px] in-[.ui-sheet]:text-sm',
  empty:
    'flex flex-col items-center justify-center gap-3 rounded-[22px] border-[1.5px] border-dashed border-line-strong bg-white/55 ' +
    'px-5 py-[34px] text-center text-[14.5px] font-medium text-muted glyph-tint-brand-600 [--glyph-gap:0px] [--glyph-size:34px]',
  good: BADGE + ' ui-good bg-fresh-soft text-fresh-ink before:bg-fresh',
  warn: BADGE + ' ui-warn bg-near-soft text-near-ink before:bg-near',
  bad: BADGE + ' ui-bad bg-expired-soft text-expired-ink before:bg-expired',
  info: BADGE + ' bg-info-soft text-info-ink before:bg-info',
  warnNote: NOTE + ' border-near/25 bg-near-soft text-near-ink before:bg-near',
  badNote: NOTE + ' border-expired/25 bg-expired-soft text-expired-ink before:bg-expired',
  primary: 'toned border-transparent bg-brand-600 text-white shadow-primary enabled:hover:bg-brand-700',
  soft: 'toned border-transparent bg-brand-50 text-brand-800 enabled:hover:bg-brand-100 in-[.ui-card]:flex-1',
  quiet: 'toned border-transparent bg-transparent text-ink-2 enabled:hover:bg-ink/6 enabled:hover:text-ink',
  remove: 'toned border-transparent bg-transparent text-expired-ink enabled:hover:bg-expired-soft',
  danger: 'toned border-transparent bg-danger text-white shadow-danger enabled:hover:bg-danger-strong',
  cook:
    'toned border-transparent bg-linear-to-br from-cook to-cook-strong text-white shadow-cook ' +
    'enabled:hover:from-cook-strong enabled:hover:to-cook-deep in-[.ui-dock]:flex-1',
  link: 'toned border-transparent bg-transparent text-ink after:absolute after:inset-0 after:z-1',
  outline: 'toned border-dashed border-brand-600/40 bg-transparent text-brand-800 enabled:hover:border-brand-600 enabled:hover:bg-brand-50',
  tab: 'toned border-transparent bg-transparent text-muted enabled:hover:text-ink lg:text-ink-2 lg:enabled:hover:bg-ink/5',
  current: 'toned border-transparent bg-brand-50 text-brand-600 lg:bg-white lg:text-brand-800 lg:shadow-card lg:inset-ring lg:inset-ring-line',
  selected: 'toned border-transparent bg-ink text-white shadow-chip',
  blocked: 'ui-blocked contents',
  chosen: 'ui-chosen contents',
} as const satisfies Record<Tone, string>;

/**
 * How a box arranges its children.
 *
 * - Generic: stack, row, list (a card of rows), card, modal (a sheet over the page), tabs, banner (a notice).
 * - The frame: masthead (the name of the app), clock (Simulated Today) and popover (its form).
 * - Groups: header (a title and what goes with it), caption (the title of a card with its chips), actions
 *   (buttons), tools (icon buttons), chips (a filter that scrolls sideways), fields (a row of fields).
 * - Grids: tiles (of tile, a Food Type each) and cards; columns (two side by side on a wide screen).
 * - Things: spotlight (the head of a Food Type), entry (a batch, or a cooked recipe), item (a row of the
 *   Warning Panel), ingredient (a line of a recipe), branch (the children of a category), dock (the cook
 *   queue), queue (its entries) and editor (a form that opens in place).
 */
export const LAYOUTS = [
  'stack',
  'row',
  'list',
  'card',
  'modal',
  'tabs',
  'banner',
  'masthead',
  'header',
  'actions',
  'tools',
  'tiles',
  'tile',
  'cards',
  'chips',
  'fields',
  'spotlight',
  'entry',
  'item',
  'ingredient',
  'caption',
  'columns',
  'branch',
  'clock',
  'popover',
  'dock',
  'editor',
  'queue',
] as const;

export type Layout = (typeof LAYOUTS)[number];

export const LAYOUT_CLASS = {
  stack: 'flex flex-col gap-4',
  row:
    'flex flex-row flex-wrap items-center gap-x-2.5 gap-y-2 ' +
    'in-[.ui-spotlight]:mt-2.5 ' +
    'in-[.ui-list]:gap-x-2 in-[.ui-list]:gap-y-1.5 in-[.ui-list]:py-2.5 in-[.ui-list]:pr-2 in-[.ui-list]:pl-3.5 in-[.ui-list]:text-[15px] ' +
    'in-[.ui-list]:not-in-[.ui-branch]:font-semibold in-[.ui-list]:not-in-[.ui-branch]:text-ink in-[.ui-branch]:font-medium ' +
    'in-[.ui-branch]:text-ink-2 ' +
    'in-[.ui-entry]:flex-nowrap in-[.ui-entry]:items-start in-[.ui-entry]:justify-between in-[.ui-entry]:gap-3 ' +
    'in-[.ui-entry]:text-[15px] in-[.ui-entry]:font-semibold in-[.ui-entry]:text-ink ' +
    'in-[.ui-queue]:flex-nowrap in-[.ui-queue]:justify-between in-[.ui-queue]:gap-1 in-[.ui-queue]:p-1.5 in-[.ui-queue]:text-[14.5px] ' +
    'in-[.ui-queue]:font-semibold in-[.ui-queue]:text-ink',
  list: 'ui-list flex flex-col divide-y divide-line overflow-hidden rounded-[22px] border border-line bg-surface p-1 shadow-card',
  card:
    'ui-card flex flex-col gap-2.5 rounded-[22px] border border-line bg-surface p-5 shadow-card transition duration-200 ' +
    'in-[.ui-cards]:hover:-translate-y-0.5 in-[.ui-cards]:hover:shadow-float ' +
    'in-[.ui-blocked]:border-expired/40 in-[.ui-blocked]:bg-linear-to-b in-[.ui-blocked]:from-expired-soft in-[.ui-blocked]:via-surface ' +
    'in-[.ui-blocked]:to-surface in-[.ui-chosen]:border-brand-600 in-[.ui-chosen]:ring-4 in-[.ui-chosen]:ring-brand-600/15 ' +
    'in-[.ui-chosen]:animate-glow',
  modal:
    'ui-sheet fixed inset-0 z-51 m-auto flex h-fit max-h-[88dvh] w-full sheet-width flex-col gap-3.5 overflow-y-auto overscroll-contain ' +
    'rounded-[28px] border border-line bg-surface px-7 pt-7 text-ink shadow-sheet animate-sheet ' +
    'max-sm:top-auto max-sm:m-0 max-sm:max-h-[92dvh] max-sm:max-w-none max-sm:rounded-b-none max-sm:border-b-0 max-sm:px-5 ' +
    'max-sm:pt-6 max-sm:animate-sheet-up',
  tabs:
    'ui-tabs fixed inset-x-0 bottom-0 z-2 flex justify-around gap-0.5 border-t border-line bg-glass px-1.5 pt-1.5 pb-safe-1.5 ' +
    'shadow-bar backdrop-blur-[18px] backdrop-saturate-150 max-[419px]:gap-0 max-[419px]:px-1 ' +
    'lg:static lg:flex-col lg:justify-start lg:gap-1 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none ' +
    'lg:backdrop-saturate-100',
  banner:
    'ui-banner pointer-events-auto flex items-start gap-2.5 rounded-[18px] border border-line bg-white/95 py-3 pr-2 pl-3.5 ' +
    'shadow-pop backdrop-blur-[14px] animate-toast has-[.ui-bad]:border-expired/30 has-[.ui-warn]:border-near/40',
  masthead: 'ui-masthead flex items-center gap-2.5 lg:mb-3.5 lg:px-1.5 lg:py-0.5',
  header: 'ui-header flex flex-wrap items-center gap-x-2.5 gap-y-3.5',
  actions:
    'ui-actions flex flex-wrap items-center gap-2 ' +
    'in-[.ui-spotlight]:mt-3 ' +
    'in-[.ui-entry]:mt-1 in-[.ui-entry]:gap-1.5 ' +
    'in-[.ui-dock]:mt-0.5 in-[.ui-dock]:flex-nowrap ' +
    'in-[.ui-card]:mt-auto in-[.ui-card]:flex-nowrap in-[.ui-card]:justify-between in-[.ui-card]:pt-1.5 ' +
    'in-[.ui-sheet]:sticky in-[.ui-sheet]:bottom-0 in-[.ui-sheet]:z-1 in-[.ui-sheet]:-mx-7 in-[.ui-sheet]:mt-1.5 in-[.ui-sheet]:flex-nowrap ' +
    'in-[.ui-sheet]:justify-end in-[.ui-sheet]:gap-2.5 in-[.ui-sheet]:border-t in-[.ui-sheet]:border-line in-[.ui-sheet]:bg-surface ' +
    'in-[.ui-sheet]:px-7 in-[.ui-sheet]:pt-4 in-[.ui-sheet]:pb-6 ' +
    'max-sm:in-[.ui-sheet]:-mx-5 max-sm:in-[.ui-sheet]:px-5 max-sm:in-[.ui-sheet]:pt-3.5 max-sm:in-[.ui-sheet]:pb-safe-4.5',
  tools: 'ui-tools flex flex-none items-center gap-0.5',
  tiles: 'grid grid-fill-[156px] gap-3 sm:grid-fill-[220px] sm:gap-3.5',
  tile:
    'ui-tile relative isolate flex flex-col gap-0.5 overflow-hidden rounded-[22px] border border-line bg-linear-to-b from-soft via-surface ' +
    'to-surface px-4 pt-[18px] pb-4 shadow-card transition duration-200 hover:-translate-y-[3px] hover:shadow-float ' +
    'before:absolute before:inset-x-0 before:top-0 before:-z-1 before:h-1 before:bg-line-strong ' +
    'has-[.ui-good]:from-fresh-soft/60 has-[.ui-good]:before:bg-fresh has-[.ui-warn]:from-near-soft/75 has-[.ui-warn]:before:bg-near ' +
    'has-[.ui-bad]:from-expired-soft/65 has-[.ui-bad]:before:bg-expired ' +
    'has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-brand-600/45',
  cards: 'ui-cards grid grid-fill-[300px] gap-4',
  chips: 'ui-chips -m-1 flex flex-nowrap items-center gap-2 overflow-x-auto p-1 scrollbar-hidden',
  fields: 'ui-fields grid grid-cols-2 items-end gap-2.5 rounded-2xl border border-line bg-soft p-3 sm:grid-fields',
  spotlight:
    'ui-spotlight flex flex-col items-start gap-2 rounded-[28px] border border-line bg-linear-to-bl from-brand-50 via-surface to-surface ' +
    'p-[26px] shadow-float has-[.ui-good]:from-fresh-soft has-[.ui-warn]:from-near-soft has-[.ui-bad]:from-expired-soft',
  entry:
    'ui-entry relative flex flex-col gap-2 overflow-hidden rounded-[20px] border border-line bg-surface py-4 pr-4 pl-[22px] shadow-card ' +
    'before:absolute before:inset-y-0 before:left-0 before:w-[5px] before:bg-fresh has-[.ui-warn]:before:bg-near ' +
    'has-[.ui-bad]:before:bg-expired ' +
    'in-[.ui-sheet]:gap-[7px] in-[.ui-sheet]:rounded-[18px] in-[.ui-sheet]:bg-soft in-[.ui-sheet]:py-3.5 in-[.ui-sheet]:pl-5 ' +
    'in-[.ui-sheet]:shadow-none in-[.ui-sheet]:before:w-1',
  item:
    'relative flex items-center justify-between gap-3.5 py-[15px] pr-4 pl-[22px] text-[14.5px] font-semibold text-ink ' +
    'before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-r before:bg-near has-[.ui-bad]:before:bg-expired',
  ingredient:
    'ui-ingredient flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl bg-soft px-3 py-[9px] text-sm font-semibold text-ink ' +
    'has-[.ui-bad]:bg-expired-soft/50 has-[.ui-warn]:bg-near-soft/75',
  caption: 'ui-caption flex flex-wrap items-center gap-x-2 gap-y-1.5',
  columns: 'grid items-start gap-x-7 gap-y-4 min-[1100px]:grid-cols-2',
  branch: 'ui-branch flex flex-col divide-y divide-line pl-4',
  clock:
    'ui-clock flex flex-nowrap items-center justify-end gap-2 ' +
    'lg:flex-col lg:items-stretch lg:gap-2.5 lg:rounded-[18px] lg:border lg:border-line lg:bg-white/80 lg:p-3.5 lg:shadow-card',
  popover:
    'ui-popover absolute top-full right-3 z-3 mt-2 flex w-[340px] max-w-[92vw] flex-col gap-3 rounded-[22px] border border-line ' +
    'bg-surface p-[18px] shadow-pop animate-pop lg:static lg:mt-0 lg:w-auto lg:max-w-none lg:shadow-card',
  dock:
    'ui-dock flex flex-col gap-3 rounded-[24px] border border-line bg-surface p-[18px] shadow-pop ' +
    'max-[1199px]:max-h-[46dvh] max-[1199px]:overflow-y-auto max-[1199px]:overscroll-contain ' +
    'min-[1200px]:max-h-[90dvh] min-[1200px]:overflow-y-auto',
  editor:
    'ui-editor flex flex-col gap-3 rounded-[22px] border border-brand-600/30 bg-linear-to-b from-brand-50 via-surface to-surface p-5 ' +
    'shadow-float animate-pop',
  queue: 'ui-queue -mx-1.5 flex flex-col divide-y divide-line',
} as const satisfies Record<Layout, string>;

/** The three kinds of control. */
export const CONTROLS = ['button', 'input', 'select'] as const;

export type Control = (typeof CONTROLS)[number];

/** What an input and a select share. */
const FIELD_CONTROL =
  'h-[46px] w-full rounded-[13px] border border-line-strong bg-surface px-3.5 font-sans text-[15px] font-medium text-ink shadow-hairline ' +
  'transition-colors duration-150 enabled:hover:border-ink/30 focus:border-brand-600 focus:ring-3 focus:ring-brand-600/30 ' +
  'focus:outline-none disabled:cursor-not-allowed disabled:bg-soft disabled:text-muted aria-invalid:border-expired/70 max-sm:text-base';

export const CONTROL_CLASS = {
  button:
    'inline-flex min-h-[38px] min-w-0 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3.5 font-sans text-sm ' +
    'leading-[1.2] font-semibold tracking-[-0.005em] whitespace-nowrap transition duration-150 select-none ' +
    '[--glyph-gap:0px] [--glyph-size:18px] ' +
    'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-600/30 ' +
    'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ' +
    'not-[.toned]:border-line-strong not-[.toned]:bg-surface not-[.toned]:text-ink not-[.toned]:shadow-hairline ' +
    'not-[.toned]:enabled:hover:border-ink/25 not-[.toned]:enabled:hover:bg-soft ' +
    'in-[.ui-tabs]:min-h-[54px] in-[.ui-tabs]:flex-auto in-[.ui-tabs]:flex-col in-[.ui-tabs]:gap-1 in-[.ui-tabs]:rounded-2xl ' +
    'in-[.ui-tabs]:px-1.5 in-[.ui-tabs]:py-1 in-[.ui-tabs]:text-[11px] in-[.ui-tabs]:[--glyph-size:24px] ' +
    'max-[419px]:in-[.ui-tabs]:px-0.5 max-[419px]:in-[.ui-tabs]:text-[10.5px] max-[419px]:in-[.ui-tabs]:tracking-[-0.01em] ' +
    'lg:in-[.ui-tabs]:min-h-11 lg:in-[.ui-tabs]:flex-none lg:in-[.ui-tabs]:flex-row lg:in-[.ui-tabs]:justify-start ' +
    'lg:in-[.ui-tabs]:gap-3 lg:in-[.ui-tabs]:rounded-[13px] lg:in-[.ui-tabs]:px-3.5 lg:in-[.ui-tabs]:text-[15px] ' +
    'lg:in-[.ui-tabs]:[--glyph-size:20px] ' +
    'in-[.ui-chips]:min-h-9 in-[.ui-chips]:flex-none in-[.ui-chips]:rounded-full in-[.ui-chips]:px-[15px] in-[.ui-chips]:text-[13.5px] ' +
    'in-[.ui-tools]:min-h-0 in-[.ui-tools]:rounded-[11px] in-[.ui-tools]:p-0 in-[.ui-tools]:text-[0px] ' +
    'in-[.ui-tools]:not-in-[.ui-card]:size-9 in-[.ui-card]:in-[.ui-tools]:size-10 ' +
    'in-[.ui-banner]:size-9 in-[.ui-banner]:min-h-0 in-[.ui-banner]:flex-none in-[.ui-banner]:rounded-[11px] in-[.ui-banner]:p-0 ' +
    'in-[.ui-banner]:text-[0px] ' +
    'in-[.ui-fields]:size-[46px] in-[.ui-fields]:justify-self-end in-[.ui-fields]:p-0 in-[.ui-fields]:text-[0px] ' +
    'max-lg:in-[.ui-clock]:size-[38px] max-lg:in-[.ui-clock]:min-h-0 max-lg:in-[.ui-clock]:flex-none max-lg:in-[.ui-clock]:rounded-full ' +
    'max-lg:in-[.ui-clock]:p-0 max-lg:in-[.ui-clock]:text-[0px] lg:in-[.ui-clock]:px-3 lg:in-[.ui-clock]:text-[13.5px] ' +
    'in-[.ui-popover]:flex-1 ' +
    'in-[.ui-sheet]:min-h-11 in-[.ui-sheet]:rounded-[13px] in-[.ui-sheet]:in-[.ui-actions]:px-5 ' +
    'in-[.ui-sheet]:in-[.ui-actions]:text-[14.5px] max-sm:in-[.ui-sheet]:in-[.ui-actions]:flex-1 ' +
    'in-[.ui-entry]:min-h-[34px] in-[.ui-entry]:rounded-[10px] in-[.ui-entry]:px-3 in-[.ui-entry]:text-[13px] ' +
    'in-[.ui-entry]:[--glyph-size:16px] ' +
    'in-[.ui-list]:min-h-8 in-[.ui-list]:rounded-[9px] in-[.ui-list]:px-2.5 in-[.ui-list]:text-[13px] ' +
    'in-[.ui-dock]:in-[.ui-actions]:min-h-12 in-[.ui-dock]:in-[.ui-actions]:text-[15px] ' +
    'in-[.ui-tile]:min-h-0 in-[.ui-tile]:self-start in-[.ui-tile]:justify-start in-[.ui-tile]:rounded-md in-[.ui-tile]:p-0 ' +
    'in-[.ui-tile]:text-left in-[.ui-tile]:text-[1.08rem] in-[.ui-tile]:font-bold in-[.ui-tile]:tracking-[-0.015em] ' +
    'in-[.ui-tile]:whitespace-normal in-[.ui-tile]:focus-visible:ring-0',
  input: FIELD_CONTROL,
  select: FIELD_CONTROL + ' cursor-pointer appearance-none pr-[42px] select-chevron',
} as const satisfies Record<Control, string>;

/** The parts of a field that the DOM host paints around its input or select: the label that holds it, its caption and its hint. */
export const FIELD_PARTS = ['label', 'caption', 'hint'] as const;

export type FieldPart = (typeof FIELD_PARTS)[number];

export const FIELD_CLASS = {
  label: 'flex min-w-0 flex-col gap-1.5 in-[.ui-editor]:max-w-[420px]',
  caption: 'text-[13px] leading-[1.3] font-semibold text-ink-2',
  hint: 'glyph icon-alert flex items-start text-[12.5px] leading-[1.4] font-semibold text-expired-ink [--glyph-gap:6px] [--glyph-size:15px]',
} as const satisfies Record<FieldPart, string>;

/**
 * The icons a text or a button can show in front of its words (`lock` behind them, `forward` behind the
 * label of a button), drawn in the colour of the text unless the icon names its own: near and expired are
 * the dots of the two sections of the Warning Panel, and alarm is the sign above a confirmation.
 */
export const ICONS = [
  'fridge',
  'bell',
  'buoy',
  'pot',
  'meal',
  'tag',
  'plus',
  'left',
  'forward',
  'pencil',
  'swap',
  'trash',
  'up',
  'down',
  'x',
  'flame',
  'history',
  'calendar',
  'hourglass',
  'leaf',
  'check',
  'done',
  'clear',
  'sparkle',
  'lock',
  'near',
  'expired',
  'alarm',
] as const;

export type Icon = (typeof ICONS)[number];

export const ICON_CLASS = {
  fridge: 'glyph icon-fridge',
  bell: 'glyph icon-bell',
  buoy: 'glyph icon-buoy',
  pot: 'glyph icon-pot',
  meal: 'glyph icon-pot glyph-tint-cook',
  tag: 'glyph icon-tag',
  plus: 'glyph icon-plus',
  left: 'glyph icon-left',
  forward: 'glyph icon-right flex-row-reverse',
  pencil: 'glyph icon-pencil',
  swap: 'glyph icon-swap',
  trash: 'glyph icon-trash',
  up: 'glyph icon-up',
  down: 'glyph icon-down',
  x: 'glyph icon-x',
  flame: 'glyph icon-flame',
  history: 'glyph icon-history',
  calendar: 'glyph icon-calendar glyph-tint-brand-600',
  hourglass: 'glyph icon-hourglass',
  leaf: 'glyph icon-leaf',
  check: 'glyph icon-check glyph-tint-fresh',
  done: 'glyph icon-check-circle glyph-tint-fresh',
  clear: 'glyph icon-check-circle',
  sparkle: 'glyph icon-sparkle glyph-tint-brand-600',
  lock: 'glyph-after icon-lock',
  near: 'flex items-center gap-2.5 before:size-2.5 before:flex-none before:rounded-full before:bg-near before:ring-4 before:ring-near/20',
  expired:
    'flex items-center gap-2.5 before:size-2.5 before:flex-none before:rounded-full before:bg-expired before:ring-4 before:ring-expired/20',
  alarm: 'flex flex-col items-start gap-4 before:size-[52px] before:rounded-2xl before:bg-alarm',
} as const satisfies Record<Icon, string>;
