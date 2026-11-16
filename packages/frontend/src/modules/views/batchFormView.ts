import type { Choice, FormState, RenderTree } from '@freshrescue/contract-ui';

const EMPTY: RenderTree = { kind: 'box', layout: 'stack', children: [] };

/**
 * FU-06 BatchFormView. Draws the batch form of the `batch` slice (blueprint 1.8): `batchAdd`, to add a
 * batch (spec 4.2.5), and `batchQty`, to edit the quantity of one. A closed form is an empty box.
 *
 * - Add: the Food Type is picked from a list, or left on "New Food Type" to type a name. A Food Type
 *   that is picked shows its unit and category read-only (spec exception 4), and the name, category
 *   and unit fields appear only for a new one, which is why a picked Food Type and a typed name are
 *   never both filled. Then the quantity, and the expiry as a shelf life in days or a date.
 * - Edit: the quantity is the only field of a batch that can change (spec 4.2.1).
 *
 * The hints of the form, by field, sit beside the fields. While the form is submitting, its fields
 * and buttons are disabled.
 */
export function batchFormView(form: FormState): RenderTree {
  const { kind, values, options, hints } = form.context;
  if (form.value === 'closed' || (kind !== 'batchAdd' && kind !== 'batchQty')) return EMPTY;

  const submitting = form.value === 'submitting';
  const text = (key: string): string => values[key] ?? '';
  const hint = (key: string): { readonly hint?: string } => (hints[key] === undefined ? {} : { hint: hints[key] });
  const input = (label: string, field: string, inputType?: 'date'): RenderTree => ({
    kind: 'input',
    label,
    value: text(field),
    event: { ns: 'batch', name: 'edit', payload: { field } },
    ...(inputType === undefined ? {} : { inputType }),
    ...hint(field),
    disabled: submitting,
  });
  const select = (label: string, field: string, pick = false): RenderTree => ({
    kind: 'select',
    label,
    value: text(field),
    choices: options[field] ?? [],
    event: pick ? { ns: 'batch', name: 'pickFoodType', payload: {} } : { ns: 'batch', name: 'edit', payload: { field } },
    ...hint(field),
    disabled: submitting,
  });
  const buttons: RenderTree = {
    kind: 'box',
    layout: 'actions',
    children: [
      {
        kind: 'button',
        label: submitting ? 'Saving…' : 'Save',
        tone: 'primary',
        event: { ns: 'batch', name: 'submit', payload: {} },
        disabled: submitting,
      },
      { kind: 'button', label: 'Cancel', tone: 'quiet', event: { ns: 'batch', name: 'cancel', payload: {} }, disabled: submitting },
    ],
  };

  if (kind === 'batchQty') {
    return {
      kind: 'box',
      layout: 'modal',
      children: [
        { kind: 'box', layout: 'header', children: [{ kind: 'text', text: 'Edit quantity', tone: 'title' }] },
        { kind: 'text', text: `${text('name')} · ${text('unit')}`, tone: 'chip' },
        input('Quantity', 'quantity'),
        { kind: 'text', text: 'Only the quantity of a batch can be changed. To correct a date, remove the batch and add a new one.', tone: 'muted' },
        buttons,
      ],
    };
  }

  const picked = text('foodTypeId') !== '';
  const categories: readonly Choice[] = options.categoryId ?? [];
  const categoryName = categories.find((choice) => choice.value === text('categoryId'))?.label ?? '';
  const whichFoodType: RenderTree[] = picked
    ? [
        { kind: 'text', text: `Unit: ${text('unit')}`, tone: 'chip' },
        { kind: 'text', text: `Category: ${categoryName}`, tone: 'chip' },
        { kind: 'text', text: 'The unit and the category belong to the Food Type. Edit the Food Type to change them.', tone: 'muted' },
      ]
    : [input('New Food Type name', 'foodName'), select('Category', 'categoryId'), select('Unit', 'unit')];
  const byDate = text('expiry.mode') === 'date';

  return {
    kind: 'box',
    layout: 'modal',
    children: [
      { kind: 'box', layout: 'header', children: [{ kind: 'text', text: 'Add batch', tone: 'title' }] },
      select('Food Type', 'foodTypeId', true),
      ...whichFoodType,
      input('Quantity', 'quantity'),
      select('Expiry given as', 'expiry.mode'),
      byDate ? input('Expiration date', 'expiry.date', 'date') : input('Shelf life in days', 'expiry.days'),
      buttons,
    ],
  };
}
