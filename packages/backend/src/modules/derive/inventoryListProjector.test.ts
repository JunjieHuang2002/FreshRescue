import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DateISO } from '@freshrescue/contract-primitives';
import type { InventoryListDto, PathMap, StockMap } from '@freshrescue/contract-views';
import { buildBatch, buildFoodCategory, buildFoodType, buildSnapshot } from '../../testing/fixtures';
import { batchStatusClassifier } from '../foundation/batchStatusClassifier';
import { thresholdResolver } from '../foundation/thresholdResolver';
import { categoryPathResolver } from './categoryPathResolver';
import { inventoryListProjector } from './inventoryListProjector';
import { nameSorter } from './nameSorter';
import { stockAggregator } from './stockAggregator';

/** getInventoryList in the blueprint's order: derive, paths, order, projection. */
function inventory(snapshot: Snapshot, today: DateISO): InventoryListDto {
  const stock = stockAggregator(snapshot, batchStatusClassifier(snapshot.batches, thresholdResolver(snapshot), today));
  return inventoryListProjector(snapshot, stock, categoryPathResolver(snapshot), nameSorter(snapshot.foodTypes));
}

const batch = (id: number, foodTypeId: number, quantity: number, expirationDate: DateISO) =>
  buildBatch({ id, foodTypeId, quantity, inboundDate: '2026-10-01', expirationDate });

// On Oct 10 with the default T_eff of 3: Oct 20 is Fresh, Oct 11 is Near-Expiry, Oct 9 is Expired.
// Created out of A to Z order on purpose.
const kitchen = buildSnapshot({
  foodCategories: [buildFoodCategory({ id: 3, name: 'Meat' }), buildFoodCategory({ id: 4, name: 'Poultry', parentId: 3 }), buildFoodCategory({ id: 5, name: 'Vegetables' })],
  foodTypes: [
    buildFoodType({ id: 10, name: 'Tomato', categoryId: 5, unit: 'pieces' }),
    buildFoodType({ id: 11, name: 'Chicken', categoryId: 4 }),
    buildFoodType({ id: 12, name: 'beef', categoryId: 3 }),
  ],
  batches: [
    batch(20, 11, 300_000, '2026-10-20'),
    batch(21, 11, 150_000, '2026-10-11'),
    batch(22, 11, 100_000, '2026-10-09'),
    batch(23, 12, 200_000, '2026-10-20'),
  ],
});

describe('BC-16 InventoryListProjector', () => {
  it('lists every Food Type A to Z, with its category path and unit (spec 4.7.1)', () => {
    const dto = inventory(kitchen, '2026-10-10');

    expect(dto.rows.map((row) => [row.name, row.categoryPath, row.unit])).toEqual([
      ['beef', ['Meat'], 'grams'],
      ['Chicken', ['Meat', 'Poultry'], 'grams'],
      ['Tomato', ['Vegetables'], 'pieces'],
    ]);
  });

  it('shows the status breakdown and the most urgent badge of a Food Type in several statuses (exception row 23)', () => {
    const chicken = inventory(kitchen, '2026-10-10').rows.find((row) => row.name === 'Chicken');

    // Fresh 300 · Near-Expiry 150 · Expired 100, and the total counts all three
    expect(chicken).toEqual({
      foodTypeId: 11,
      name: 'Chicken',
      categoryPath: ['Meat', 'Poultry'],
      unit: 'grams',
      total: 550_000,
      byStatus: { fresh: 300_000, nearExpiry: 150_000, expired: 100_000 },
      overall: 'expired',
    });
  });

  it('keeps a Food Type without a batch in the list with quantity 0 and no status, drawn as "—" (exception row 22)', () => {
    const tomato = inventory(kitchen, '2026-10-10').rows.find((row) => row.name === 'Tomato');

    expect(tomato).toMatchObject({ total: 0, byStatus: { fresh: 0, nearExpiry: 0, expired: 0 }, overall: null });
  });

  it('keeps a Food Type registered with its unit and category after its last batch is removed (spec 4.2.4)', () => {
    const emptied = { ...kitchen, batches: kitchen.batches.filter((b) => b.foodTypeId !== 12) };

    expect(inventory(emptied, '2026-10-10').rows[0]).toEqual({
      foodTypeId: 12,
      name: 'beef',
      categoryPath: ['Meat'],
      unit: 'grams',
      total: 0,
      byStatus: { fresh: 0, nearExpiry: 0, expired: 0 },
      overall: null,
    });
  });

  it('moves the figures with the date: the same stock is all Expired later on', () => {
    const chicken = inventory(kitchen, '2026-10-21').rows.find((row) => row.name === 'Chicken');

    expect(chicken).toMatchObject({ total: 550_000, byStatus: { fresh: 0, nearExpiry: 0, expired: 550_000 }, overall: 'expired' });
  });

  it('gives an empty list when no Food Type exists, drawn as "No food yet"', () => {
    expect(inventory(buildSnapshot(), '2026-10-10')).toEqual({ rows: [] });
  });

  it('follows the order it is given, and skips an id that is no Food Type', () => {
    const snapshot = buildSnapshot({ foodTypes: [buildFoodType({ id: 10, name: 'A' }), buildFoodType({ id: 11, name: 'B' })] });
    const stock: StockMap = {};
    const paths: PathMap = {};

    expect(inventoryListProjector(snapshot, stock, paths, [11, 404, 10]).rows.map((row) => [row.name, row.total, row.categoryPath])).toEqual([
      ['B', 0, []],
      ['A', 0, []],
    ]);
  });
});
