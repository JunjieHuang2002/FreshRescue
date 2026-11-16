import type { FormState, RenderTree } from '@freshrescue/contract-ui';

const EMPTY: RenderTree = { kind: 'box', layout: 'stack', children: [] };

/**
 * FU-07 FoodTypeFormView. Draws the form that creates or edits a Food Type (blueprint 1.8, spec
 * 4.2.5): the name, the category, the unit and the custom near-expiry threshold. A new Food Type
 * needs a unit. An existing one shows its unit read-only, because the unit changes only through the
 * conversion modal that asks for every batch. An empty threshold clears it, so the Food Type
 * inherits one. A closed form is an empty box.
 */
export function foodTypeFormView(form: FormState): RenderTree {
  const { kind, values, options, hints } = form.context;
  if (form.value === 'closed' || (kind !== 'foodTypeCreate' && kind !== 'foodTypeEdit')) return EMPTY;

  const submitting = form.value === 'submitting';
  const editing = kind === 'foodTypeEdit';
  const text = (key: string): string => values[key] ?? '';
  const hint = (key: string): { readonly hint?: string } => (hints[key] === undefined ? {} : { hint: hints[key] });
  const input = (label: string, field: string): RenderTree => ({
    kind: 'input',
    label,
    value: text(field),
    event: { ns: 'foodType', name: 'edit', payload: { field } },
    ...hint(field),
    disabled: submitting,
  });
  const select = (label: string, field: string): RenderTree => ({
    kind: 'select',
    label,
    value: text(field),
    choices: options[field] ?? [],
    event: { ns: 'foodType', name: 'edit', payload: { field } },
    ...hint(field),
    disabled: submitting,
  });
  const unit: RenderTree[] = editing
    ? [
        { kind: 'text', text: `Unit: ${text('unit')}`, tone: 'chip' },
        { kind: 'text', text: 'To change the unit, use Change unit on the Food Type: it asks for the new quantity of every batch.', tone: 'muted' },
      ]
    : [select('Unit', 'unit')];

  return {
    kind: 'box',
    layout: 'modal',
    children: [
      { kind: 'box', layout: 'header', children: [{ kind: 'text', text: editing ? 'Edit Food Type' : 'Add Food Type', tone: 'title' }] },
      input('Name', 'name'),
      select('Category', 'categoryId'),
      ...unit,
      input('Near-expiry threshold in days', 'thresholdDays'),
      { kind: 'text', text: 'Leave the threshold empty to use the one of its category, or the default.', tone: 'muted' },
      {
        kind: 'box',
        layout: 'actions',
        children: [
          {
            kind: 'button',
            label: submitting ? 'Saving…' : 'Save',
            tone: 'primary',
            event: { ns: 'foodType', name: 'submit', payload: {} },
            disabled: submitting,
          },
          { kind: 'button', label: 'Cancel', tone: 'quiet', event: { ns: 'foodType', name: 'cancel', payload: {} }, disabled: submitting },
        ],
      },
    ],
  };
}
