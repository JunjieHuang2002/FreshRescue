import { describe, expect, it } from 'vitest';
import { FORM_MODES } from '@freshrescue/contract-ui';
import type { FormAction, FormMode, FormState } from '@freshrescue/contract-ui';
import { formSlice } from './formSlice';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

const UNIT_OF = [
  { value: '3', label: 'grams' },
  { value: '4', label: 'pieces' },
  { value: '5', label: 'ml' },
];

const CLOSED: FormState = { value: 'closed', context: { kind: null, values: {}, options: {}, hints: {}, returnTo: 'editing' } };

const ROWS = {
  name: 'Soup',
  'draft.cuisineId': '2',
  'draft.rows.0.foodTypeId': '3',
  'draft.rows.0.quantity': '1.5',
  'draft.rows.0.unit': 'grams',
  'draft.rows.1.foodTypeId': '4',
  'draft.rows.1.quantity': '2',
  'draft.rows.1.unit': 'pieces',
};

const EDITING: FormState = {
  value: 'editing',
  context: {
    kind: 'recipeEdit',
    values: ROWS,
    options: { 'draft.rows.unitOf': UNIT_OF },
    hints: { name: 'old hint', 'draft.rows.1.quantity': 'old row hint' },
    returnTo: 'editing',
  },
};

const CONFIRMING: FormState = {
  value: 'confirming',
  context: { kind: 'batchRemove', values: { id: '7' }, options: {}, hints: { id: 'old' }, returnTo: 'confirming' },
};

const SUBMITTING: FormState = { value: 'submitting', context: { ...EDITING.context, hints: {} } };
const SUBMITTING_CONFIRM: FormState = { value: 'submitting', context: { ...CONFIRMING.context, hints: {} } };

const PREFILL = { values: { quantity: '9' }, options: { unit: [{ value: 'ml', label: 'ml' }] } };

const ACTIONS: Record<FormAction['type'], FormAction> = {
  open: { type: 'open', kind: 'batchQty', prefill: PREFILL, at: 'editing' },
  edit: { type: 'edit', field: 'name', value: 'Stew' },
  refill: { type: 'refill', prefill: { values: { name: 'Reset' }, options: { extra: [{ value: 'x', label: 'X' }] } } },
  addRow: { type: 'addRow', group: 'draft.rows', fields: ['foodTypeId', 'quantity', 'unit'] },
  removeRow: { type: 'removeRow', group: 'draft.rows', index: 0 },
  close: { type: 'close' },
  submitting: { type: 'submitting' },
  rejected: { type: 'rejected', hints: { name: 'New hint' } },
  closed: { type: 'closed' },
};

const ACTION_TYPES = Object.keys(ACTIONS) as FormAction['type'][];

// The transition table of the module: the state after each action, or 'same' when the state does not
// handle the action.
const EXPECTED: Record<FormMode, Record<FormAction['type'], FormState | 'same'>> = {
  closed: {
    open: { value: 'editing', context: { kind: 'batchQty', values: { quantity: '9' }, options: PREFILL.options, hints: {}, returnTo: 'editing' } },
    edit: 'same',
    refill: 'same',
    addRow: 'same',
    removeRow: 'same',
    close: 'same',
    submitting: 'same',
    rejected: 'same',
    closed: 'same',
  },
  editing: {
    open: 'same',
    edit: { value: 'editing', context: { ...EDITING.context, values: { ...ROWS, name: 'Stew' }, hints: { 'draft.rows.1.quantity': 'old row hint' } } },
    refill: {
      value: 'editing',
      context: {
        ...EDITING.context,
        values: { ...ROWS, name: 'Reset' },
        options: { 'draft.rows.unitOf': UNIT_OF, extra: [{ value: 'x', label: 'X' }] },
        hints: {},
      },
    },
    addRow: {
      value: 'editing',
      context: {
        ...EDITING.context,
        values: { ...ROWS, 'draft.rows.2.foodTypeId': '', 'draft.rows.2.quantity': '', 'draft.rows.2.unit': '' },
      },
    },
    removeRow: {
      value: 'editing',
      context: {
        ...EDITING.context,
        values: {
          name: 'Soup',
          'draft.cuisineId': '2',
          'draft.rows.0.foodTypeId': '4',
          'draft.rows.0.quantity': '2',
          'draft.rows.0.unit': 'pieces',
        },
        hints: { name: 'old hint' },
      },
    },
    close: CLOSED,
    submitting: SUBMITTING,
    rejected: { value: 'editing', context: { ...EDITING.context, hints: { name: 'New hint' } } },
    closed: 'same',
  },
  confirming: {
    open: 'same',
    edit: 'same',
    refill: 'same',
    addRow: 'same',
    removeRow: 'same',
    close: CLOSED,
    submitting: SUBMITTING_CONFIRM,
    rejected: { value: 'confirming', context: { ...CONFIRMING.context, hints: { name: 'New hint' } } },
    closed: 'same',
  },
  submitting: {
    open: 'same',
    edit: 'same',
    refill: 'same',
    addRow: 'same',
    removeRow: 'same',
    close: 'same',
    submitting: 'same',
    rejected: { value: 'editing', context: { ...EDITING.context, hints: { name: 'New hint' } } },
    closed: CLOSED,
  },
};

