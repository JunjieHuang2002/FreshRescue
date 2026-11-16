import { assign, getNextSnapshot, setup } from 'xstate';
import type { FieldHints, FormAction, FormMode, FormState, FormValues } from '@freshrescue/contract-ui';

type Context = FormState['context'];
type Act<T extends FormAction['type']> = Extract<FormAction, { type: T }>;

const CLOSED: Context = { kind: null, values: {}, options: {}, hints: {}, returnTo: 'editing' };

// A row of a `rows` field has the keys `<group>.<index>.<field>`, so the rows are counted from the keys.
const rowCount = (values: FormValues, group: string): number => {
  const prefix = `${group}.`;
  let count = 0;
  for (const key of Object.keys(values)) {
    if (!key.startsWith(prefix)) continue;
    const index = Number.parseInt(key.slice(prefix.length), 10);
    if (Number.isInteger(index)) count = Math.max(count, index + 1);
  }
  return count;
};

const hasRow = (values: FormValues, group: string, index: number): boolean =>
  Number.isInteger(index) && index >= 0 && index < rowCount(values, group);

const without = (hints: FieldHints, key: string): FieldHints =>
  Object.fromEntries(Object.entries(hints).filter(([name]) => name !== key));

const ROW_FOOD_TYPE = /^(.+)\.(\d+)\.foodTypeId$/;

// Typing a text sets it, and drops the hint beside it, which no longer describes the new text.
// Picking a Food Type in a row of a form that offers `<group>.unitOf` (the unit of each Food Type, as
// entries of value = Food Type id and label = unit) also sets the unit of that row to the Food Type's
// own unit: spec section 3, "a Required Unit ... defaults to the Food Type's current unit".
function edited(context: Context, event: Act<'edit'>): Partial<Context> {
  const values: Record<string, string> = { ...context.values, [event.field]: event.value };
  const row = ROW_FOOD_TYPE.exec(event.field);
  const group = row?.[1];
  const index = row?.[2];
  if (group !== undefined && index !== undefined) {
    const own = context.options[`${group}.unitOf`]?.find((entry) => entry.value === event.value);
    if (own !== undefined) values[`${group}.${index}.unit`] = own.label;
  }
  return { values, hints: without(context.hints, event.field) };
}

function rowAdded(context: Context, event: Act<'addRow'>): Partial<Context> {
  const next = rowCount(context.values, event.group);
  const values: Record<string, string> = { ...context.values };
  for (const field of event.fields) values[`${event.group}.${next}.${field}`] = '';
  return { values, hints: without(context.hints, event.group) };
}

// Removing a row closes the gap: the rows after it move up one place, so the rows stay 0, 1, 2 ...
// The hints of the group are dropped, because the rows they were about have moved.
function rowRemoved(context: Context, event: Act<'removeRow'>): Partial<Context> {
  const prefix = `${event.group}.`;
  const values: Record<string, string> = {};
  for (const [key, text] of Object.entries(context.values)) {
    const row = key.startsWith(prefix) ? /^(\d+)\.(.+)$/.exec(key.slice(prefix.length)) : null;
    if (row === null) {
      values[key] = text;
      continue;
    }
    const position = Number(row[1]);
    if (position < event.index) values[key] = text;
    else if (position > event.index) values[`${prefix}${position - 1}.${row[2]}`] = text;
  }
  const hints = Object.fromEntries(Object.entries(context.hints).filter(([key]) => !key.startsWith(prefix)));
  return { values, hints };
}

