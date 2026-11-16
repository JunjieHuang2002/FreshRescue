import { describe, expect, it } from 'vitest';
import type { FoodTypeDetailDto } from '@freshrescue/contract-views';
import { BATCH_B, DETAIL, DETAIL_EMPTY, failedOf, idleOf, loadingOf, readyOf } from '../../testing/fixtures';
import { eventsOf, findButton, problemsOf, renderText } from '../../testing/render';
import { foodTypeDetailView } from './foodTypeDetailView';

const withDays = (daysLeft: number, status: 'fresh' | 'nearExpiry' | 'expired' = 'fresh'): FoodTypeDetailDto => ({
  ...DETAIL,
  batches: [{ id: 50, foodTypeId: 20, quantity: 500_000, inboundDate: '2026-10-01', expirationDate: '2026-10-06', createdSeq: 9, daysLeft, status }],
});

describe('FU-05 FoodTypeDetailView', () => {
  const tree = foodTypeDetailView(readyOf(DETAIL));
  const text = renderText(tree);

  it('draws the header of the Food Type: name, category path, unit, total, breakdown and badge', () => {
    expect(problemsOf(tree)).toEqual([]);
    expect(text).toContain('text: Beef (title)');
    expect(text).toContain('text: Meat → Red Meat (chip)');
    expect(text).toContain('text: Unit: grams');
    expect(text).toContain('text: Total: 550 grams');
    expect(text).toContain('text: Fresh 300 · Near-Expiry 150 · Expired 100 (muted)');
    expect(text).toContain('text: Expired (bad)');
  });

  it('names the effective threshold and the level that decided it (spec 4.7.2, 4.3.1)', () => {
    expect(text).toContain('text: Near-expiry threshold: 5 days (Parent category) (muted)');
    expect(renderText(foodTypeDetailView(readyOf(DETAIL_EMPTY)))).toContain('Near-expiry threshold: 2 days (Food Type)');
    const global: FoodTypeDetailDto = { ...DETAIL, threshold: { days: 3, source: 'global' } };
    const child: FoodTypeDetailDto = { ...DETAIL, threshold: { days: 1, source: 'child' } };

    expect(renderText(foodTypeDetailView(readyOf(global)))).toContain('Near-expiry threshold: 3 days (global default)');
    expect(renderText(foodTypeDetailView(readyOf(child)))).toContain('Near-expiry threshold: 1 day (Child category)');
  });

  describe('each batch', () => {
    it('is drawn with its quantity, unit, the Food Type, and the computed text of spec 4.2.1', () => {
      expect(text).toContain('text: 150 grams of Beef — expires in 1 day');
      expect(text).toContain('text: 300 grams of Beef — expires in 7 days');
      expect(text).toContain('text: 100 grams of Beef — expired 1 day ago');
    });

    it('words the days left as the specification does', () => {
      const line = (daysLeft: number): string => renderText(foodTypeDetailView(readyOf(withDays(daysLeft)))).split('\n').find((row) => row.includes('of Beef')) ?? '';

      expect(line(4)).toContain('500 grams of Beef — expires in 4 days');
      expect(line(10)).toContain('— expires in 10 days');
      expect(line(1)).toContain('— expires in 1 day');
      expect(line(0)).toContain('— expires today');
      expect(line(-1)).toContain('— expired 1 day ago');
      expect(line(-3)).toContain('— expired 3 days ago');
    });

    it('shows its dates and its status badge', () => {
      expect(text).toContain('text: Added 2026-09-25 · Expires 2026-10-03 (muted)');
      expect(text).toContain('text: Near-Expiry (warn)');
      expect(text).toContain('text: Fresh (good)');
    });

    it('keeps the order that the backend sorted: by expiration date, then creation order', () => {
      const lines = text.split('\n').filter((row) => row.includes('of Beef'));

      expect(lines.map((row) => /\d+ grams/.exec(row)?.[0])).toEqual(['100 grams', '150 grams', '300 grams']);
    });

    it('has buttons to edit its quantity and to remove it, which carry what the forms need', () => {
      const events = eventsOf(tree).filter((event) => event.ns === 'inventory');

      expect(events).toContainEqual({ ns: 'inventory', name: 'editBatchQuantity', payload: { batch: BATCH_B, foodType: DETAIL } });
      expect(events).toContainEqual({
        ns: 'inventory',
        name: 'removeBatch',
        payload: { batch: BATCH_B, summary: '150 grams of Beef — expires in 1 day' },
      });
      expect(text.match(/button: Edit quantity/g)).toHaveLength(3);
      expect(text.match(/button: Remove batch/g)).toHaveLength(3);
    });
  });

  it('says "No batches" for a Food Type without any, and draws a dash for its status', () => {
    const empty = renderText(foodTypeDetailView(readyOf(DETAIL_EMPTY)));

    expect(empty).toContain('text: No batches (empty)');
    expect(empty).toContain('text: Total: 0 pieces');
    expect(empty).toContain('text: — (muted)');
    expect(empty).not.toContain('Edit quantity');
  });

  describe('the buttons on the Food Type', () => {
    it('add a batch with this Food Type picked', () => {
      expect(findButton(tree, 'Add batch')?.event).toEqual({ ns: 'inventory', name: 'addBatch', payload: { foodTypeId: 20 } });
    });

    it('edit it, carrying the Food Type that the form opens with', () => {
      expect(findButton(tree, 'Edit Food Type')?.event).toEqual({ ns: 'foodType', name: 'editFoodType', payload: { foodType: DETAIL } });
      expect(findButton(foodTypeDetailView(readyOf(DETAIL_EMPTY)), 'Edit Food Type')?.event).toEqual({
        ns: 'foodType',
        name: 'editFoodType',
        payload: { foodType: DETAIL_EMPTY },
      });
    });

    it('change the unit, carrying the Food Type with every one of its batches', () => {
      expect(findButton(tree, 'Change unit')?.event).toEqual({ ns: 'unitConversion', name: 'changeUnit', payload: { foodType: DETAIL } });
      expect(DETAIL.batches.map((batch) => batch.id)).toEqual([31, 32, 33]);
    });

    it('delete it, carrying the Food Type with the recipes that would become blocked (spec 4.2.4)', () => {
      expect(findButton(tree, 'Delete Food Type')?.event).toEqual({ ns: 'foodTypeDelete', name: 'deleteFoodType', payload: { foodType: DETAIL } });
      expect(DETAIL.referencingRecipes.map((recipe) => recipe.name)).toEqual(['Beef and Broccoli Stir-Fry']);
    });

    it('go back to the list', () => {
      expect(findButton(tree, 'Back to inventory')?.event).toEqual({ ns: 'shell', name: 'navigate', payload: { tab: 'inventory', detail: null } });
    });
  });

  it('draws what each state of the read has', () => {
    expect(foodTypeDetailView(idleOf<FoodTypeDetailDto>())).toEqual({ kind: 'box', layout: 'stack', children: [] });
    expect(renderText(foodTypeDetailView(loadingOf<FoodTypeDetailDto>()))).toContain('text: Loading…');
    const failed = renderText(foodTypeDetailView(failedOf<FoodTypeDetailDto>({ code: 'FOOD_TYPE_NOT_FOUND' })));

    expect(failed).toContain('text: Could not load this Food Type. (badNote)');
    // the way back stays, so the person is never stuck on a detail that is gone
    expect(failed).toContain('button: Back to inventory');
    expect(renderText(foodTypeDetailView(loadingOf(DETAIL)))).toContain('text: Beef (title)');
  });

  it('is drawn from the data alone: the same data draws the same tree', () => {
    expect(foodTypeDetailView(readyOf(structuredClone(DETAIL)))).toEqual(tree);
  });
});
