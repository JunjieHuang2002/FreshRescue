import { describe, expect, it } from 'vitest';
import { FORM_KINDS } from '@freshrescue/contract-ui';
import type { FormKind, FormMode, FormState, FormValues } from '@freshrescue/contract-ui';
import { CLOSED_FORM, formOf } from '../../testing/fixtures';
import { eventsOf, findButton, nodesOf, problemsOf, renderText } from '../../testing/render';
import { confirmDialogView } from './confirmDialogView';

const EMPTY = { kind: 'box', layout: 'stack', children: [] };

const CONFIRMATIONS = ['batchRemove', 'foodTypeDelete', 'categoryDelete', 'recipeDelete'] as const;

// the values that FormPrefillBuilder writes to delete Chicken: the id that the parser reads, and the words of the dialog
const VALUES: FormValues = {
  id: '22',
  title: 'Delete Chicken?',
  confirmLabel: 'Delete Food Type',
  'lines.0': 'These recipes will become blocked: Chicken Fried Rice.',
  'lines.1': 'Its threshold is deleted with it.',
};

const confirmation = (values: FormValues = VALUES, kind: FormKind = 'foodTypeDelete', mode: Exclude<FormMode, 'closed'> = 'confirming'): FormState =>
  formOf(kind, values, {}, mode);

const textsOf = (form: FormState): string[] => nodesOf(confirmDialogView(form)).flatMap((node) => (node.kind === 'text' ? [node.text] : []));

describe('FU-09 ConfirmDialogView', () => {
  it('draws nothing when no confirmation is open', () => {
    expect(confirmDialogView(CLOSED_FORM)).toEqual(EMPTY);
  });

  it('draws nothing for a closed form, even one that still holds the words of its last dialog', () => {
    expect(confirmDialogView({ ...confirmation(), value: 'closed' })).toEqual(EMPTY);
  });

  it('draws nothing for a form that is not a confirmation, which another view draws', () => {
    const others = FORM_KINDS.filter((kind) => !(CONFIRMATIONS as readonly FormKind[]).includes(kind));

    expect(others).toHaveLength(11);
    for (const kind of others) expect(confirmDialogView(confirmation(VALUES, kind)), kind).toEqual(EMPTY);
  });

  it('draws the title, a line for each thing to know, and the two buttons', () => {
    const tree = confirmDialogView(confirmation());
    const text = renderText(tree);

    expect(problemsOf(tree)).toEqual([]);
    expect(text).toContain('box modal');
    expect(text).toContain('box actions');
    expect(text).toContain('text: Delete Chicken? (title)');
    expect(text).toContain('text: These recipes will become blocked: Chicken Fried Rice.');
    expect(text).toContain('text: Its threshold is deleted with it.');
    expect(findButton(tree, 'Delete Food Type')).toMatchObject({ tone: 'danger', disabled: false });
    expect(findButton(tree, 'Cancel')).toMatchObject({ disabled: false });
  });

  it('sends Confirm and Cancel to the slice of the confirmation that is open, and to no other', () => {
    for (const kind of CONFIRMATIONS) {
      const tree = confirmDialogView(confirmation(VALUES, kind));

      expect(eventsOf(tree), kind).toEqual([
        { ns: kind, name: 'submit', payload: {} },
        { ns: kind, name: 'cancel', payload: {} },
      ]);
      expect(problemsOf(tree), kind).toEqual([]);
    }
  });

  it('is drawn in every mode that is open, and disables both buttons while it is submitting', () => {
    for (const mode of ['editing', 'confirming', 'submitting'] as const) {
      const tree = confirmDialogView(confirmation(VALUES, 'foodTypeDelete', mode));
      const disabled = mode === 'submitting';

      expect(findButton(tree, 'Delete Food Type'), mode).toMatchObject({ disabled });
      expect(findButton(tree, 'Cancel'), mode).toMatchObject({ disabled });
    }
  });

  it('labels the Confirm button with the label in the values, and with Confirm when there is none', () => {
    expect(findButton(confirmDialogView(confirmation({ ...VALUES, confirmLabel: 'Remove batch' })), 'Remove batch')).toBeDefined();

    const bare = confirmDialogView(confirmation({ id: '22' }));

    expect(problemsOf(bare)).toEqual([]);
    expect(findButton(bare, 'Confirm')).toMatchObject({ tone: 'danger' });
    expect(eventsOf(bare).map((each) => each.name)).toEqual(['submit', 'cancel']);
  });

  it('draws a dialog with no lines', () => {
    const form = confirmation({ id: '22', title: 'Delete Chicken?', confirmLabel: 'Delete Food Type' });

    expect(problemsOf(confirmDialogView(form))).toEqual([]);
    expect(textsOf(form)).toEqual(['Delete Chicken?']);
  });

  it('reads the lines in the order of their numbers, so lines.10 comes after lines.9, and reads nothing else as a line', () => {
    // inserted from the last to the first, so that only the numbers put them in order
    const numbered = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`lines.${11 - index}`, `line ${11 - index}`]));
    const form = confirmation({
      id: '22',
      title: 'Title',
      confirmLabel: 'Go',
      ...numbered,
      'lines.x': 'not numbered',
      'lines.': 'nothing after the point',
      lines_5: 'another separator',
      'lines.2.more': 'a longer key',
      'old.lines.3': 'a longer prefix',
      lines: 'no number',
      note: 'another value',
    });

    expect(textsOf(form)).toEqual(['Title', ...Array.from({ length: 12 }, (_, index) => `line ${index}`)]);
  });
});
