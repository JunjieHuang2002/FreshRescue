import type { ChangeSet, Outcome } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Command, CommandPayloads } from '@freshrescue/contract-messages';
import type { Result, ValidThreshold } from '@freshrescue/contract-primitives';
import type { RawSeed } from '@freshrescue/contract-seed';
import { categoryCreateDecider } from '../modules/decide/categoryCreateDecider';
import { categoryDeleteDecider } from '../modules/decide/categoryDeleteDecider';
import { categoryRenameDecider } from '../modules/decide/categoryRenameDecider';
import { categoryThresholdDecider } from '../modules/decide/categoryThresholdDecider';
import { foodTypeCreateDecider } from '../modules/decide/foodTypeCreateDecider';
import { foodTypeDeleteDecider } from '../modules/decide/foodTypeDeleteDecider';
import { foodTypeEditDecider } from '../modules/decide/foodTypeEditDecider';
import { settingsDecider } from '../modules/decide/settingsDecider';
import { changeSetMerger } from '../modules/engine/changeSetMerger';
import { seedPlanner } from '../modules/engine/seedPlanner';
import { systemDataInitializer } from '../modules/engine/systemDataInitializer';
import { idAllocator } from '../modules/foundation/idAllocator';
import { nameValidator } from '../modules/foundation/nameValidator';
import { scalarValidator } from '../modules/foundation/scalarValidator';
import { seedBundleParser } from '../modules/parsing/seedBundleParser';

/** The six commands that this coordinator owns (blueprint 3.4). */
type ReferenceCommand = Extract<
  Command,
  { readonly type: 'SaveCategory' | 'DeleteCategory' | 'SetCategoryThreshold' | 'SaveFoodType' | 'DeleteFoodType' | 'SetSimulatedToday' }
>;

type Handled = Result<Outcome, DomainError>;

/**
 * The id that stands in when IdAllocator handed out none, which cannot happen when the demand is met.
 * No record has id 0, so SnapshotInvariantChecker refuses a change that carries it (`positiveIds`).
 */
const NO_ID = 0;

/** `commit(cs, payload?)` of blueprint 4.1: an Outcome of one ChangeSet, with a payload when the workflow has one. */
const commit = (changeSet: ChangeSet, payload?: unknown): Handled => ({ ok: true, value: { changeSets: [changeSet], payload } });

/** Shared step of two workflows: a threshold is validated only when the command carries one, and `null` clears it. */
function thresholdOf(days: number | null): Result<ValidThreshold | null, DomainError> {
  return days === null ? { ok: true, value: null } : scalarValidator('thresholdDays', days);
}

function bootstrap(seedRaw: RawSeed, snapshot: Snapshot): Handled {
  const base = systemDataInitializer(snapshot);
  const parsed = seedBundleParser(seedRaw);
  if (!parsed.ok) return parsed;
  const alloc = idAllocator(snapshot.counters, { ids: parsed.value.idDemand, seqs: 0 });
  const plan = seedPlanner(parsed.value, alloc.ids, snapshot);
  return commit(changeSetMerger([base, alloc.counterCs, plan]));
}

function setSimulatedToday(cmd: CommandPayloads['SetSimulatedToday']): Handled {
  return commit(settingsDecider(cmd.date));
}

function saveCategory(cmd: CommandPayloads['SaveCategory'], snapshot: Snapshot): Handled {
  const name = nameValidator(cmd.name, cmd.scope, snapshot, cmd.categoryId);
  if (!name.ok) return name;
  if (cmd.categoryId !== null) {
    const renamed = categoryRenameDecider(cmd.scope, cmd.categoryId, name.value, snapshot);
    if (!renamed.ok) return renamed;
    return commit(renamed.value, { categoryId: cmd.categoryId });
  }
  const alloc = idAllocator(snapshot.counters, { ids: 1, seqs: 0 });
  const id = alloc.ids[0] ?? NO_ID;
  const created = categoryCreateDecider(cmd.scope, name.value, cmd.parentId, snapshot, id);
  if (!created.ok) return created;
  return commit(changeSetMerger([alloc.counterCs, created.value]), { categoryId: id });
}

