import type { NoticeItem, RenderTree, Severity, Tone } from '@freshrescue/contract-ui';

const TONE_OF: Record<Severity, Tone> = { error: 'bad', warning: 'warn', info: 'info' };

/**
 * FU-02 NoticeBarView. Draws the visible notices, oldest first, each with a Dismiss button that
 * carries its id (blueprint 1.8). The colour of a notice follows its severity. With no notice the
 * bar is an empty box, so a notice that was dismissed leaves nothing behind.
 */
export function noticeBarView(items: readonly NoticeItem[]): RenderTree {
  return {
    kind: 'box',
    layout: 'stack',
    children: items.map(
      ({ id, notice }): RenderTree => ({
        kind: 'box',
        layout: 'banner',
        children: [
          { kind: 'text', text: notice.text, tone: TONE_OF[notice.severity] },
          { kind: 'button', label: 'Dismiss', tone: 'quiet', icon: 'x', event: { ns: 'shell', name: 'dismiss', payload: { noticeId: id } } },
        ],
      }),
    ),
  };
}
