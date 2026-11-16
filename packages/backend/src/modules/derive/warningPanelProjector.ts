import type { FoodType, Snapshot } from '@freshrescue/contract-entities';
import type { Id } from '@freshrescue/contract-primitives';
import type { BatchStatus } from '@freshrescue/contract-rules';
import type { BatchView, WarningPanelDto, WarningRow } from '@freshrescue/contract-views';

/** A row with what it sorts by: the place of its Food Type in the A to Z order, and its `createdSeq`. */
type Ranked = { readonly row: WarningRow; readonly rank: number; readonly seq: number };

/** Days left as a sort key. A date that could not be read gives NaN, which the classifier counts as Expired; it sorts first, as the most urgent. */
const urgencyOf = (daysLeft: number): number => (Number.isNaN(daysLeft) ? Number.NEGATIVE_INFINITY : daysLeft);
const compare = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);

function sectionOf(status: BatchStatus, batches: readonly BatchView[], foodTypes: ReadonlyMap<Id, FoodType>, rankOf: ReadonlyMap<Id, number>): WarningRow[] {
  const ranked = batches.flatMap((batch): Ranked[] => {
    const foodType = foodTypes.get(batch.foodTypeId);
    if (batch.status !== status || foodType === undefined) return [];
    const row: WarningRow = {
      batchId: batch.id,
      foodTypeId: batch.foodTypeId,
      foodTypeName: foodType.name,
      unit: foodType.unit,
      quantity: batch.quantity,
      expirationDate: batch.expirationDate,
      daysLeft: batch.daysLeft,
      status: batch.status,
    };
    return [{ row, rank: rankOf.get(batch.foodTypeId) ?? Number.MAX_SAFE_INTEGER, seq: batch.createdSeq }];
  });
  ranked.sort((a, b) => compare(urgencyOf(a.row.daysLeft), urgencyOf(b.row.daysLeft)) || a.rank - b.rank || a.seq - b.seq);
  return ranked.map(({ row }) => row);
}

/**
 * BC-18 WarningPanelProjector. Projects the batches into the two sections of the Near-Expiry Warning
 * Panel (spec 4.3.3): the Near-Expiry batches, which carry a warning badge, and a separate section of
 * the Expired batches, which carry a red one. Fresh batches are in neither.
 *
 * Each section is sorted by days left ascending, then by Food Type name A to Z, which is the place of
 * the Food Type in the order given (NameSorter), then by `createdSeq`. An empty Near-Expiry section is
 * "No near-expiry items", and an empty Expired section is not shown (spec 4.6). A batch whose Food
 * Type is not in the snapshot has no name or unit to show and is left out.
 */
export function warningPanelProjector(batches: readonly BatchView[], snapshot: Snapshot, order: readonly Id[]): WarningPanelDto {
  const foodTypes = new Map(snapshot.foodTypes.map((foodType): [Id, FoodType] => [foodType.id, foodType]));
  const rankOf = new Map(order.map((id, rank): [Id, number] => [id, rank]));
  return {
    nearExpiry: sectionOf('nearExpiry', batches, foodTypes, rankOf),
    expired: sectionOf('expired', batches, foodTypes, rankOf),
  };
}
