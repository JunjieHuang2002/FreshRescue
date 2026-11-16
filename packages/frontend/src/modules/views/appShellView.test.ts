import { describe, expect, it } from 'vitest';
import { SLOT_IDS, TABS } from '@freshrescue/contract-ui';
import type { NavState, RenderTree, SlotId } from '@freshrescue/contract-ui';
import { eventsOf, findButton, nodesOf, problemsOf, renderText } from '../../testing/render';
import { appShellView } from './appShellView';

const HOME: NavState = { tab: 'inventory', detail: null };

const slotsOf = (tree: RenderTree): Record<string, boolean> =>
  Object.fromEntries(nodesOf(tree).flatMap((node) => (node.kind === 'slot' ? [[node.slot, node.shown]] : [])));

const shownContent = (tree: RenderTree): SlotId[] =>
  Object.entries(slotsOf(tree))
    .filter(([slot, shown]) => shown && slot !== 'notices' && slot !== 'demo')
    .map(([slot]) => slot as SlotId);

describe('FU-01 AppShellView', () => {
  it('draws the title, the date and a tab bar with the five tabs', () => {
    const tree = appShellView(HOME, 'Today: 2026-10-02');
    const text = renderText(tree);

    expect(problemsOf(tree)).toEqual([]);
    expect(text).toContain('text: FreshRescue (brand)');
    expect(text).toContain('text: Today: 2026-10-02 (muted)');
    expect(TABS).toHaveLength(5);
    for (const label of ['Inventory', 'Warnings', 'Recommendations', 'Recipes', 'Categories']) {
      expect(findButton(tree, label)?.event).toMatchObject({ ns: 'shell', name: 'navigate' });
    }
  });

  it('sends a click on a tab to that tab with no detail open', () => {
    const tree = appShellView({ tab: 'inventory', detail: 7 }, '');
    const payloads = TABS.map((tab) => ({ tab, detail: null }));

    expect(eventsOf(tree).map((event) => event.payload)).toEqual(payloads);
  });

  it('marks the tab that is open, and only that one', () => {
    for (const tab of TABS) {
      const tree = appShellView({ tab, detail: null }, '');
      const marked = nodesOf(tree).flatMap((node) => (node.kind === 'button' && node.tone === 'current' && node.event.name === 'navigate' ? [node.event.payload.tab] : []));

      expect(marked).toEqual([tab]);
    }
  });

  it('leaves the date out when there is none to show', () => {
    expect(renderText(appShellView(HOME, ''))).not.toContain('Today');
  });

  it('draws a directive for the two header slots, which always show, and the eight content slots', () => {
    const slots = slotsOf(appShellView(HOME, ''));

    expect(Object.keys(slots).sort()).toEqual(
      ['notices', 'demo', 'inventoryList', 'foodTypeDetail', 'warnings', 'recommendations', 'catalog', 'cookQueue', 'cookReport', 'categories'].sort(),
    );
    for (const slot of Object.keys(slots)) expect(SLOT_IDS as readonly string[]).toContain(slot);
    expect(slots.notices).toBe(true);
    expect(slots.demo).toBe(true);
  });

  it('draws a directive only for the slots that the page has, all 16 unless it says otherwise', () => {
    const some = appShellView(HOME, '', ['notices', 'inventoryList', 'warnings']);

    expect(Object.keys(slotsOf(some)).sort()).toEqual(['inventoryList', 'notices', 'warnings']);
    expect(slotsOf(some)).toEqual({ notices: true, inventoryList: true, warnings: false });
    expect(slotsOf(appShellView(HOME, ''))).toEqual(slotsOf(appShellView(HOME, '', SLOT_IDS)));
    expect(slotsOf(appShellView(HOME, '', []))).toEqual({});
  });

  it('shows the content of one tab at a time', () => {
    expect(shownContent(appShellView({ tab: 'inventory', detail: null }, ''))).toEqual(['inventoryList']);
    expect(shownContent(appShellView({ tab: 'warnings', detail: null }, ''))).toEqual(['warnings']);
    expect(shownContent(appShellView({ tab: 'recommendations', detail: null }, ''))).toEqual(['recommendations']);
    expect(shownContent(appShellView({ tab: 'catalog', detail: null }, ''))).toEqual(['catalog', 'cookQueue', 'cookReport']);
    expect(shownContent(appShellView({ tab: 'categories', detail: null }, ''))).toEqual(['categories']);
  });

  it('shows the detail of a Food Type in place of the list when one is open', () => {
    expect(shownContent(appShellView({ tab: 'inventory', detail: 20 }, ''))).toEqual(['foodTypeDetail']);
  });

  it('draws a tree of plain data that does not change with the input object', () => {
    const nav = Object.freeze({ tab: 'catalog', detail: null } as const);

    expect(appShellView(nav, 'Today: x')).toEqual(appShellView({ tab: 'catalog', detail: null }, 'Today: x'));
  });
});
