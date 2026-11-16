import type { QueueAction, QueueState } from '@freshrescue/contract-ui';

const isId = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

const hasEntry = (state: QueueState, index: unknown): index is number =>
  typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < state.entries.length;

/**
 * FS-06 CookQueueSlice. Tracks the ordered cook queue (blueprint 1.7, spec 4.5). The queue is the
 * order of addition, and the same recipe may be queued more than once: each entry is its own run.
 *
 * - `add` appends an entry (a recipe that is not an id, or has no name, is illegal).
 * - `remove` drops the entry at an index.
 * - `move` swaps an entry with its neighbour, up or down. The first entry cannot go up, and the
 *   last cannot go down.
 * - `prune` drops every entry of a recipe that was deleted (spec 4.5: deleting a recipe removes its
 *   queue entries).
 * - `clear` empties the queue.
 *
 * An illegal action, such as an index that is not in the queue, returns the state unchanged.
 */
export function cookQueueSlice(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'add':
      if (!isId(action.recipeId) || typeof action.recipeName !== 'string') return state;
      return { entries: [...state.entries, { recipeId: action.recipeId, recipeName: action.recipeName }] };
    case 'remove':
      if (!hasEntry(state, action.index)) return state;
      return { entries: state.entries.filter((_entry, position) => position !== action.index) };
    case 'move': {
      if (!hasEntry(state, action.index)) return state;
      const other = action.direction === 'up' ? action.index - 1 : action.direction === 'down' ? action.index + 1 : -1;
      if (!hasEntry(state, other)) return state;
      const entries = [...state.entries];
      const moved = entries[action.index];
      const neighbour = entries[other];
      if (moved === undefined || neighbour === undefined) return state;
      entries[action.index] = neighbour;
      entries[other] = moved;
      return { entries };
    }
    case 'prune': {
      const entries = state.entries.filter((entry) => entry.recipeId !== action.recipeId);
      return entries.length === state.entries.length ? state : { entries };
    }
    case 'clear':
      return state.entries.length === 0 ? state : { entries: [] };
    default:
      return state;
  }
}
