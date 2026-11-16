import { assign, getNextSnapshot, setup } from 'xstate';
import type { ResourceAction, ResourceState, ResourceValue } from '@freshrescue/contract-ui';

type Context = ResourceState<unknown>['context'];

const NOTHING: Context = { data: null, error: null };

// The transition table. A state lists only the actions it handles; every other action leaves the
// state as it is (blueprint 1.1: a slice never fails).
//
//   from \ action   idle      loading                    ready                      failed
//   idle            -         loading                    -                          -
//   loading         idle      -                          ready (data kept)          failed (data kept)
//   ready           idle      loading (data kept)        ready (data replaced)      -
//   failed          idle      loading (data kept)        ready                      -
//
// `idle` forgets everything. The last good `data` survives `loading` and `failed`, so a screen can
// keep what it has while a reload runs or after one fails. A late `ready` replaces the data, so two
// overlapping loads end with the newer answer. A reply never revives a slice that was reset to
// `idle`, for example a cook report that was dismissed while the next request was still in flight.
const machine = setup({
  types: { context: {} as Context, events: {} as ResourceAction<unknown> },
}).createMachine({
  id: 'resource',
  initial: 'idle',
  context: NOTHING,
  states: {
    idle: {
      on: {
        loading: { target: 'loading', actions: assign({ error: null }) },
      },
    },
    loading: {
      on: {
        idle: { target: 'idle', actions: assign(() => NOTHING) },
        ready: { target: 'ready', actions: assign(({ event }) => ({ data: event.data, error: null })) },
        failed: { target: 'failed', actions: assign(({ event }) => ({ error: event.error })) },
      },
    },
    ready: {
      on: {
        idle: { target: 'idle', actions: assign(() => NOTHING) },
        loading: { target: 'loading', actions: assign({ error: null }) },
        ready: { target: 'ready', actions: assign(({ event }) => ({ data: event.data, error: null })) },
      },
    },
    failed: {
      on: {
        idle: { target: 'idle', actions: assign(() => NOTHING) },
        loading: { target: 'loading', actions: assign({ error: null }) },
        ready: { target: 'ready', actions: assign(({ event }) => ({ data: event.data, error: null })) },
      },
    },
  },
});

/**
 * FS-01 ResourceSlice. Tracks one remote read: idle, loading, ready or failed (blueprint 1.7). It is
 * an XState machine that is run as a pure function through `getNextSnapshot` on plain
 * `{ value, context }` data, so there is no actor and no state outside the argument. The transition
 * table is above. The input is never changed, and a state that does not handle an action comes back
 * as the very object that went in.
 */
export function resourceSlice<T>(state: ResourceState<T>, action: ResourceAction<T>): ResourceState<T> {
  const current = machine.resolveState({ value: state.value, context: state.context });
  const next = getNextSnapshot(machine, current, action);
  if (next.value === state.value && next.context === state.context) return state;
  return { value: next.value as ResourceValue, context: next.context as ResourceState<T>['context'] };
}
