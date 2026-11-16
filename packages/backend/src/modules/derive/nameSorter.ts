import type { Id, Named } from '@freshrescue/contract-primitives';

/**
 * The comparison of spec 4.4.D. `sensitivity: 'accent'` ignores case and nothing else, so `milk` and
 * `Milk` tie while `eclair` and `éclair` do not. The locale is pinned to English, the language of the
 * app, instead of the machine's default, so equal inputs give equal outputs wherever the backend runs.
 */
const COLLATOR = new Intl.Collator('en', { sensitivity: 'accent' });

/**
 * BC-11 NameSorter. Orders named items A to Z (spec 4.4.D): a case-insensitive, locale-aware
 * comparison of the trimmed name. Locale-aware means alphabetical as a reader expects it, not by
 * character code: `Äpfel` sorts among the A's and not after `Zucchini`, and `beef` comes before
 * `Broccoli` whatever the case.
 *
 * Ties are broken by creation order, which is the order the items come in, because every list of a
 * snapshot is kept in creation order. It returns the ids only, and the caller looks the records up. The
 * one order serves Tier 1, Tier 2, the Feature 4 catalog, the Feature 5 inventory list and the Warning
 * Panel's name tie-break.
 */
export function nameSorter(items: readonly Named[]): Id[] {
  return items
    .map((item, position) => ({ id: item.id, name: item.name.trim(), position }))
    .sort((a, b) => COLLATOR.compare(a.name, b.name) || a.position - b.position)
    .map((item) => item.id);
}
