import { TABS } from '@freshrescue/contract-ui';
import type { NavAction, NavState } from '@freshrescue/contract-ui';

const isId = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/**
 * FS-03 NavigationSlice. Tracks the active tab and the Food Type detail that is open (blueprint 1.7).
 * `go` sets both. A detail belongs to the Inventory tab, so a `go` that opens one on another tab, a
 * `go` to a tab that does not exist, and a detail that is not an id are all illegal, and an illegal
 * action returns the state unchanged. Going where the slice already is returns the same state.
 */
export function navigationSlice(state: NavState, action: NavAction): NavState {
  if (action.type !== 'go') return state;
  if (!TABS.includes(action.tab)) return state;
  if (action.detail !== null && (action.tab !== 'inventory' || !isId(action.detail))) return state;
  if (action.tab === state.tab && action.detail === state.detail) return state;
  return { tab: action.tab, detail: action.detail };
}
