import { describe, expect, it } from 'vitest';
import type { InventoryListDto } from '@freshrescue/contract-views';
import { INVENTORY, failedOf, idleOf, loadingOf, readyOf } from '../../testing/fixtures';
import { eventsOf, findButton, nodesOf, problemsOf, renderText } from '../../testing/render';
import { inventoryListView } from './inventoryListView';

const rowText = (text: string, name: string): string => {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.includes(`button: ${name} `));
  return lines.slice(start, start + 6).join('\n');
};

describe('FU-04 InventoryListView', () => {
  it('draws every Food Type, with its category path, its total and its unit', () => {
    const tree = inventoryListView(readyOf(INVENTORY));
    const text = renderText(tree);

    expect(problemsOf(tree)).toEqual([]);
    expect(text).toContain('text: Inventory (heading)');
    for (const name of ['Beef', 'Broccoli', 'Chicken', 'Egg']) expect(findButton(tree, name)).toBeDefined();
    expect(text).toContain('text: Meat → Red Meat (muted)');
    expect(text).toContain('text: 550 grams');
    expect(text).toContain('text: 1.5 grams');
  });

  describe('the status of a Food Type with batches in several statuses (spec 4.7.1, exception 23)', () => {
    const beef = rowText(renderText(inventoryListView(readyOf(INVENTORY))), 'Beef');

    it('shows a breakdown by status', () => {
      expect(beef).toContain('text: Fresh 300 · Near-Expiry 150 · Expired 100 (muted)');
    });

    it('takes the badge from the most urgent status that is present', () => {
      expect(beef).toContain('text: Expired (bad)');
      const chicken = rowText(renderText(inventoryListView(readyOf(INVENTORY))), 'Chicken');
      const broccoli = rowText(renderText(inventoryListView(readyOf(INVENTORY))), 'Broccoli');

      expect(chicken).toContain('text: Near-Expiry (warn)');
      expect(broccoli).toContain('text: Fresh (good)');
    });

    it('leaves out the statuses that have nothing in them', () => {
      const broccoli = rowText(renderText(inventoryListView(readyOf(INVENTORY))), 'Broccoli');
      const chicken = rowText(renderText(inventoryListView(readyOf(INVENTORY))), 'Chicken');

      expect(broccoli).toContain('text: Fresh 250 (muted)');
      expect(broccoli).not.toContain('Near-Expiry 0');
      expect(chicken).toContain('text: Near-Expiry 1.5 (muted)');
      expect(chicken).not.toContain('Fresh');
    });
  });

  it('shows quantity 0 and a dash for a Food Type with no batches, and no status badge (exception 22)', () => {
    const egg = rowText(renderText(inventoryListView(readyOf(INVENTORY))), 'Egg');

    expect(egg).toContain('text: 0 pieces');
    expect(egg).toContain('text: — (muted)');
    expect(egg).not.toMatch(/text: (Fresh|Near-Expiry|Expired)/);
  });

  it('opens the detail of a Food Type from its name', () => {
    expect(findButton(inventoryListView(readyOf(INVENTORY)), 'Beef')?.event).toEqual({ ns: 'inventory', name: 'openDetail', payload: { foodTypeId: 20 } });
  });

  it('offers Add Food Type and Add batch, with or without rows', () => {
    for (const resource of [readyOf(INVENTORY), readyOf<InventoryListDto>({ rows: [] }), loadingOf<InventoryListDto>(), failedOf<InventoryListDto>(), idleOf<InventoryListDto>()]) {
      const tree = inventoryListView(resource);

      expect(findButton(tree, 'Add Food Type')?.event).toEqual({ ns: 'foodType', name: 'newFoodType', payload: {} });
      expect(findButton(tree, 'Add batch')?.event).toEqual({ ns: 'inventory', name: 'addBatch', payload: { foodTypeId: null } });
    }
  });

  it('says "No food yet" when no Food Type exists', () => {
    expect(renderText(inventoryListView(readyOf<InventoryListDto>({ rows: [] })))).toContain('text: No food yet');
  });

  it('keeps the order of the rows that the backend sorted', () => {
    const names = nodesOf(inventoryListView(readyOf(INVENTORY))).flatMap((node) => (node.kind === 'button' && node.event.name === 'openDetail' ? [node.label] : []));

    expect(names).toEqual(['Beef', 'Broccoli', 'Chicken', 'Egg']);
  });

  it('draws what each state of the read has', () => {
    expect(renderText(inventoryListView(loadingOf<InventoryListDto>()))).toContain('text: Loading…');
    expect(renderText(inventoryListView(failedOf<InventoryListDto>()))).toContain('text: Could not load the inventory list.');
    expect(renderText(inventoryListView(idleOf<InventoryListDto>()))).not.toContain('Loading');
    // a reload keeps the list that is there
    expect(renderText(inventoryListView(loadingOf(INVENTORY)))).toContain('button: Beef');
    expect(renderText(inventoryListView(failedOf<InventoryListDto>()))).not.toContain('button: Beef');
  });

  it('sends its events to the inventory and foodType namespaces only', () => {
    expect(new Set(eventsOf(inventoryListView(readyOf(INVENTORY))).map((event) => event.ns))).toEqual(new Set(['inventory', 'foodType']));
  });
});
