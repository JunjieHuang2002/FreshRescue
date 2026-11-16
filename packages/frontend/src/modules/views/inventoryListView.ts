import { BATCH_STATUSES } from '@freshrescue/contract-rules';
import type { BatchStatus } from '@freshrescue/contract-rules';
import type { RenderTree, ResourceState, Tone } from '@freshrescue/contract-ui';
import type { InventoryListDto, InventoryRow } from '@freshrescue/contract-views';

const LABEL: Record<BatchStatus, string> = { fresh: 'Fresh', nearExpiry: 'Near-Expiry', expired: 'Expired' };
const TONE: Record<BatchStatus, Tone> = { fresh: 'good', nearExpiry: 'warn', expired: 'bad' };

/** `Fresh 300 · Near-Expiry 150 · Expired 100`: the statuses that have stock, in the order Fresh, Near-Expiry, Expired. */
const breakdown = (row: InventoryRow): string =>
  BATCH_STATUSES.filter((status) => row.byStatus[status] > 0)
    .map((status) => `${LABEL[status]} ${row.byStatus[status] / 1000}`)
    .join(' · ');

function rowOf(row: InventoryRow): RenderTree {
  const status: RenderTree[] =
    row.overall === null
      ? [{ kind: 'text', text: '—', tone: 'muted' }]
      : [
          { kind: 'text', text: breakdown(row), tone: 'muted' },
          { kind: 'text', text: LABEL[row.overall], tone: TONE[row.overall] },
        ];
  return {
    kind: 'box',
    layout: 'tile',
    children: [
      { kind: 'button', label: row.name, tone: 'link', event: { ns: 'inventory', name: 'openDetail', payload: { foodTypeId: row.foodTypeId } } },
      { kind: 'text', text: row.categoryPath.join(' → '), tone: 'muted' },
      { kind: 'text', text: `${row.total / 1000} ${row.unit}`, tone: 'figure' },
      ...status,
    ],
  };
}

/**
 * FU-04 InventoryListView. Draws the Feature 5 list of every Food Type (spec 4.7.1, blueprint 1.8):
 * the name, which opens its detail, its category path, its total quantity with its unit, and its
 * status. The status is a breakdown such as `Fresh 300 · Near-Expiry 150 · Expired 100`, which leaves
 * out a status with nothing in it, and a badge for the most urgent status. A Food Type with no batch
 * shows 0 and "—" (exception 22). An empty list says "No food yet". The two actions, Add Food Type and
 * Add batch, are always there. The rows come in the order that the backend sorted them, each as a tile
 * that the name opens as a whole.
 */
export function inventoryListView(resource: ResourceState<InventoryListDto>): RenderTree {
  const { data } = resource.context;
  const shown = resource.value === 'ready' || (resource.value === 'loading' && data !== null);
  let body: RenderTree[] = [];
  if (resource.value === 'loading' && data === null) body = [{ kind: 'text', text: 'Loading…', tone: 'muted' }];
  else if (resource.value === 'failed') body = [{ kind: 'text', text: 'Could not load the inventory list.', tone: 'badNote' }];
  else if (shown && data !== null) {
    body =
      data.rows.length === 0
        ? [{ kind: 'text', text: 'No food yet', tone: 'empty', icon: 'fridge' }]
        : [{ kind: 'box', layout: 'tiles', children: data.rows.map(rowOf) }];
  }
  return {
    kind: 'box',
    layout: 'stack',
    children: [
      {
        kind: 'box',
        layout: 'header',
        children: [
          { kind: 'text', text: 'Inventory', tone: 'heading' },
          { kind: 'button', label: 'Add Food Type', icon: 'plus', event: { ns: 'foodType', name: 'newFoodType', payload: {} } },
          { kind: 'button', label: 'Add batch', tone: 'primary', icon: 'plus', event: { ns: 'inventory', name: 'addBatch', payload: { foodTypeId: null } } },
        ],
      },
      ...body,
    ],
  };
}
