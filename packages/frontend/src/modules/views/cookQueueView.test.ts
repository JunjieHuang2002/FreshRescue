import { describe, expect, it } from 'vitest';
import type { QueueState } from '@freshrescue/contract-ui';
import { eventsOf, findButton, nodesOf, problemsOf, renderText } from '../../testing/render';
import { cookQueueView } from './cookQueueView';

const RICE = { recipeId: 41, recipeName: 'Chicken Fried Rice' };
const OMELETTE = { recipeId: 42, recipeName: 'Spinach Omelette' };
const QUEUE: QueueState = { entries: [RICE, OMELETTE, RICE] };

describe('FU-13 CookQueueView', () => {
  const tree = cookQueueView(QUEUE);
  const text = renderText(tree);

  it('draws the recipes in the order that they will run, and counts them', () => {
    expect(problemsOf(tree)).toEqual([]);
    expect(text).toContain('text: Cook queue (title)');
    expect(text).toContain('text: 3 in the queue (chip)');
    const entries = nodesOf(tree).flatMap((node) => (node.kind === 'text' && /^\d+\. /.test(node.text) ? [node.text] : []));

    expect(entries).toEqual(['1. Chicken Fried Rice', '2. Spinach Omelette', '3. Chicken Fried Rice']);
  });

  it('shows the same recipe twice as two entries of their own (spec exception 21)', () => {
    expect(text.match(/Chicken Fried Rice/g)).toHaveLength(2);
    expect(text.match(/button: Remove/g)).toHaveLength(3);
  });

  it('has buttons to move an entry up and down, and to remove it, each carrying the index of the entry', () => {
    const events = eventsOf(tree).filter((event) => event.ns === 'cook' && event.name !== 'run' && event.name !== 'clear');

    expect(events).toEqual([
      { ns: 'cook', name: 'move', payload: { index: 0, direction: 'up' } },
      { ns: 'cook', name: 'move', payload: { index: 0, direction: 'down' } },
      { ns: 'cook', name: 'remove', payload: { index: 0 } },
      { ns: 'cook', name: 'move', payload: { index: 1, direction: 'up' } },
      { ns: 'cook', name: 'move', payload: { index: 1, direction: 'down' } },
      { ns: 'cook', name: 'remove', payload: { index: 1 } },
      { ns: 'cook', name: 'move', payload: { index: 2, direction: 'up' } },
      { ns: 'cook', name: 'move', payload: { index: 2, direction: 'down' } },
      { ns: 'cook', name: 'remove', payload: { index: 2 } },
    ]);
  });

  it('cannot move the first entry up or the last entry down', () => {
    const disabled = nodesOf(tree).flatMap((node) =>
      node.kind === 'button' && node.disabled === true && node.event.name === 'move' ? [`${node.event.payload.index} ${node.event.payload.direction}`] : [],
    );

    expect(disabled).toEqual(['0 up', '2 down']);
  });

  it('has the button that runs the queue and the one that clears it', () => {
    expect(findButton(tree, 'Cook & Deduct')).toMatchObject({ event: { ns: 'cook', name: 'run', payload: {} }, disabled: false });
    expect(findButton(tree, 'Clear')).toMatchObject({ event: { ns: 'cook', name: 'clear', payload: {} }, disabled: false });
  });

  it('says that the queue is empty, and cannot be run or cleared when it is', () => {
    const empty = cookQueueView({ entries: [] });

    expect(problemsOf(empty)).toEqual([]);
    expect(renderText(empty)).toContain('text: The cook queue is empty. Add a recipe from the list. (muted)');
    expect(renderText(empty)).toContain('text: 0 in the queue');
    expect(findButton(empty, 'Cook & Deduct')).toMatchObject({ disabled: true });
    expect(findButton(empty, 'Clear')).toMatchObject({ disabled: true });
    expect(eventsOf(empty).map((event) => event.name)).toEqual(['run', 'clear']);
  });

  it('can move the only entry nowhere', () => {
    const one = cookQueueView({ entries: [RICE] });
    const moves = nodesOf(one).flatMap((node) => (node.kind === 'button' && node.event.name === 'move' ? [node.disabled] : []));

    expect(moves).toEqual([true, true]);
  });

  it('draws from the names that the entries carry, so it needs no request', () => {
    expect(renderText(cookQueueView({ entries: [{ recipeId: 99, recipeName: 'A Name Nobody Has Loaded' }] }))).toContain('1. A Name Nobody Has Loaded');
  });
});
