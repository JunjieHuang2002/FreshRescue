import { SLOT_IDS } from '@freshrescue/contract-ui';
import type { Icon, NavState, RenderTree, SlotId, Tab } from '@freshrescue/contract-ui';

const TAB_LABEL: Record<Tab, string> = {
  inventory: 'Inventory',
  warnings: 'Warnings',
  recommendations: 'Recommendations',
  catalog: 'Recipes',
  categories: 'Categories',
};

const TAB_ICON: Record<Tab, Icon> = {
  inventory: 'fridge',
  warnings: 'bell',
  recommendations: 'buoy',
  catalog: 'pot',
  categories: 'tag',
};

const TAB_ORDER: readonly Tab[] = ['inventory', 'warnings', 'recommendations', 'catalog', 'categories'];

// The slots that always show: the notices, and the Simulated Today control.
const HEADER_SLOTS: readonly SlotId[] = ['notices', 'demo'];

// The content slots that each tab shows. The Inventory tab shows the list, or the detail of the Food
// Type that is open. The cook queue and its report belong to the recipe catalog, where Cook & Deduct is.
const TAB_SLOTS: Record<Tab, readonly SlotId[]> = {
  inventory: ['inventoryList', 'foodTypeDetail'],
  warnings: ['warnings'],
  recommendations: ['recommendations'],
  catalog: ['catalog', 'cookQueue', 'cookReport'],
  categories: ['categories'],
};

const CONTENT_SLOTS: readonly SlotId[] = TAB_ORDER.flatMap((tab) => TAB_SLOTS[tab]);

function isShown(slot: SlotId, nav: NavState): boolean {
  if (!TAB_SLOTS[nav.tab].includes(slot)) return false;
  if (nav.tab !== 'inventory') return true;
  return slot === (nav.detail === null ? 'inventoryList' : 'foodTypeDetail');
}

/**
 * FU-01 AppShellView. Draws the page frame (blueprint 1.8): the title and today's date, the tab bar,
 * and a directive for each slot of the page that says whether it shows. Each tab has its icon, and
 * the tab that is open has the tone `current`. The date is there for a screen reader: the page shows
 * it in the Simulated Today control. A click on a tab goes to that tab with no detail open, which also closes a Food Type
 * detail. The date is the label that the caller passes, which is the date that the backend
 * resolved; the view works out nothing from it. `slots` are the slot ids that the page has, all 16
 * unless the caller says otherwise, and the frame draws a directive only for a slot that the page has.
 */
export function appShellView(nav: NavState, todayLabel: string, slots: readonly SlotId[] = SLOT_IDS): RenderTree {
  const tabs: RenderTree[] = TAB_ORDER.map((tab) => ({
    kind: 'button',
    label: TAB_LABEL[tab],
    icon: TAB_ICON[tab],
    tone: tab === nav.tab ? 'current' : 'tab',
    event: { ns: 'shell', name: 'navigate', payload: { tab, detail: null } },
  }));
  const header: RenderTree[] = [{ kind: 'text', text: 'FreshRescue', tone: 'brand' }];
  if (todayLabel !== '') header.push({ kind: 'text', text: todayLabel, tone: 'muted' });
  return {
    kind: 'box',
    layout: 'stack',
    children: [
      { kind: 'box', layout: 'masthead', children: header },
      { kind: 'box', layout: 'tabs', children: tabs },
      ...HEADER_SLOTS.filter((slot) => slots.includes(slot)).map((slot): RenderTree => ({ kind: 'slot', slot, shown: true })),
      ...CONTENT_SLOTS.filter((slot) => slots.includes(slot)).map((slot): RenderTree => ({ kind: 'slot', slot, shown: isShown(slot, nav) })),
    ],
  };
}
