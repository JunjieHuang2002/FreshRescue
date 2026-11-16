import { describe, expect, it } from 'vitest';
import type { WarningPanelDto } from '@freshrescue/contract-views';
import { WARNINGS, failedOf, idleOf, loadingOf, readyOf } from '../../testing/fixtures';
import { eventsOf, nodesOf, problemsOf, renderText } from '../../testing/render';
import { warningPanelView } from './warningPanelView';

const NONE: WarningPanelDto = { nearExpiry: [], expired: [] };

describe('FU-10 WarningPanelView', () => {
  const tree = warningPanelView(readyOf(WARNINGS));
  const text = renderText(tree);

  it('draws a Near-Expiry section with a warning badge for each batch (spec 4.3.3)', () => {
    expect(problemsOf(tree)).toEqual([]);
    expect(text).toContain('text: Warning Panel (heading)');
    expect(text).toContain('text: Near-Expiry (title)');
    expect(text).toContain('text: 150 grams of Beef — expires in 1 day');
    expect(text).toContain('text: 1.5 grams of Chicken — expires today');
    expect(text.match(/text: Near-Expiry \(warn\)/g)).toHaveLength(2);
  });

  it('draws a separate Expired section with a red badge', () => {
    expect(text).toContain('text: Expired (title)');
    expect(text).toContain('text: 100 grams of Beef — expired 3 days ago');
    expect(text.match(/text: Expired \(bad\)/g)).toHaveLength(1);
    expect(text.indexOf('text: Expired (title)')).toBeGreaterThan(text.indexOf('text: Near-Expiry (title)'));
  });

  it('keeps the order of the rows that the backend sorted', () => {
    const rows = nodesOf(tree).flatMap((node) => (node.kind === 'text' && node.text.includes(' of ') ? [node.text] : []));

    expect(rows.map((row) => /of (\w+)/.exec(row)?.[1])).toEqual(['Beef', 'Chicken', 'Beef']);
  });

  it('says "No near-expiry items" when there is none, and leaves the Expired section out (spec exception 13)', () => {
    const empty = renderText(warningPanelView(readyOf(NONE)));

    expect(empty).toContain('text: No near-expiry items (empty)');
    expect(empty).not.toContain('Expired');
  });

  it('says "No near-expiry items" and still lists the Expired batches when only those exist (spec 4.6)', () => {
    const onlyExpired = renderText(warningPanelView(readyOf({ nearExpiry: [], expired: WARNINGS.expired })));

    expect(onlyExpired).toContain('text: No near-expiry items');
    expect(onlyExpired).toContain('text: Expired (title)');
    expect(onlyExpired).toContain('expired 3 days ago');
  });

  it('lists the Near-Expiry batches and leaves the Expired section out when nothing is Expired', () => {
    const onlyNear = renderText(warningPanelView(readyOf({ nearExpiry: WARNINGS.nearExpiry, expired: [] })));

    expect(onlyNear).toContain('expires in 1 day');
    expect(onlyNear).not.toContain('Expired');
    expect(onlyNear).not.toContain('No near-expiry items');
  });

  it('has no events: the Warning Panel only shows', () => {
    expect(eventsOf(tree)).toEqual([]);
  });

  it('draws what each state of the read has', () => {
    expect(warningPanelView(idleOf<WarningPanelDto>())).toEqual({ kind: 'box', layout: 'stack', children: [] });
    expect(renderText(warningPanelView(loadingOf<WarningPanelDto>()))).toContain('text: Loading…');
    expect(renderText(warningPanelView(failedOf<WarningPanelDto>()))).toContain('text: Could not load the Warning Panel. (badNote)');
    expect(renderText(warningPanelView(loadingOf(WARNINGS)))).toContain('text: Near-Expiry (title)');
    // while it reloads, a panel with data does not say that there is nothing near expiry
    expect(renderText(warningPanelView(loadingOf<WarningPanelDto>()))).not.toContain('No near-expiry items');
  });
});
