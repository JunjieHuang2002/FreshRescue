// The words that the page adds around the slots, so that a first visit explains the app: the hero with the
// four steps of FreshRescue above the inventory, a one-line label above each of the other tabs, and the hint
// that stands in for the cook queue until a recipe is queued. They are static: no event, no state, no data.
// Each step names the tab where it happens, so the guide and the tab bar tell the same story.

/** The icons of the guide: the same `glyph` and `icon-*` utilities as the style tokens, drawn in the current colour. */
export type Glyph = 'fridge' | 'bell' | 'buoy' | 'pot' | 'tag' | 'history';

// written out in full, so that Tailwind finds each class
const ICON_OF: Record<Glyph, string> = {
  fridge: 'icon-fridge',
  bell: 'icon-bell',
  buoy: 'icon-buoy',
  pot: 'icon-pot',
  tag: 'icon-tag',
  history: 'icon-history',
};

const STEPS: readonly { readonly glyph: Glyph; readonly name: string; readonly text: string }[] = [
  { glyph: 'fridge', name: 'Stock', text: 'In Inventory, add each batch with its own shelf life. Two cartons of milk, two dates.' },
  { glyph: 'bell', name: 'Watch', text: 'Warnings lists what expires soon, 3 days ahead by default.' },
  { glyph: 'buoy', name: 'Rescue', text: 'Recommendations suggests recipes that use your near-expiry food.' },
  { glyph: 'pot', name: 'Cook', text: 'In Recipes, queue meals and cook. Each ingredient comes out of the batch that expires first.' },
];

/** An icon on its own; `className` sets its size with `[--glyph-size:…]`. */
function Icon({ glyph, className }: { readonly glyph: Glyph; readonly className: string }) {
  return <span aria-hidden="true" className={`glyph ${ICON_OF[glyph]} flex [--glyph-gap:0px] ${className}`} />;
}

/** The welcome above the inventory list: what FreshRescue does, in four steps. */
export function Hero() {
  return (
    <div className="fr-hero px-6 pt-7 pb-6 sm:px-9 sm:pt-9 sm:pb-8">
      <p className="text-[11px] font-bold tracking-[0.22em] text-white/70 uppercase">Smart fridge assistant</p>
      <h1 className="mt-2 font-display text-[clamp(2rem,1.35rem+2.6vw,3rem)] leading-[1.04] font-extrabold tracking-[-0.035em]">
        Waste less. Eat fresher.
      </h1>
      <p className="mt-3 max-w-[40rem] text-[15px] leading-relaxed text-white/85 sm:text-base">
        Every batch in your fridge gets its own countdown. FreshRescue warns you before food expires and finds recipes that use it up first.
      </p>
      <ol className="scrollbar-hidden -mx-6 mt-7 flex snap-x snap-mandatory scroll-px-6 gap-3 overflow-x-auto px-6 pb-1 sm:mx-0 sm:grid sm:scroll-px-0 sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-4">
        {STEPS.map((step, index) => (
          <li
            key={step.name}
            className="w-[76%] max-w-[17rem] shrink-0 snap-start rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 ring-inset sm:w-auto sm:max-w-none"
          >
            <div className="flex items-center justify-between">
              <span className="grid size-10 place-items-center rounded-xl bg-white/15 ring-1 ring-white/20 ring-inset">
                <Icon glyph={step.glyph} className="[--glyph-size:20px]" />
              </span>
              <span className="font-display text-sm font-bold text-white/45 tabular-nums">0{index + 1}</span>
            </div>
            <p className="mt-3 font-display text-lg font-bold tracking-[-0.01em]">{step.name}</p>
            <p className="mt-1 text-[13.5px] leading-snug text-white/80">{step.text}</p>
          </li>
        ))}
      </ol>
      <p className="mt-5 flex items-start gap-2 text-[13px] leading-snug text-white/75">
        <Icon glyph="history" className="mt-px [--glyph-size:16px]" />
        <span>
          <strong className="font-semibold text-white">Demo tip:</strong> set Simulated Today to jump ahead in time and watch food expire.
        </span>
      </p>
    </div>
  );
}

/** The label above a tab: which step it is, and what it is for. */
export function Eyebrow({ glyph, step, note }: { readonly glyph: Glyph; readonly step: string; readonly note: string }) {
  return (
    <p className="fr-eyebrow flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] font-bold tracking-[0.14em] text-brand-700 uppercase">
      <span className="grid size-6 place-items-center rounded-lg bg-brand-100">
        <Icon glyph={glyph} className="[--glyph-size:14px]" />
      </span>
      <span>{step}</span>
      <span className="text-[13px] font-semibold tracking-normal text-[var(--fr-muted)] normal-case">{note}</span>
    </p>
  );
}

/** What the cook queue's place shows before the first recipe is queued: the queue is painted only from then on. */
export function QueueHint() {
  return (
    <div className="fr-queue-hint flex items-start gap-3.5 rounded-[22px] border border-dashed border-[var(--fr-line-strong)] bg-white/60 p-5">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-orange-50 text-orange-700">
        <Icon glyph="pot" className="[--glyph-size:22px]" />
      </span>
      <div>
        <p className="font-display text-[1.05rem] font-bold text-[var(--fr-ink)]">Cook queue</p>
        <p className="mt-1 text-[13.5px] leading-snug text-[var(--fr-muted)]">
          Add recipes with <span className="font-semibold text-[var(--fr-ink-2)]">Add to cook queue</span>, then cook them in one go. Each
          ingredient comes out of the batch that expires first.
        </p>
      </div>
    </div>
  );
}