// The transition table. A state lists only the actions it handles; every other action leaves the
// state as it is (blueprint 1.1: a slice never fails).
//
//   from \ action  open        edit  refill  addRow  removeRow  close   submitting  rejected         closed
//   closed         editing or  -     -       -       -          -       -           -                -
//                  confirming
//   editing        -           stay  stay    stay    stay       closed  submitting  stay (hints)     -
//   confirming     -           -     -       -       -          closed  submitting  stay (hints)     -
//   submitting     -           -     -       -       -          -       -           editing or       closed
//                                                                                    confirming
//                                                                                    (returnTo, hints)
const machine = setup({
  types: { context: {} as Context, events: {} as FormAction },
}).createMachine({
  id: 'form',
  initial: 'closed',
  context: CLOSED,
  states: {
    closed: {
      on: {
        open: [
          {
            guard: ({ event }) => event.at === 'confirming',
            target: 'confirming',
            actions: assign(({ event }) => ({
              kind: event.kind,
              values: { ...event.prefill.values },
              options: { ...event.prefill.options },
              hints: {},
              returnTo: 'confirming' as const,
            })),
          },
          {
            guard: ({ event }) => event.at === 'editing',
            target: 'editing',
            actions: assign(({ event }) => ({
              kind: event.kind,
              values: { ...event.prefill.values },
              options: { ...event.prefill.options },
              hints: {},
              returnTo: 'editing' as const,
            })),
          },
        ],
      },
    },
    editing: {
      on: {
        edit: { actions: assign(({ context, event }) => edited(context, event)) },
        refill: {
          actions: assign(({ context, event }) => ({
            values: { ...context.values, ...event.prefill.values },
            options: { ...context.options, ...event.prefill.options },
            hints: {},
          })),
        },
        addRow: {
          guard: ({ event }) => event.group !== '' && event.fields.length > 0,
          actions: assign(({ context, event }) => rowAdded(context, event)),
        },
        removeRow: {
          guard: ({ context, event }) => hasRow(context.values, event.group, event.index),
          actions: assign(({ context, event }) => rowRemoved(context, event)),
        },
        rejected: { actions: assign(({ event }) => ({ hints: { ...event.hints } })) },
        submitting: { target: 'submitting', actions: assign({ hints: {} }) },
        close: { target: 'closed', actions: assign(() => CLOSED) },
      },
    },
    confirming: {
      on: {
        rejected: { actions: assign(({ event }) => ({ hints: { ...event.hints } })) },
        submitting: { target: 'submitting', actions: assign({ hints: {} }) },
        close: { target: 'closed', actions: assign(() => CLOSED) },
      },
    },
    submitting: {
      on: {
        rejected: [
          {
            guard: ({ context }) => context.returnTo === 'confirming',
            target: 'confirming',
            actions: assign(({ event }) => ({ hints: { ...event.hints } })),
          },
          { target: 'editing', actions: assign(({ event }) => ({ hints: { ...event.hints } })) },
        ],
        closed: { target: 'closed', actions: assign(() => CLOSED) },
      },
    },
  },
});

/**
 * FS-02 FormSlice. Tracks one form: closed, editing, confirming or submitting (blueprint 1.7). One
 * slice serves a whole screen area, so it shows several forms in turn (the `batch` slice shows
 * `batchAdd` and `batchQty`). It is an XState machine run as a pure function through
 * `getNextSnapshot` on plain `{ value, context }` data. The transition table is above.
 *
 * - `open` fills the form with its initial texts and drop-down entries, in `editing`, or in
 *   `confirming` for a destructive action. The form remembers which of the two it opened in.
 * - `refill` puts new texts and entries into the open form, and keeps the texts that it does not
 *   name, so a Food Type that is picked later does not wipe the quantity already typed.
 * - `addRow` and `removeRow` change the rows of a `rows` field; a row that is not there is illegal.
 * - `rejected` shows hints beside the fields. A form that was submitting goes back to where it was.
 * - `closed` (the request succeeded) and `close` (the person cancelled) reset the form.
 *
 * The input is never changed, and a state that does not handle an action comes back as the very
 * object that went in.
 */
export function formSlice(state: FormState, action: FormAction): FormState {
  const current = machine.resolveState({ value: state.value, context: state.context });
  const next = getNextSnapshot(machine, current, action);
  if (next.value === state.value && next.context === state.context) return state;
  return { value: next.value as FormMode, context: next.context };
}
