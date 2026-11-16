import type { FormKind, FormState, FormValues, RenderTree, UiEventDescriptor, UiNamespace } from '@freshrescue/contract-ui';

const EMPTY: RenderTree = { kind: 'box', layout: 'stack', children: [] };

/**
 * The four confirmations: removing a batch, and deleting a Food Type, a category or a recipe. The kind
 * of each one is also the namespace of its slice, which its buttons send their events to. `satisfies`
 * makes a name that is not both a kind of form and a namespace a compile error.
 */
const CONFIRMATIONS = ['batchRemove', 'foodTypeDelete', 'categoryDelete', 'recipeDelete'] as const satisfies readonly (FormKind & UiNamespace)[];

type Confirmation = (typeof CONFIRMATIONS)[number];

const isConfirmation = (kind: FormKind | null): kind is Confirmation => (CONFIRMATIONS as readonly (FormKind | null)[]).includes(kind);

/** The lines of the dialog: the values `lines.0`, `lines.1` and so on, in the order of their numbers, so `lines.10` comes after `lines.9`. */
function linesOf(values: FormValues): string[] {
  const numbered = Object.entries(values).flatMap(([key, line]) => {
    const found = /^lines\.(\d+)$/.exec(key);
    return found === null ? [] : [{ index: Number(found[1]), line }];
  });
  return numbered.sort((a, b) => a.index - b.index).map((each) => each.line);
}

/**
 * FU-09 ConfirmDialogView. Draws the dialog of one of the four confirmations (blueprint 1.8), from the
 * form of that confirmation, as every form view does. The words of the dialog are among the values
 * that FormPrefillBuilder wrote: the `title`, the `confirmLabel` of the Confirm button (`Confirm` if
 * there is none) and a line for each thing that the person should know, `lines.0`, `lines.1` and so
 * on. The Confirm and Cancel buttons send `submit` and `cancel` to the slice that holds the form. A
 * closed form is an empty box, and so is a form that is not a confirmation, which another view draws.
 * While the form is submitting, both buttons are disabled.
 */
export function confirmDialogView(form: FormState): RenderTree {
  const { kind, values } = form.context;
  if (form.value === 'closed' || !isConfirmation(kind)) return EMPTY;

  const submitting = form.value === 'submitting';
  const event = (name: 'submit' | 'cancel'): UiEventDescriptor => ({ ns: kind, name, payload: {} });
  return {
    kind: 'box',
    layout: 'modal',
    children: [
      { kind: 'box', layout: 'header', children: [{ kind: 'text', text: values.title ?? '', tone: 'title', icon: 'alarm' }] },
      ...linesOf(values).map((line): RenderTree => ({ kind: 'text', text: line })),
      {
        kind: 'box',
        layout: 'actions',
        children: [
          { kind: 'button', label: values.confirmLabel ?? 'Confirm', tone: 'danger', event: event('submit'), disabled: submitting },
          { kind: 'button', label: 'Cancel', tone: 'quiet', event: event('cancel'), disabled: submitting },
        ],
      },
    ],
  };
}
