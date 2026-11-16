import { LIMITS } from '@freshrescue/contract-rules';
import type { FormState, RenderTree } from '@freshrescue/contract-ui';

const EMPTY: RenderTree = { kind: 'box', layout: 'stack', children: [] };

/** A quantity that can be saved: decimal text of at most 3 decimals, above 0 and within the cap (spec section 3). */
function isQuantity(raw: string): boolean {
  const text = raw.trim();
  const match = /^(\d*)(?:\.(\d{0,3}))?$/.exec(text);
  if (match === null || (match[1] === '' && (match[2] ?? '') === '')) return false;
  const quantity = Number(text);
  return quantity > 0 && quantity <= LIMITS.QTY_MAX_MILLI / 1000;
}

/**
 * FU-08 UnitConversionModalView. Draws the modal of a unit change (spec 4.2.2, exception 5,
 * blueprint 1.8): the new unit, and one field for the new quantity of every batch, Expired ones
 * included, each labelled with what the batch holds now. A Food Type with no batch shows only the
 * unit. Saving stays disabled until the unit is chosen and every quantity can be saved, and Cancel
 * changes nothing. A closed form is an empty box.
 */
export function unitConversionModalView(form: FormState): RenderTree {
  const { kind, values, options, hints } = form.context;
  if (form.value === 'closed' || kind !== 'unitChange') return EMPTY;

  const submitting = form.value === 'submitting';
  const text = (key: string): string => values[key] ?? '';
  const hint = (key: string): { readonly hint?: string } => (hints[key] === undefined ? {} : { hint: hints[key] });
  const rows = Object.keys(values).filter((key) => /^batches\.\d+\.quantity$/.test(key));
  const complete = text('unit') !== '' && rows.every((key) => isQuantity(text(key)));
  const batches: RenderTree[] = rows.map((key) => ({
    kind: 'input',
    label: text(key.replace(/quantity$/, 'label')),
    value: text(key),
    event: { ns: 'unitConversion', name: 'edit', payload: { field: key } },
    ...hint(key),
    disabled: submitting,
  }));

  return {
    kind: 'box',
    layout: 'modal',
    children: [
      { kind: 'box', layout: 'header', children: [{ kind: 'text', text: `Change unit of ${text('name')}`, tone: 'title' }] },
      { kind: 'text', text: `Now in ${text('fromUnit')}.`, tone: 'muted' },
      {
        kind: 'select',
        label: 'New unit',
        value: text('unit'),
        choices: options.unit ?? [],
        event: { ns: 'unitConversion', name: 'edit', payload: { field: 'unit' } },
        ...hint('unit'),
        disabled: submitting,
      },
      ...(rows.length === 0
        ? []
        : [
            { kind: 'text', text: 'Enter the quantity of every batch in the new unit. Nothing is converted for you.', tone: 'muted' } as const,
            ...batches,
          ]),
      {
        kind: 'box',
        layout: 'actions',
        children: [
          {
            kind: 'button',
            label: submitting ? 'Saving…' : 'Save',
            tone: 'primary',
            event: { ns: 'unitConversion', name: 'submit', payload: {} },
            disabled: submitting || !complete,
          },
          { kind: 'button', label: 'Cancel', tone: 'quiet', event: { ns: 'unitConversion', name: 'cancel', payload: {} }, disabled: submitting },
        ],
      },
    ],
  };
}
