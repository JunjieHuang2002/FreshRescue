import { describe, expect, it } from 'vitest';
import type { CookReportDto } from '@freshrescue/contract-views';
import { COOK_REPORT, failedOf, idleOf, loadingOf, readyOf } from '../../testing/fixtures';
import { eventsOf, findButton, problemsOf, renderText } from '../../testing/render';
import { cookReportView } from './cookReportView';

/** The lines of one recipe's entry. */
const entryOf = (text: string, name: string): string => {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.includes(`text: ${name} (title)`));
  const next = lines.findIndex((line, index) => index > start && line.includes('(title)'));
  return lines.slice(start, next === -1 ? undefined : next).join('\n');
};

describe('FU-14 CookReportView', () => {
  const tree = cookReportView(readyOf(COOK_REPORT));
  const text = renderText(tree);

  it('draws one entry for each recipe, in queue order', () => {
    expect(problemsOf(tree)).toEqual([]);
    expect(text).toContain('text: Cook report (title)');
    const titles = [...text.matchAll(/text: (.+) \(title\)/g)].map((match) => match[1]);

    expect(titles).toEqual(['Cook report', 'Beef and Broccoli Stir-Fry', 'Spinach Omelette', 'Vietnamese Chicken Rice', 'Recipe 99']);
  });

  describe('a recipe that was cooked (spec 4.5)', () => {
    const entry = entryOf(text, 'Beef and Broccoli Stir-Fry');

    it('lists what was deducted, with quantity and unit', () => {
      expect(entry).toContain('text: Cooked (good)');
      expect(entry).toContain('text: Deducted 200 grams of Broccoli');
    });

    it('lists an ingredient that was skipped as Missing, with what was needed and what was available (partial match)', () => {
      expect(entry).toContain('text: Missing Beef: needed 300 grams, available 150, so none was deducted (warnNote)');
    });
  });

  describe('a recipe that was skipped', () => {
    it('says "Nothing available to deduct" when no ingredient was available (exception 16)', () => {
      const entry = entryOf(text, 'Spinach Omelette');

      expect(entry).toContain('text: Skipped (warn)');
      expect(entry).toContain('text: Nothing available to deduct (muted)');
      expect(entry).not.toContain('Deducted');
    });

    it('says that a blocked recipe was blocked (exceptions 6, 7 and 21)', () => {
      expect(entryOf(text, 'Vietnamese Chicken Rice')).toContain('text: Blocked: a Food Type is missing, or a unit does not match (muted)');
    });

    it('lists a recipe that is no longer there as skipped, and does not fail the run', () => {
      const entry = entryOf(text, 'Recipe 99');

      expect(entry).toContain('text: Skipped (warn)');
      expect(entry).toContain('text: The recipe no longer exists (muted)');
    });
  });

  it('has a Dismiss button that closes the report', () => {
    expect(findButton(tree, 'Dismiss')?.event).toEqual({ ns: 'cook', name: 'dismiss', payload: {} });
    expect(eventsOf(tree)).toHaveLength(1);
  });

  it('says so when the queue was empty, and can still be dismissed', () => {
    const empty = cookReportView(readyOf<CookReportDto>({ reports: [] }));

    expect(renderText(empty)).toContain('text: Nothing was in the queue. (muted)');
    expect(findButton(empty, 'Dismiss')).toBeDefined();
  });

  it('draws what each state of the read has: nothing when idle', () => {
    expect(cookReportView(idleOf<CookReportDto>())).toEqual({ kind: 'box', layout: 'stack', children: [] });
    expect(renderText(cookReportView(loadingOf<CookReportDto>()))).toContain('text: Cooking…');
    expect(renderText(cookReportView(failedOf<CookReportDto>()))).toContain('text: The recipes could not be cooked. (badNote)');
    expect(renderText(cookReportView(loadingOf(COOK_REPORT)))).toContain('Beef and Broccoli Stir-Fry');
  });
});
