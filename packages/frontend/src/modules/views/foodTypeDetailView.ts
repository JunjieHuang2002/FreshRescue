import { BATCH_STATUSES } from '@freshrescue/contract-rules';
import type { BatchStatus, ThresholdSource } from '@freshrescue/contract-rules';
import type { RenderTree, ResourceState, Tone } from '@freshrescue/contract-ui';
import type { BatchView, FoodTypeDetailDto } from '@freshrescue/contract-views';

const LABEL: Record<BatchStatus, string> = { fresh: 'Fresh', nearExpiry: 'Near-Expiry', expired: 'Expired' };
const TONE: Record<BatchStatus, Tone> = { fresh: 'good', nearExpiry: 'warn', expired: 'bad' };
const SOURCE: Record<ThresholdSource, string> = {
  foodType: 'Food Type',
  child: 'Child category',
  parent: 'Parent category',
  global: 'global default',
};

/** The computed text of spec 4.2.1: `expires in 4 days`, `expires in 1 day`, `expires today`, `expired 2 days ago`. */
const when = (daysLeft: number): string => {
  if (daysLeft >= 2) return `expires in ${daysLeft} days`;
  if (daysLeft === 1) return 'expires in 1 day';
  if (daysLeft === 0) return 'expires today';
  return daysLeft === -1 ? 'expired 1 day ago' : `expired ${-daysLeft} days ago`;
};

const days = (count: number): string => `${count} ${count === 1 ? 'day' : 'days'}`;

/** `500 ml of Milk — expires in 4 days`. */
const summaryOf = (dto: FoodTypeDetailDto, batch: BatchView): string =>
  `${batch.quantity / 1000} ${dto.unit} of ${dto.name} — ${when(batch.daysLeft)}`;

const breakdown = (dto: FoodTypeDetailDto): string =>
  BATCH_STATUSES.filter((status) => dto.byStatus[status] > 0)
    .map((status) => `${LABEL[status]} ${dto.byStatus[status] / 1000}`)
    .join(' · ');

function batchOf(dto: FoodTypeDetailDto, batch: BatchView): RenderTree {
  const summary = summaryOf(dto, batch);
  return {
    kind: 'box',
    layout: 'entry',
    children: [
      {
        kind: 'box',
        layout: 'row',
        children: [
          { kind: 'text', text: summary },
          { kind: 'text', text: LABEL[batch.status], tone: TONE[batch.status] },
        ],
      },
      { kind: 'text', text: `Added ${batch.inboundDate} · Expires ${batch.expirationDate}`, tone: 'muted' },
      {
        kind: 'box',
        layout: 'actions',
        children: [
          {
            kind: 'button',
            label: 'Edit quantity',
            icon: 'pencil',
            event: { ns: 'inventory', name: 'editBatchQuantity', payload: { batch, foodType: dto } },
          },
          { kind: 'button', label: 'Remove batch', tone: 'remove', icon: 'trash', event: { ns: 'inventory', name: 'removeBatch', payload: { batch, summary } } },
        ],
      },
    ],
  };
}

function detailOf(dto: FoodTypeDetailDto): RenderTree[] {
  const overall = dto.overall;
  const status: RenderTree[] =
    overall === null
      ? [{ kind: 'text', text: '—', tone: 'muted' }]
      : [
          { kind: 'text', text: breakdown(dto), tone: 'muted' },
          { kind: 'text', text: LABEL[overall], tone: TONE[overall] },
        ];
  return [
    {
      kind: 'box',
      layout: 'spotlight',
      children: [
        { kind: 'text', text: dto.name, tone: 'title' },
        {
          kind: 'box',
          layout: 'caption',
          children: [
            { kind: 'text', text: dto.categoryPath.join(' → '), tone: 'chip' },
            { kind: 'text', text: `Unit: ${dto.unit}`, tone: 'chip' },
          ],
        },
        { kind: 'box', layout: 'row', children: [{ kind: 'text', text: `Total: ${dto.total / 1000} ${dto.unit}`, tone: 'figure' }, ...status] },
        {
          kind: 'text',
          text: `Near-expiry threshold: ${days(dto.threshold.days)} (${SOURCE[dto.threshold.source]})`,
          tone: 'muted',
          icon: 'hourglass',
        },
        {
          kind: 'box',
          layout: 'actions',
          children: [
            { kind: 'button', label: 'Add batch', tone: 'primary', icon: 'plus', event: { ns: 'inventory', name: 'addBatch', payload: { foodTypeId: dto.foodTypeId } } },
            { kind: 'button', label: 'Edit Food Type', icon: 'pencil', event: { ns: 'foodType', name: 'editFoodType', payload: { foodType: dto } } },
            { kind: 'button', label: 'Change unit', icon: 'swap', event: { ns: 'unitConversion', name: 'changeUnit', payload: { foodType: dto } } },
            {
              kind: 'button',
              label: 'Delete Food Type',
              tone: 'remove',
              icon: 'trash',
              event: { ns: 'foodTypeDelete', name: 'deleteFoodType', payload: { foodType: dto } },
            },
          ],
        },
      ],
    },
    { kind: 'text', text: 'Batches', tone: 'title' },
    dto.batches.length === 0
      ? { kind: 'text', text: 'No batches', tone: 'empty', icon: 'fridge' }
      : { kind: 'box', layout: 'cards', children: dto.batches.map((batch) => batchOf(dto, batch)) },
  ];
}

/**
 * FU-05 FoodTypeDetailView. Draws one Food Type (spec 4.7.2, blueprint 1.8): its header with the
 * category path, the unit, the total quantity, the status breakdown and badge, and the effective
 * near-expiry threshold with the level that decided it; the actions on the Food Type (add a batch,
 * edit, change unit, delete); and every batch with the computed text of spec 4.2.1, its dates, its
 * status badge, and the actions on the batch (edit its quantity, remove it). A Food Type with no
 * batch says "No batches". The batches come in the order that the backend sorted them.
 *
 * A button that opens a form carries the record that the form is about: the batch and the Food Type of
 * a quantity edit, the Food Type of an edit, a unit change and a deletion (its batches and the recipes
 * that it would block are in it), and the batch with the line that describes it for a removal.
 */
export function foodTypeDetailView(resource: ResourceState<FoodTypeDetailDto>): RenderTree {
  const { data } = resource.context;
  const back: RenderTree = {
    kind: 'button',
    label: 'Back to inventory',
    tone: 'quiet',
    icon: 'left',
    event: { ns: 'shell', name: 'navigate', payload: { tab: 'inventory', detail: null } },
  };
  let body: RenderTree[] = [];
  if (resource.value === 'loading' && data === null) body = [{ kind: 'text', text: 'Loading…', tone: 'muted' }];
  else if (resource.value === 'failed') body = [{ kind: 'text', text: 'Could not load this Food Type.', tone: 'badNote' }];
  else if ((resource.value === 'ready' || resource.value === 'loading') && data !== null) body = detailOf(data);
  if (resource.value === 'idle') return { kind: 'box', layout: 'stack', children: [] };
  return { kind: 'box', layout: 'stack', children: [{ kind: 'box', layout: 'row', children: [back] }, ...body] };
}
