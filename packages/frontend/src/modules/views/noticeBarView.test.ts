import { describe, expect, it } from 'vitest';
import type { NoticeItem } from '@freshrescue/contract-ui';
import { eventsOf, nodesOf, problemsOf, renderText } from '../../testing/render';
import { noticeBarView } from './noticeBarView';

const ITEMS: readonly NoticeItem[] = [
  { id: 4, notice: { severity: 'error', text: 'Cannot reach the server.', fieldHints: {} } },
  { id: 5, notice: { severity: 'warning', text: 'Remove all 3 batches first.', fieldHints: {} } },
  { id: 6, notice: { severity: 'info', text: 'Saved.', fieldHints: {} } },
];

describe('FU-02 NoticeBarView', () => {
  it('draws nothing when there is no notice, so a dismissed notice leaves nothing behind', () => {
    const tree = noticeBarView([]);

    expect(problemsOf(tree)).toEqual([]);
    expect(tree).toEqual({ kind: 'box', layout: 'stack', children: [] });
  });

  it('draws each notice, oldest first, with its text', () => {
    const tree = noticeBarView(ITEMS);
    const texts = nodesOf(tree).flatMap((node) => (node.kind === 'text' ? [node.text] : []));

    expect(problemsOf(tree)).toEqual([]);
    expect(texts).toEqual(['Cannot reach the server.', 'Remove all 3 batches first.', 'Saved.']);
  });

  it('colours a notice by its severity', () => {
    const text = renderText(noticeBarView(ITEMS));

    expect(text).toContain('text: Cannot reach the server. (bad)');
    expect(text).toContain('text: Remove all 3 batches first. (warn)');
    expect(text).toContain('text: Saved. (info)');
  });

  it('gives each notice a Dismiss button that carries the id of that notice', () => {
    const events = eventsOf(noticeBarView(ITEMS));

    expect(events).toEqual([
      { ns: 'shell', name: 'dismiss', payload: { noticeId: 4 } },
      { ns: 'shell', name: 'dismiss', payload: { noticeId: 5 } },
      { ns: 'shell', name: 'dismiss', payload: { noticeId: 6 } },
    ]);
  });
});
