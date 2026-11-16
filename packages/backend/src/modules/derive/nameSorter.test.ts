import { describe, expect, it } from 'vitest';
import type { Named } from '@freshrescue/contract-primitives';
import { nameSorter } from './nameSorter';

/** Named items with ids from 1 up, in the order given, which is their creation order. */
const items = (...names: readonly string[]): Named[] => names.map((name, index) => ({ id: index + 1, name }));
/** The names in the order NameSorter gives. */
const sorted = (list: readonly Named[]): string[] => nameSorter(list).map((id) => list.find((item) => item.id === id)?.name ?? '?');

describe('BC-11 NameSorter', () => {
  it('orders names A to Z (spec 4.4.D)', () => {
    expect(sorted(items('Tomato', 'Beef', 'Milk', 'Chicken'))).toEqual(['Beef', 'Chicken', 'Milk', 'Tomato']);
  });

  it('ignores case, so beef comes before Broccoli, where character codes would put every capital first', () => {
    expect(sorted(items('Broccoli', 'beef', 'apple', 'Zucchini'))).toEqual(['apple', 'beef', 'Broccoli', 'Zucchini']);
  });

  it('compares the trimmed name, so leading spaces do not move an item', () => {
    expect(sorted(items('   Zucchini', 'apple', ' banana'))).toEqual(['apple', ' banana', '   Zucchini']);
  });

  it('breaks ties by creation order: names that differ only in case keep the order they came in', () => {
    const milk = [{ id: 5, name: 'Milk' }, { id: 3, name: 'milk' }, { id: 7, name: 'MILK ' }];

    expect(nameSorter(milk)).toEqual([5, 3, 7]);
    expect(nameSorter([...milk].reverse())).toEqual([7, 3, 5]);
  });

  it('is locale-aware: a letter with a mark sorts beside its base letter, not after Z', () => {
    // by character code Ä and Ö come after every ASCII letter
    expect(sorted(items('Zucchini', 'Pear', 'Ölive', 'Banana', 'Äpfel', 'Nut'))).toEqual(['Äpfel', 'Banana', 'Nut', 'Ölive', 'Pear', 'Zucchini']);
  });

  it('ignores case and nothing else: an accent still tells two names apart, so they are not a tie', () => {
    expect(sorted(items('éclair', 'eclair'))).toEqual(['eclair', 'éclair']);
    expect(sorted(items('eclair', 'éclair'))).toEqual(['eclair', 'éclair']);
  });

  it('orders the built-in recipes of Appendix A as the catalog shows them', () => {
    const recipes = items(
      'Vietnamese Chicken Rice',
      'Chicken Fried Rice',
      'Tomato Egg Stir-Fry',
      'Beef and Broccoli Stir-Fry',
      'Spinach Omelette',
      'Chicken Broccoli Gratin',
    );

    expect(sorted(recipes)).toEqual([
      'Beef and Broccoli Stir-Fry',
      'Chicken Broccoli Gratin',
      'Chicken Fried Rice',
      'Spinach Omelette',
      'Tomato Egg Stir-Fry',
      'Vietnamese Chicken Rice',
    ]);
  });

  it('orders the Food Types of Appendix A from Beef to Tomato', () => {
    const foodTypes = items('Tomato', 'Rice', 'Milk', 'Egg', 'Spinach', 'Chicken', 'Broccoli', 'Beef');

    expect(sorted(foodTypes)).toEqual(['Beef', 'Broccoli', 'Chicken', 'Egg', 'Milk', 'Rice', 'Spinach', 'Tomato']);
  });

  it('returns ids only, as many as it was given, and leaves the list as it was', () => {
    const list = Object.freeze(items('b', 'a', 'c'));

    expect(nameSorter(list)).toEqual([2, 1, 3]);
    expect(list.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(nameSorter([])).toEqual([]);
  });
});
