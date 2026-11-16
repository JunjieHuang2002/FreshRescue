import type { BatchStatus } from '@freshrescue/contract-rules';
import type { RenderTree, ResourceState, Tone } from '@freshrescue/contract-ui';
import type { WarningPanelDto, WarningRow } from '@freshrescue/contract-views';

const LABEL: Record<BatchStatus, string> = { fresh: 'Fresh', nearExpiry: 'Near-Expiry', expired: 'Expired' };
const TONE: Record<BatchStatus, Tone> = { fresh: 'good', nearExpiry: 'warn', expired: 'bad' };

/** The computed text of spec 4.2.1: `expires in 4 days`, `expires in 1 day`, `expires today`, `expired 2 days ago`. */
const when = (daysLeft: number): string => {
  if (daysLeft >= 2) return `expires in ${daysLeft} days`;
  if (daysLeft === 1) return 'expires in 1 day';
  if (daysLeft === 0) return 'expires today';
  return daysLeft === -1 ? 'expired 1 day ago' : `expired ${-daysLeft} days ago`;
};

const rowOf = (row: WarningRow): RenderTree => ({
  kind: 'box',
  layout: 'item',
  children: [
    { kind: 'text', text: `${row.quantity / 1000} ${row.unit} of ${row.foodTypeName} — ${when(row.daysLeft)}` },
    { kind: 'text', text: LABEL[row.status], tone: TONE[row.status] },
  ],
});

function sections(dto: WarningPanelDto): RenderTree[] {
  const near: RenderTree[] =
    dto.nearExpiry.length === 0
      ? [{ kind: 'text', text: 'No near-expiry items', tone: 'empty', icon: 'clear' }]
      : [{ kind: 'box', layout: 'list', children: dto.nearExpiry.map(rowOf) }];
  // the Expired section is there only when there is something in it (spec 4.6)
  const expired: RenderTree[] =
    dto.expired.length === 0
      ? []
      : [
          { kind: 'text', text: 'Expired', tone: 'title', icon: 'expired' },
          { kind: 'text', text: 'Throw these away, then remove their batches from the inventory.', tone: 'muted' },
          { kind: 'box', layout: 'list', children: dto.expired.map(rowOf) },
        ];
  return [{ kind: 'text', text: 'Near-Expiry', tone: 'title', icon: 'near' }, ...near, ...expired];
}

/**
 * FU-10 WarningPanelView. Draws the Warning Panel (spec 4.3.3, blueprint 1.8): a Near-Expiry section
 * and a separate Expired section, each batch as the computed text of spec 4.2.1 with a badge. With no
 * Near-Expiry batch the panel says "No near-expiry items" (spec exception 13), and the Expired
 * section shows only when an Expired batch exists. The rows come in the order that the backend
 * sorted them: days left, then Food Type name, then creation order. The panel has no events.
 */
export function warningPanelView(resource: ResourceState<WarningPanelDto>): RenderTree {
  const { data } = resource.context;
  if (resource.value === 'idle') return { kind: 'box', layout: 'stack', children: [] };
  let body: RenderTree[] = [];
  if (resource.value === 'loading' && data === null) body = [{ kind: 'text', text: 'Loading…', tone: 'muted' }];
  else if (resource.value === 'failed') body = [{ kind: 'text', text: 'Could not load the Warning Panel.', tone: 'badNote' }];
  else if (data !== null) body = sections(data);
  return { kind: 'box', layout: 'stack', children: [{ kind: 'text', text: 'Warning Panel', tone: 'heading' }, ...body] };
}