const STATES: Record<FormMode, FormState> = {
  closed: CLOSED,
  editing: EDITING,
  confirming: CONFIRMING,
  submitting: SUBMITTING,
};

describe('FS-02 FormSlice', () => {
  for (const from of FORM_MODES) {
    describe(`from ${from}`, () => {
      for (const type of ACTION_TYPES) {
        const expected = EXPECTED[from][type];
        it(expected === 'same' ? `does not handle ${type}: the state is left as it is` : `handles ${type}`, () => {
          const state = deepFreeze(structuredClone(STATES[from]));

          const next = formSlice(state, deepFreeze(structuredClone(ACTIONS[type])));

          if (expected === 'same') expect(next).toBe(state);
          else expect(next).toEqual(expected);
        });
      }
    });
  }

  it('covers every state and every action of the table', () => {
    expect(ACTION_TYPES).toHaveLength(9);
    expect(Object.keys(EXPECTED).sort()).toEqual([...FORM_MODES].sort());
    for (const from of FORM_MODES) expect(Object.keys(EXPECTED[from]).sort()).toEqual([...ACTION_TYPES].sort());
  });

  it('opens a destructive action in confirming and remembers where to return to', () => {
    const opened = formSlice(CLOSED, { type: 'open', kind: 'foodTypeDelete', prefill: { values: { id: '7' }, options: {} }, at: 'confirming' });

    expect(opened).toEqual({ value: 'confirming', context: { kind: 'foodTypeDelete', values: { id: '7' }, options: {}, hints: {}, returnTo: 'confirming' } });
  });

  it('ignores an open at a mode that is neither editing nor confirming', () => {
    const odd = { type: 'open', kind: 'batchQty', prefill: PREFILL, at: 'submitting' } as unknown as FormAction;

    expect(formSlice(CLOSED, odd)).toBe(CLOSED);
  });

  it('returns a rejected submit to where the form was: editing for a form, confirming for a confirmation', () => {
    const hints = { id: 'The Food Type still has batches' };

    expect(formSlice(SUBMITTING, { type: 'rejected', hints }).value).toBe('editing');
    expect(formSlice(SUBMITTING_CONFIRM, { type: 'rejected', hints })).toEqual({
      value: 'confirming',
      context: { ...CONFIRMING.context, hints },
    });
  });

  it('clears the hints when a submit starts, because they describe the earlier attempt', () => {
    expect(formSlice(EDITING, { type: 'submitting' }).context.hints).toEqual({});
    expect(formSlice(CONFIRMING, { type: 'submitting' }).context.hints).toEqual({});
  });

  it('drops only the hint of the field that was typed into', () => {
    const next = formSlice(EDITING, { type: 'edit', field: 'draft.rows.1.quantity', value: '3' });

    expect(next.context.hints).toEqual({ name: 'old hint' });
    expect(next.context.values['draft.rows.1.quantity']).toBe('3');
  });

  it('refills without wiping the texts that the refill does not name', () => {
    const typed = formSlice(
      formSlice(CLOSED, { type: 'open', kind: 'batchAdd', prefill: { values: { foodTypeId: '', quantity: '', unit: '' }, options: {} }, at: 'editing' }),
      { type: 'edit', field: 'quantity', value: '2.5' },
    );

    const picked = formSlice(typed, { type: 'refill', prefill: { values: { foodTypeId: '3', unit: 'grams' }, options: {} } });

    expect(picked.context.values).toEqual({ foodTypeId: '3', quantity: '2.5', unit: 'grams' });
  });

  describe('the rows of a recipe form', () => {
    it('sets the unit of a row to the unit of the Food Type that was picked in it', () => {
      const next = formSlice(EDITING, { type: 'edit', field: 'draft.rows.1.foodTypeId', value: '5' });

      expect(next.context.values['draft.rows.1.foodTypeId']).toBe('5');
      expect(next.context.values['draft.rows.1.unit']).toBe('ml');
      expect(next.context.values['draft.rows.0.unit']).toBe('grams');
    });

    it('leaves the unit alone when the form has no unit for that Food Type, or for a field that is not a Food Type', () => {
      expect(formSlice(EDITING, { type: 'edit', field: 'draft.rows.1.foodTypeId', value: '99' }).context.values['draft.rows.1.unit']).toBe('pieces');
      expect(formSlice(EDITING, { type: 'edit', field: 'draft.rows.1.quantity', value: '5' }).context.values['draft.rows.1.unit']).toBe('pieces');
      expect(formSlice(CONFIRMING, { type: 'edit', field: 'draft.rows.1.foodTypeId', value: '5' })).toBe(CONFIRMING);
    });

    it('adds the first row to a form with none, and numbers a new row after the last', () => {
      const none = { ...EDITING, context: { ...EDITING.context, values: { name: 'Soup' } } };

      expect(formSlice(none, ACTIONS.addRow).context.values).toEqual({
        name: 'Soup',
        'draft.rows.0.foodTypeId': '',
        'draft.rows.0.quantity': '',
        'draft.rows.0.unit': '',
      });
    });

    it('closes the gap when a middle row is removed, and drops the hints of the rows', () => {
      const three = {
        ...EDITING,
        context: {
          ...EDITING.context,
          values: { 'draft.rows.0.quantity': 'a', 'draft.rows.1.quantity': 'b', 'draft.rows.2.quantity': 'c' },
          hints: { 'draft.rows.2.quantity': 'x', name: 'keep' },
        },
      };

      const next = formSlice(three, { type: 'removeRow', group: 'draft.rows', index: 1 });

      expect(next.context.values).toEqual({ 'draft.rows.0.quantity': 'a', 'draft.rows.1.quantity': 'c' });
      expect(next.context.hints).toEqual({ name: 'keep' });
    });

    it('refuses a row that is not there, an empty group and a row without fields', () => {
      for (const action of [
        { type: 'removeRow', group: 'draft.rows', index: 2 },
        { type: 'removeRow', group: 'draft.rows', index: -1 },
        { type: 'removeRow', group: 'draft.rows', index: 0.5 },
        { type: 'removeRow', group: 'other.rows', index: 0 },
        { type: 'addRow', group: '', fields: ['a'] },
        { type: 'addRow', group: 'draft.rows', fields: [] },
      ] as const) {
        expect(formSlice(EDITING, action)).toBe(EDITING);
      }
    });
  });

  it('does not change the state or the action that it is given', () => {
    const state = deepFreeze(structuredClone(EDITING));
    for (const type of ACTION_TYPES) {
      const action = deepFreeze(structuredClone(ACTIONS[type]));

      expect(() => formSlice(state, action)).not.toThrow();
    }
    expect(state).toEqual(EDITING);
  });
});
