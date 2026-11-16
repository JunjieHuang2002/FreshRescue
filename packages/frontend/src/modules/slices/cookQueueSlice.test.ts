import { describe, expect, it } from 'vitest';
import type { QueueAction, QueueState } from '@freshrescue/contract-ui';
import { cookQueueSlice } from './cookQueueSlice';

const EMPTY: QueueState = { entries: [] };
const RICE = { recipeId: 12, recipeName: 'Chicken Fried Rice' };
const OMELETTE = { recipeId: 13, recipeName: 'Spinach Omelette' };
const GRATIN = { recipeId: 14, recipeName: 'Chicken Broccoli Gratin' };
const THREE: QueueState = { entries: [RICE, OMELETTE, GRATIN] };

const names = (state: QueueState): string[] => state.entries.map((entry) => entry.recipeName);

describe('FS-06 CookQueueSlice', () => {
  it('adds recipes in the order of addition', () => {
    const queue = cookQueueSlice(cookQueueSlice(EMPTY, { type: 'add', ...RICE }), { type: 'add', ...OMELETTE });

    expect(queue.entries).toEqual([RICE, OMELETTE]);
  });

  it('lets the same recipe be queued twice: each entry is a separate execution (spec exception 21)', () => {
    const twice = cookQueueSlice(cookQueueSlice(EMPTY, { type: 'add', ...RICE }), { type: 'add', ...RICE });

    expect(twice.entries).toEqual([RICE, RICE]);
  });

  it('removes the entry at an index, and only that one', () => {
    const twice = { entries: [RICE, OMELETTE, RICE] };

    expect(names(cookQueueSlice(twice, { type: 'remove', index: 2 }))).toEqual(['Chicken Fried Rice', 'Spinach Omelette']);
    expect(names(cookQueueSlice(twice, { type: 'remove', index: 0 }))).toEqual(['Spinach Omelette', 'Chicken Fried Rice']);
  });

  it('moves an entry up and down by swapping it with its neighbour', () => {
    expect(names(cookQueueSlice(THREE, { type: 'move', index: 1, direction: 'up' }))).toEqual([
      'Spinach Omelette',
      'Chicken Fried Rice',
      'Chicken Broccoli Gratin',
    ]);
    expect(names(cookQueueSlice(THREE, { type: 'move', index: 1, direction: 'down' }))).toEqual([
      'Chicken Fried Rice',
      'Chicken Broccoli Gratin',
      'Spinach Omelette',
    ]);
  });

  it('cannot move the first entry up or the last entry down', () => {
    expect(cookQueueSlice(THREE, { type: 'move', index: 0, direction: 'up' })).toBe(THREE);
    expect(cookQueueSlice(THREE, { type: 'move', index: 2, direction: 'down' })).toBe(THREE);
  });

  it('prunes every entry of a recipe that was deleted (spec 4.5)', () => {
    const queue = { entries: [RICE, OMELETTE, RICE] };

    expect(cookQueueSlice(queue, { type: 'prune', recipeId: 12 }).entries).toEqual([OMELETTE]);
    expect(cookQueueSlice(queue, { type: 'prune', recipeId: 99 })).toBe(queue);
  });

  it('clears the queue, and an empty queue stays the same object', () => {
    expect(cookQueueSlice(THREE, { type: 'clear' })).toEqual(EMPTY);
    expect(cookQueueSlice(EMPTY, { type: 'clear' })).toBe(EMPTY);
  });

  it('refuses an index that is not in the queue', () => {
    for (const index of [-1, 3, 0.5, Number.NaN]) {
      expect(cookQueueSlice(THREE, { type: 'remove', index })).toBe(THREE);
      expect(cookQueueSlice(THREE, { type: 'move', index, direction: 'up' })).toBe(THREE);
    }
    expect(cookQueueSlice(EMPTY, { type: 'remove', index: 0 })).toBe(EMPTY);
  });

  it('refuses an entry that is not a recipe, a direction that does not exist and an action that it does not know', () => {
    const illegal = [
      { type: 'add', recipeId: 0, recipeName: 'x' },
      { type: 'add', recipeId: 1.5, recipeName: 'x' },
      { type: 'add', recipeId: 5, recipeName: 7 },
      { type: 'move', index: 1, direction: 'sideways' },
      { type: 'shuffle' },
    ] as unknown as QueueAction[];

    for (const action of illegal) expect(cookQueueSlice(THREE, action)).toBe(THREE);
  });

  it('does not change the queue that it is given', () => {
    const frozen: QueueState = Object.freeze({ entries: Object.freeze([RICE, OMELETTE]) });

    for (const action of [
      { type: 'add', ...GRATIN },
      { type: 'remove', index: 0 },
      { type: 'move', index: 1, direction: 'up' },
      { type: 'prune', recipeId: 12 },
      { type: 'clear' },
    ] as const) {
      cookQueueSlice(frozen, action);
    }

    expect(frozen.entries).toEqual([RICE, OMELETTE]);
  });
});
