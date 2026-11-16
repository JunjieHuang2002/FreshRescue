import type { FoodType, Snapshot } from '@freshrescue/contract-entities';
import type { Id } from '@freshrescue/contract-primitives';
import type { InventoryListDto, InventoryRow, PathMap, StockEntry, StockMap } from '@freshrescue/contract-views';

/** The stock of a Food Type that has no batch. */
const NO_STOCK: StockEntry = { total: 0, avail: 0, near: 0, byStatus: { fresh: 0, nearExpiry: 0, expired: 0 }, overall: null };

/**
 * BC-16 InventoryListProjector. Projects the stock figures into the rows of the Feature 5 inventory
 * list (spec 4.7.1), one row for every Food Type, in the A to Z order it is given:
 *
 * - the Food Type's name, its category path and its unit
 * - the total quantity: every batch, Fresh, Near-Expiry and Expired, which is the physical stock that
 *   also counts toward the cap
 * - the status: the quantity in each status, and the overall badge, the most urgent status present
 *   (exception row 23). The screen leaves out a status with quantity 0.
 *
 * A Food Type stays listed after its last batch is removed: it shows quantity 0 and no status, which
 * the screen draws as "—" (exception row 22). With no Food Type at all the list is empty, which the
 * screen draws as "No food yet".
 */
export function inventoryListProjector(snapshot: Snapshot, stock: StockMap, paths: PathMap, order: readonly Id[]): InventoryListDto {
  const foodTypes = new Map(snapshot.foodTypes.map((foodType): [Id, FoodType] => [foodType.id, foodType]));
  const rows = order.flatMap((id): InventoryRow[] => {
    const foodType = foodTypes.get(id);
    if (foodType === undefined) return [];
    const { total, byStatus, overall } = stock[id] ?? NO_STOCK;
    return [{ foodTypeId: id, name: foodType.name, categoryPath: paths[id]?.names ?? [], unit: foodType.unit, total, byStatus, overall }];
  });
  return { rows };
}
