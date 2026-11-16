import type { FormState, RenderTree } from '@freshrescue/contract-ui';

const EMPTY: RenderTree = { kind: 'box', layout: 'stack', children: [] };

/** The fields that a row of ingredients is drawn with, which a button that adds a row names. */
const ROW_FIELDS = ['foodTypeId', 'quantity', 'unit'] as const;

/**
 * FU-15 RecipeFormView. Draws the form that creates or edits a recipe (blueprint 1.8, spec section 3):
 * the name, the cuisine, and one row for each ingredient with its Food Type, its quantity and its
 * unit. Rows are added and removed with buttons, and the only row of a recipe cannot be removed,
 * because a recipe needs an ingredient. A closed form is an empty box.
 *
 * The rows are the keys `draft.rows.<n>.<field>` of the form values, and the entries of their
 * drop-downs are the options `draft.rows.foodTypeId` and `draft.rows.unit`. The hint of the rows as a
 * whole, "at least one ingredient", is shown above them.
 */
export function recipeFormView(form: FormState): RenderTree {
  const { kind, values, options, hints } = form.context;
  if (form.value === 'closed' || (kind !== 'recipeCreate' && kind !== 'recipeEdit')) return EMPTY;

  const submitting = form.value === 'submitting';
  const text = (key: string): string => values[key] ?? '';
  const hint = (key: string): { readonly hint?: string } => (hints[key] === undefined ? {} : { hint: hints[key] });
  const input = (label: string, field: string): RenderTree => ({
    kind: 'input',
    label,
    value: text(field),
    event: { ns: 'recipe', name: 'edit', payload: { field } },
    ...hint(field),
    disabled: submitting,
  });
  const select = (label: string, field: string, choicesKey: string = field): RenderTree => ({
    kind: 'select',
    label,
    value: text(field),
    choices: options[choicesKey] ?? [],
    event: { ns: 'recipe', name: 'edit', payload: { field } },
    ...hint(field),
    disabled: submitting,
  });

  const indexes = [...new Set(Object.keys(values).map((key) => /^draft\.rows\.(\d+)\./.exec(key)?.[1]).filter((index) => index !== undefined))]
    .map(Number)
    .sort((left, right) => left - right);
  const rows: RenderTree[] = indexes.map((index) => ({
    kind: 'box',
    layout: 'fields',
    children: [
      select('Food Type', `draft.rows.${index}.foodTypeId`, 'draft.rows.foodTypeId'),
      input('Quantity', `draft.rows.${index}.quantity`),
      select('Unit', `draft.rows.${index}.unit`, 'draft.rows.unit'),
      {
        kind: 'button',
        label: 'Remove',
        tone: 'remove',
        icon: 'trash',
        event: { ns: 'recipe', name: 'removeRow', payload: { group: 'draft.rows', index } },
        disabled: submitting || indexes.length <= 1,
      },
    ],
  }));
  const rowsHint = hints['draft.rows'];

  return {
    kind: 'box',
    layout: 'modal',
    children: [
      { kind: 'box', layout: 'header', children: [{ kind: 'text', text: kind === 'recipeEdit' ? 'Edit recipe' : 'New recipe', tone: 'title' }] },
      input('Recipe name', 'name'),
      select('Cuisine', 'draft.cuisineId'),
      { kind: 'text', text: 'Ingredients', tone: 'title' },
      ...(rowsHint === undefined ? [] : [{ kind: 'text', text: rowsHint, tone: 'badNote' } as const]),
      ...rows,
      {
        kind: 'button',
        label: 'Add ingredient',
        tone: 'outline',
        icon: 'plus',
        event: { ns: 'recipe', name: 'addRow', payload: { group: 'draft.rows', fields: ROW_FIELDS } },
        disabled: submitting,
      },
      {
        kind: 'box',
        layout: 'actions',
        children: [
          {
            kind: 'button',
            label: submitting ? 'Saving…' : 'Save',
            tone: 'primary',
            event: { ns: 'recipe', name: 'submit', payload: {} },
            disabled: submitting,
          },
          { kind: 'button', label: 'Cancel', tone: 'quiet', event: { ns: 'recipe', name: 'cancel', payload: {} }, disabled: submitting },
        ],
      },
    ],
  };
}
