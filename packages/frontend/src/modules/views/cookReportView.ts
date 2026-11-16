import type { SkipReason } from '@freshrescue/contract-rules';
import type { RenderTree, ResourceState } from '@freshrescue/contract-ui';
import type { CookReportDto, CookReportEntry } from '@freshrescue/contract-views';

const REASON: Record<SkipReason, string> = {
  blocked: 'Blocked: a Food Type is missing, or a unit does not match',
  nothingAvailable: 'Nothing available to deduct',
  recipeNotFound: 'The recipe no longer exists',
};

function entryOf(entry: CookReportEntry): RenderTree {
  const cooked = entry.outcome === 'cooked';
  const deducted = entry.deducted.map(
    (line): RenderTree => ({ kind: 'text', text: `Deducted ${line.quantity / 1000} ${line.unit} of ${line.name}`, tone: 'plain', icon: 'check' }),
  );
  const missing = entry.missing.map(
    (line): RenderTree => ({
      kind: 'text',
      text: `Missing ${line.name}: needed ${line.needed / 1000} ${line.unit}, available ${line.available / 1000}, so none was deducted`,
      tone: 'warnNote',
    }),
  );
  const why: RenderTree[] = entry.reason === null ? [] : [{ kind: 'text', text: REASON[entry.reason], tone: 'muted' }];
  return {
    kind: 'box',
    layout: 'entry',
    children: [
      {
        kind: 'box',
        layout: 'row',
        children: [
          { kind: 'text', text: entry.recipeName, tone: 'title' },
          { kind: 'text', text: cooked ? 'Cooked' : 'Skipped', tone: cooked ? 'good' : 'warn' },
        ],
      },
      ...why,
      ...deducted,
      ...missing,
    ],
  };
}

/**
 * FU-14 CookReportView. Draws the result of Cook & Deduct (spec 4.5 rule 4, blueprint 1.8): for each
 * queued recipe, in queue order, whether it was cooked or skipped, the ingredients that were
 * deducted with their quantity and unit, the ingredients that were skipped as Missing with what was
 * needed and what was available, and the reason for a skipped recipe: "Nothing available to deduct"
 * (exception 16), blocked, or no longer there (a stale id, spec: the run is not failed by it). A
 * Dismiss button closes the report, which opens over the page as a sheet.
 */
export function cookReportView(resource: ResourceState<CookReportDto>): RenderTree {
  const { data } = resource.context;
  if (resource.value === 'idle') return { kind: 'box', layout: 'stack', children: [] };
  let body: RenderTree[] = [];
  if (resource.value === 'loading' && data === null) body = [{ kind: 'text', text: 'Cooking…', tone: 'muted' }];
  else if (resource.value === 'failed') body = [{ kind: 'text', text: 'The recipes could not be cooked.', tone: 'badNote' }];
  else if (data !== null) {
    body = [
      ...(data.reports.length === 0 ? [{ kind: 'text', text: 'Nothing was in the queue.', tone: 'muted' } as const] : data.reports.map(entryOf)),
      {
        kind: 'box',
        layout: 'actions',
        children: [{ kind: 'button', label: 'Dismiss', tone: 'primary', event: { ns: 'cook', name: 'dismiss', payload: {} } }],
      },
    ];
  }
  const title: RenderTree = { kind: 'box', layout: 'header', children: [{ kind: 'text', text: 'Cook report', tone: 'title', icon: 'done' }] };
  return { kind: 'box', layout: 'modal', children: [title, ...body] };
}
