import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import { RESOURCE_VALUES } from '@freshrescue/contract-ui';
import type { ResourceAction, ResourceState, ResourceValue } from '@freshrescue/contract-ui';
import { resourceSlice } from './resourceSlice';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

type S = ResourceState<number>;
type A = ResourceAction<number>;

const NETWORK: DomainError = { code: 'NETWORK_ERROR' };
const TIMEOUT: DomainError = { code: 'TIMEOUT' };

// Each state holds the figure 5, except `idle`, which has forgotten everything.
const STATES: Record<ResourceValue, S> = {
  idle: { value: 'idle', context: { data: null, error: null } },
  loading: { value: 'loading', context: { data: 5, error: null } },
  ready: { value: 'ready', context: { data: 5, error: null } },
  failed: { value: 'failed', context: { data: 5, error: NETWORK } },
};

const ACTIONS = {
  idle: { type: 'idle' },
  loading: { type: 'loading' },
  ready: { type: 'ready', data: 9 },
  failed: { type: 'failed', error: TIMEOUT },
} as const satisfies Record<ResourceValue, A>;

const LOADING_KEEPING_5: S = { value: 'loading', context: { data: 5, error: null } };
const READY_9: S = { value: 'ready', context: { data: 9, error: null } };

// The transition table of the module: the state after each action, or 'same' when the state does not
// handle the action.
const EXPECTED: Record<ResourceValue, Record<ResourceValue, S | 'same'>> = {
  idle: {
    idle: 'same',
    loading: { value: 'loading', context: { data: null, error: null } },
    ready: 'same',
    failed: 'same',
  },
  loading: {
    idle: STATES.idle,
    loading: 'same',
    ready: READY_9,
    failed: { value: 'failed', context: { data: 5, error: TIMEOUT } },
  },
  ready: {
    idle: STATES.idle,
    loading: LOADING_KEEPING_5,
    ready: READY_9,
    failed: 'same',
  },
  failed: {
    idle: STATES.idle,
    loading: LOADING_KEEPING_5,
    ready: READY_9,
    failed: 'same',
  },
};

describe('FS-01 ResourceSlice', () => {
  for (const from of RESOURCE_VALUES) {
    describe(`from ${from}`, () => {
      for (const action of RESOURCE_VALUES) {
        const expected = EXPECTED[from][action];
        it(expected === 'same' ? `does not handle ${action}: the state is left as it is` : `handles ${action}`, () => {
          const state = deepFreeze(structuredClone(STATES[from]));

          const next = resourceSlice(state, deepFreeze(structuredClone<A>(ACTIONS[action])));

          if (expected === 'same') expect(next).toBe(state);
          else expect(next).toEqual(expected);
        });
      }
    });
  }

  it('covers every state and every action of the table', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...RESOURCE_VALUES].sort());
    for (const from of RESOURCE_VALUES) expect(Object.keys(EXPECTED[from]).sort()).toEqual([...RESOURCE_VALUES].sort());
  });

  it('runs a whole read: idle, loading, ready, then a refresh that fails keeps the last good data', () => {
    let state: S = STATES.idle;
    state = resourceSlice(state, { type: 'loading' });
    expect(state.value).toBe('loading');
    state = resourceSlice(state, { type: 'ready', data: 7 });
    expect(state).toEqual({ value: 'ready', context: { data: 7, error: null } });
    state = resourceSlice(state, { type: 'loading' });
    expect(state).toEqual({ value: 'loading', context: { data: 7, error: null } });
    state = resourceSlice(state, { type: 'failed', error: NETWORK });
    expect(state).toEqual({ value: 'failed', context: { data: 7, error: NETWORK } });
    state = resourceSlice(state, { type: 'idle' });
    expect(state).toEqual(STATES.idle);
  });

  it('does not let a late reply revive a slice that was reset to idle', () => {
    const dismissed = resourceSlice(STATES.ready, { type: 'idle' });

    expect(resourceSlice(dismissed, { type: 'ready', data: 3 })).toBe(dismissed);
    expect(resourceSlice(dismissed, { type: 'failed', error: NETWORK })).toBe(dismissed);
  });

  it('lets the newer of two overlapping loads win', () => {
    const afterFirst = resourceSlice(resourceSlice(STATES.idle, { type: 'loading' }), { type: 'ready', data: 1 });

    expect(resourceSlice(afterFirst, { type: 'ready', data: 2 }).context.data).toBe(2);
  });

  it('keeps the type of the data it holds', () => {
    expectTypeOf(resourceSlice<number>).returns.toEqualTypeOf<ResourceState<number>>();
    const rows: ResourceState<{ readonly rows: readonly string[] }> = { value: 'idle', context: { data: null, error: null } };

    expect(resourceSlice(rows, { type: 'loading' }).value).toBe('loading');
  });
});