function deleteCategory(cmd: CommandPayloads['DeleteCategory'], snapshot: Snapshot): Handled {
  const deleted = categoryDeleteDecider(cmd.scope, cmd.categoryId, snapshot);
  if (!deleted.ok) return deleted;
  return commit(deleted.value);
}

function setCategoryThreshold(cmd: CommandPayloads['SetCategoryThreshold'], snapshot: Snapshot): Handled {
  const threshold = thresholdOf(cmd.thresholdDays);
  if (!threshold.ok) return threshold;
  const changed = categoryThresholdDecider(cmd.categoryId, threshold.value, snapshot);
  if (!changed.ok) return changed;
  return commit(changed.value);
}

function saveFoodType(cmd: CommandPayloads['SaveFoodType'], snapshot: Snapshot): Handled {
  const name = nameValidator(cmd.name, 'foodType', snapshot, cmd.foodTypeId);
  if (!name.ok) return name;
  const threshold = thresholdOf(cmd.thresholdDays);
  if (!threshold.ok) return threshold;
  if (cmd.foodTypeId !== null) {
    const edited = foodTypeEditDecider(cmd.foodTypeId, name.value, cmd.categoryId, threshold.value, snapshot);
    if (!edited.ok) return edited;
    return commit(edited.value, { foodTypeId: cmd.foodTypeId });
  }
  const unit = scalarValidator('unit', cmd.unit);
  if (!unit.ok) return unit;
  const alloc = idAllocator(snapshot.counters, { ids: 1, seqs: 0 });
  const id = alloc.ids[0] ?? NO_ID;
  const created = foodTypeCreateDecider(name.value, cmd.categoryId, unit.value, threshold.value, snapshot, id);
  if (!created.ok) return created;
  return commit(changeSetMerger([alloc.counterCs, created.value]), { foodTypeId: id });
}

function deleteFoodType(cmd: CommandPayloads['DeleteFoodType'], snapshot: Snapshot): Handled {
  const deleted = foodTypeDeleteDecider(cmd.foodTypeId, snapshot);
  if (!deleted.ok) return deleted;
  return commit(deleted.value);
}

/** Routes one of the six commands to the workflow that carries it out. */
function handle(command: ReferenceCommand, snapshot: Snapshot): Handled {
  switch (command.type) {
    case 'SetSimulatedToday':
      return setSimulatedToday(command.payload);
    case 'SaveCategory':
      return saveCategory(command.payload, snapshot);
    case 'DeleteCategory':
      return deleteCategory(command.payload, snapshot);
    case 'SetCategoryThreshold':
      return setCategoryThreshold(command.payload, snapshot);
    case 'SaveFoodType':
      return saveFoodType(command.payload, snapshot);
    case 'DeleteFoodType':
      return deleteFoodType(command.payload, snapshot);
  }
}

/**
 * BX-02 ReferenceCommandCoordinator. Seeds the store and edits everything that the forms and the filters
 * are built from: the demo date, the categories and the Food Types (blueprint 3.2). It has seven
 * workflows: `bootstrap`, which BackendCoordinator calls itself at startup, and one for each of the six
 * commands that `handle` routes.
 *
 * It reads and writes nothing. It takes the snapshot as an argument, calls the validators and the deciders
 * in the order of the blueprint's pseudocode (4.2), and returns an Outcome with the ChangeSets to write,
 * or the first error. A workflow that makes a record reserves its id first and merges the counter bump in
 * front of the decider's ChangeSet, so that the record and the counters are written together. Each
 * workflow is a function of its own, and the object that this returns only points at them.
 */
export function createReferenceCommandCoordinator() {
  return { handle, bootstrap };
}
