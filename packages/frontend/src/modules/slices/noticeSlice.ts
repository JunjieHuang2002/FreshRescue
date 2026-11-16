import type { NoticeAction, NoticeState } from '@freshrescue/contract-ui';

/**
 * FS-04 NoticeSlice. Tracks the queue of visible notices, oldest first (blueprint 1.7). `push` adds
 * one with the next id and counts the id up, so an id is never reused, not even after a dismiss.
 * `dismiss` removes the notice with that id, and an id that is not in the queue changes nothing.
 */
export function noticeSlice(state: NoticeState, action: NoticeAction): NoticeState {
  switch (action.type) {
    case 'push':
      return {
        items: [...state.items, { id: state.nextId, notice: action.notice }],
        nextId: state.nextId + 1,
      };
    case 'dismiss':
      if (!state.items.some((item) => item.id === action.id)) return state;
      return { items: state.items.filter((item) => item.id !== action.id), nextId: state.nextId };
    default:
      return state;
  }
}
