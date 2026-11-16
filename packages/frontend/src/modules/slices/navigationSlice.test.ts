import { describe, expect, it } from 'vitest';
import { TABS } from '@freshrescue/contract-ui';
import type { NavAction, NavState } from '@freshrescue/contract-ui';
import { navigationSlice } from './navigationSlice';

const HOME: NavState = { tab: 'inventory', detail: null };

describe('FS-03 NavigationSlice', () => {
  it('goes to each of the five tabs', () => {
    expect(TABS).toHaveLength(5);
    for (const tab of TABS.filter((name) => name !== 'inventory')) {
      expect(navigationSlice(HOME, { type: 'go', tab, detail: null })).toEqual({ tab, detail: null });
    }
  });

  it('opens a Food Type detail inside the Inventory tab, and closes it again', () => {
    const open = navigationSlice(HOME, { type: 'go', tab: 'inventory', detail: 7 });

    expect(open).toEqual({ tab: 'inventory', detail: 7 });
    expect(navigationSlice(open, { type: 'go', tab: 'inventory', detail: 8 })).toEqual({ tab: 'inventory', detail: 8 });
    expect(navigationSlice(open, { type: 'go', tab: 'inventory', detail: null })).toEqual(HOME);
  });

  it('closes the detail when another tab is chosen', () => {
    expect(navigationSlice({ tab: 'inventory', detail: 7 }, { type: 'go', tab: 'catalog', detail: null })).toEqual({ tab: 'catalog', detail: null });
  });

  it('returns the very same state when it is already there', () => {
    expect(navigationSlice(HOME, { type: 'go', tab: 'inventory', detail: null })).toBe(HOME);
    const open: NavState = { tab: 'inventory', detail: 7 };

    expect(navigationSlice(open, { type: 'go', tab: 'inventory', detail: 7 })).toBe(open);
  });

  it('refuses what is illegal: a detail outside the Inventory tab, a detail that is not an id, a tab that does not exist', () => {
    const illegal = [
      { type: 'go', tab: 'catalog', detail: 7 },
      { type: 'go', tab: 'inventory', detail: 0 },
      { type: 'go', tab: 'inventory', detail: -3 },
      { type: 'go', tab: 'inventory', detail: 1.5 },
      { type: 'go', tab: 'inventory', detail: Number.NaN },
      { type: 'go', tab: 'sales', detail: null },
      { type: 'leave' },
    ] as unknown as NavAction[];

    for (const action of illegal) expect(navigationSlice(HOME, action)).toBe(HOME);
  });

  it('does not change the state that it is given', () => {
    const state = Object.freeze({ tab: 'inventory', detail: 7 } as const);

    expect(navigationSlice(state, { type: 'go', tab: 'warnings', detail: null })).toEqual({ tab: 'warnings', detail: null });
    expect(state).toEqual({ tab: 'inventory', detail: 7 });
  });
});
