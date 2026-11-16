import { describe, expect, it } from 'vitest';
import type { NoticeAction, NoticeModel, NoticeState } from '@freshrescue/contract-ui';
import { noticeSlice } from './noticeSlice';

const EMPTY: NoticeState = { items: [], nextId: 1 };

const notice = (text: string): NoticeModel => ({ severity: 'error', text, fieldHints: {} });

describe('FS-04 NoticeSlice', () => {
  it('pushes notices oldest first, each with the next id', () => {
    const one = noticeSlice(EMPTY, { type: 'push', notice: notice('one') });
    const two = noticeSlice(one, { type: 'push', notice: notice('two') });

    expect(two).toEqual({
      items: [
        { id: 1, notice: notice('one') },
        { id: 2, notice: notice('two') },
      ],
      nextId: 3,
    });
  });

  it('dismisses the notice with that id and leaves the others in order', () => {
    const three = ['a', 'b', 'c'].reduce<NoticeState>((state, text) => noticeSlice(state, { type: 'push', notice: notice(text) }), EMPTY);

    const after = noticeSlice(three, { type: 'dismiss', id: 2 });

    expect(after.items.map((item) => item.notice.text)).toEqual(['a', 'c']);
    expect(after.nextId).toBe(4);
  });

  it('never reuses an id, not even after a dismiss', () => {
    const one = noticeSlice(EMPTY, { type: 'push', notice: notice('one') });
    const gone = noticeSlice(one, { type: 'dismiss', id: 1 });
    const again = noticeSlice(gone, { type: 'push', notice: notice('again') });

    expect(again.items.map((item) => item.id)).toEqual([2]);
  });

  it('changes nothing when the id is not in the queue', () => {
    const one = noticeSlice(EMPTY, { type: 'push', notice: notice('one') });

    expect(noticeSlice(one, { type: 'dismiss', id: 99 })).toBe(one);
    expect(noticeSlice(EMPTY, { type: 'dismiss', id: 1 })).toBe(EMPTY);
  });

  it('changes nothing for an action that it does not know', () => {
    expect(noticeSlice(EMPTY, { type: 'shout' } as unknown as NoticeAction)).toBe(EMPTY);
  });

  it('does not change the state or the notice that it is given', () => {
    const given = Object.freeze({ severity: 'info' as const, text: 'Saved', fieldHints: Object.freeze({}) });
    const state = Object.freeze({ items: Object.freeze([]), nextId: 1 });

    const next = noticeSlice(state, { type: 'push', notice: given });

    expect(next.items).toEqual([{ id: 1, notice: given }]);
    expect(state).toEqual({ items: [], nextId: 1 });
  });
});
