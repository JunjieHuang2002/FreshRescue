import type { ChangeSet, Outcome } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Command, CommandPayloads } from '@freshrescue/contract-messages';
import type { DateISO, Id, Result, ValidQty } from '@freshrescue/contract-primitives';
import { batchCreateDecider } from '../modules/decide/batchCreateDecider';
import { batchQuantityEditDecider } from '../modules/decide/batchQuantityEditDecider';
import { batchRemoveDecider } from '../modules/decide/batchRemoveDecider';
import { foodTypeCreateDecider } from '../modules/decide/foodTypeCreateDecider';
import { foodTypeResolver } from '../modules/decide/foodTypeResolver';
import { unitChangeDecider } from '../modules/decide/unitChangeDecider';
import { changeSetMerger } from '../modules/engine/changeSetMerger';
import { capChecker } from '../modules/foundation/capChecker';
import { expiryResolver } from '../modules/foundation/expiryResolver';
import { idAllocator } from '../modules/foundation/idAllocator';
import { nameValidator } from '../modules/foundation/nameValidator';
import { scalarValidator } from '../modules/foundation/scalarValidator';

/** The four commands that this coordinator owns (blueprint 3.4). */
type InventoryCommand = Extract<Command, { readonly type: 'ChangeFoodTypeUnit' | 'InboundBatch' | 'EditBatchQuantity' | 'RemoveBatch' }>;

type Handled = Result<Outcome, DomainError>;

/**
 * The id and the sequence number that stand in when IdAllocator handed out none, which cannot happen when
 * the demand is met. No record has id 0 and no batch has `createdSeq` 0, so SnapshotInvariantChecker refuses
 * a change that carries either (`positiveIds`, `createdSeq`).
 */
const NO_ID = 0;
const NO_SEQ = 0;

/** `commit(cs, payload?)` of blueprint 4.1: an Outcome of one ChangeSet, with a payload when the workflow has one. */
const commit = (changeSet: ChangeSet, payload?: unknown): Handled => ({ ok: true, value: { changeSets: [changeSet], payload } });

function inbound(cmd: CommandPayloads['InboundBatch'], snapshot: Snapshot, today: DateISO): Handled {
  const ref = foodTypeResolver(cmd.foodTypeId, cmd.foodName, snapshot);
  if (!ref.ok) return ref;
  const qty = scalarValidator('qty', cmd.quantity);
  if (!qty.ok) return qty;
  const dates = expiryResolver(cmd.expiry, today);
  if (!dates.ok) return dates;

  // a new Food Type needs two ids, its own and its first batch's, and an existing one needs the batch's
  const alloc = idAllocator(snapshot.counters, { ids: ref.value.kind === 'new' ? 2 : 1, seqs: 1 });
  const parts: ChangeSet[] = [alloc.counterCs];
  let foodTypeId: Id;
  if (ref.value.kind === 'new') {
    foodTypeId = alloc.ids[0] ?? NO_ID;
    const name = nameValidator(ref.value.name, 'foodType', snapshot, null);
    if (!name.ok) return name;
    const unit = scalarValidator('unit', cmd.unit);
    if (!unit.ok) return unit;
    const created = foodTypeCreateDecider(name.value, cmd.categoryId, unit.value, null, snapshot, foodTypeId);
    if (!created.ok) return created;
    parts.push(created.value);
  } else {
    foodTypeId = ref.value.foodType.id;
  }
  const cap = capChecker(snapshot, { kind: 'add', foodTypeId, qty: qty.value });
  if (!cap.ok) return cap;
  parts.push(batchCreateDecider(foodTypeId, qty.value, dates.value, alloc.ids.at(-1) ?? NO_ID, alloc.seqs[0] ?? NO_SEQ));
  return commit(changeSetMerger(parts));
}

function editQuantity(cmd: CommandPayloads['EditBatchQuantity'], snapshot: Snapshot): Handled {
  const qty = scalarValidator('qty', cmd.quantity);
  if (!qty.ok) return qty;
  const cap = capChecker(snapshot, { kind: 'edit', batchId: cmd.batchId, qty: qty.value });
  if (!cap.ok) return cap;
  const edited = batchQuantityEditDecider(cmd.batchId, qty.value, snapshot);
  if (!edited.ok) return edited;
  return commit(edited.value);
}

function removeBatch(cmd: CommandPayloads['RemoveBatch'], snapshot: Snapshot): Handled {
  const removed = batchRemoveDecider(cmd.batchId, snapshot);
  if (!removed.ok) return removed;
  return commit(removed.value);
}

function changeUnit(cmd: CommandPayloads['ChangeFoodTypeUnit'], snapshot: Snapshot): Handled {
  const unit = scalarValidator('unit', cmd.unit);
  if (!unit.ok) return unit;
  const rows: { readonly batchId: Id; readonly qty: ValidQty }[] = [];
  for (const batch of cmd.batches) {
    const qty = scalarValidator('qty', batch.quantity);
    if (!qty.ok) return qty;
    rows.push({ batchId: batch.batchId, qty: qty.value });
  }
  const cap = capChecker(snapshot, { kind: 'convert', foodTypeId: cmd.foodTypeId, rows });
  if (!cap.ok) return cap;
  const converted = unitChangeDecider(cmd.foodTypeId, unit.value, rows, snapshot);
  if (!converted.ok) return converted;
  return commit(converted.value);
}

/** Routes one of the four commands to the workflow that carries it out. */
function handle(command: InventoryCommand, snapshot: Snapshot, today: DateISO): Handled {
  switch (command.type) {
    case 'InboundBatch':
      return inbound(command.payload, snapshot, today);
    case 'EditBatchQuantity':
      return editQuantity(command.payload, snapshot);
    case 'RemoveBatch':
      return removeBatch(command.payload, snapshot);
    case 'ChangeFoodTypeUnit':
      return changeUnit(command.payload, snapshot);
  }
}

/**
 * BX-03 InventoryCommandCoordinator. Changes how much is in stock: it adds, corrects and removes batches,
 * and converts a Food Type's unit together with all its batches (blueprint 3.2). It has four workflows,
 * one for each of the four commands that `handle` routes. `changeUnit` sits here because it rewrites every
 * batch quantity under the same cap check as an inbound.
 *
 * It reads and writes nothing. It takes the snapshot and today's date as arguments, calls the validators,
 * the cap check and the deciders in the order of the blueprint's pseudocode (4.2), and returns an Outcome
 * with the ChangeSet to write, or the first error. An inbound whose name matches no Food Type creates the
 * Food Type and its first batch in the same ChangeSet, so that both are written or neither is, and it
 * reserves two ids for them. A request that names no Food Type at all resolves to the empty name, so it
 * ends in NAME_EMPTY, after its quantity and its expiry have been checked.
 */
export function createInventoryCommandCoordinator() {
  return { handle };
}
