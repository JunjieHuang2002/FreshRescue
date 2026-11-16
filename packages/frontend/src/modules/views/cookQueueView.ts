import type { QueueState, RenderTree } from '@freshrescue/contract-ui';

/**
 * FU-13 CookQueueView. Draws the cook queue (spec 4.5, blueprint 1.8): the recipes in the order that
 * they will run, each with buttons to move it up or down and to remove it, and the buttons to run
 * the queue and to clear it. The first entry cannot go up and the last cannot go down, and an empty
 * queue cannot be run. The same recipe can be in the queue twice, and each entry is shown as its own.
 * The entries carry the recipe name, so the queue draws without a request.
 */
export function cookQueueView(queue: QueueState): RenderTree {
  const { entries } = queue;
  const empty = entries.length === 0;
  const last = entries.length - 1;
  return {
    kind: 'box',
    layout: 'dock',
    children: [
      {
        kind: 'box',
        layout: 'header',
        children: [
          { kind: 'text', text: 'Cook queue', tone: 'title', icon: 'meal' },
          { kind: 'text', text: `${entries.length} in the queue`, tone: 'chip' },
        ],
      },
      ...(empty
        ? [{ kind: 'text', text: 'The cook queue is empty. Add a recipe from the list.', tone: 'muted' } as const]
        : [
            {
              kind: 'box',
              layout: 'queue',
              children: entries.map(
                (entry, index): RenderTree => ({
                  kind: 'box',
                  layout: 'row',
                  children: [
                    { kind: 'text', text: `${index + 1}. ${entry.recipeName}` },
                    {
                      kind: 'box',
                      layout: 'tools',
                      children: [
                        {
                          kind: 'button',
                          label: 'Up',
                          tone: 'quiet',
                          icon: 'up',
                          event: { ns: 'cook', name: 'move', payload: { index, direction: 'up' } },
                          disabled: index === 0,
                        },
                        {
                          kind: 'button',
                          label: 'Down',
                          tone: 'quiet',
                          icon: 'down',
                          event: { ns: 'cook', name: 'move', payload: { index, direction: 'down' } },
                          disabled: index === last,
                        },
                        { kind: 'button', label: 'Remove', tone: 'remove', icon: 'x', event: { ns: 'cook', name: 'remove', payload: { index } } },
                      ],
                    },
                  ],
                }),
              ),
            } as const,
          ]),
      {
        kind: 'box',
        layout: 'actions',
        children: [
          { kind: 'button', label: 'Cook & Deduct', tone: 'cook', icon: 'flame', event: { ns: 'cook', name: 'run', payload: {} }, disabled: empty },
          { kind: 'button', label: 'Clear', tone: 'quiet', event: { ns: 'cook', name: 'clear', payload: {} }, disabled: empty },
        ],
      },
    ],
  };
}
