import type { ChangeSet, Outcome } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Command, CommandPayloads } from '@freshrescue/contract-messages';
import type { DateISO, Id, Result } from '@freshrescue/contract-primitives';
import type { Allocation, CookReportEntry } from '@freshrescue/contract-views';
import { recipeDeleteDecider } from '../modules/decide/recipeDeleteDecider';
import { recipeDraftValidator } from '../modules/decide/recipeDraftValidator';
import { recipeUpsertDecider } from '../modules/decide/recipeUpsertDecider';
import { recipeErrorEvaluator } from '../modules/derive/recipeErrorEvaluator';
import { recipeMatchEvaluator } from '../modules/derive/recipeMatchEvaluator';
import { stockAggregator } from '../modules/derive/stockAggregator';
import { changeSetMerger } from '../modules/engine/changeSetMerger';
import { cookChangeSetBuilder } from '../modules/engine/cookChangeSetBuilder';
import { cookReportBuilder } from '../modules/engine/cookReportBuilder';
import { fefoAllocator } from '../modules/engine/fefoAllocator';
import { batchStatusClassifier } from '../modules/foundation/batchStatusClassifier';
import { idAllocator } from '../modules/foundation/idAllocator';
import { nameValidator } from '../modules/foundation/nameValidator';
import { thresholdResolver } from '../modules/foundation/thresholdResolver';
import { changeSetApplier } from '../modules/state/changeSetApplier';

/** The three commands that this coordinator owns (blueprint 3.4). */
type RecipeCommand = Extract<Command, { readonly type: 'SaveRecipe' | 'DeleteRecipe' | 'CookRecipes' }>;

type Handled = Result<Outcome, DomainError>;

/** What happened to one queued recipe: the running copy of the snapshot after it, its ChangeSet if it was cooked, and its report entry. */
type Step = {
  readonly snapshot: Snapshot;
  readonly changeSet: ChangeSet | null;
  readonly report: CookReportEntry;
};

/**
 * The id that stands in when IdAllocator handed out none. An edit reserves no id, so the decider is
 * handed this one and ignores it. A create cannot lack one when the demand is met, and no record has
 * id 0, so SnapshotInvariantChecker would refuse such a change (`positiveIds`).
 */
const NO_ID = 0;

/** `commit(cs, payload?)` of blueprint 4.1: an Outcome of one ChangeSet, with a payload when the workflow has one. */
const commit = (changeSet: ChangeSet, payload?: unknown): Handled => ({ ok: true, value: { changeSets: [changeSet], payload } });

function saveRecipe(cmd: CommandPayloads['SaveRecipe'], snapshot: Snapshot): Handled {
  const name = nameValidator(cmd.name, 'recipe', snapshot, cmd.recipeId);
  if (!name.ok) return name;
  const draft = recipeDraftValidator(cmd.draft, snapshot);
  if (!draft.ok) return draft;
  // an id only when creating
  const alloc = idAllocator(snapshot.counters, { ids: cmd.recipeId === null ? 1 : 0, seqs: 0 });
  const newId = alloc.ids[0] ?? NO_ID;
  const upserted = recipeUpsertDecider(cmd.recipeId, name.value, draft.value, snapshot, newId);
  if (!upserted.ok) return upserted;
  return commit(changeSetMerger([alloc.counterCs, upserted.value]), { recipeId: cmd.recipeId ?? newId });
}

function deleteRecipe(cmd: CommandPayloads['DeleteRecipe'], snapshot: Snapshot): Handled {
  const deleted = recipeDeleteDecider(cmd.recipeId, snapshot);
  if (!deleted.ok) return deleted;
  return commit(deleted.value);
}

/**
 * One queued recipe, cooked against `current`, which is the store as the recipes before it left it. The
 * derived figures are worked out again here, because the stock changed under the last recipe. A recipe that
 * is gone, blocked or has nothing available is a skipped entry and not an error (spec 4.5). Otherwise each
 * fulfilled row gets its batches by FEFO, the ChangeSet is built and applied to the running copy, and the
 * entry reports what was deducted and what was missing. The three guards (FEFO, the ChangeSet, the apply)
 * can only fire on an inconsistent snapshot, and then the whole command is that error.
 */
function cookOne(recipeId: Id, current: Snapshot, today: DateISO): Result<Step, DomainError> {
  const thresholds = thresholdResolver(current);
  const views = batchStatusClassifier(current.batches, thresholds, today);
  const stock = stockAggregator(current, views);
  const errors = recipeErrorEvaluator(current);
  const matched = recipeMatchEvaluator(current, stock, errors, [recipeId]);
  // an id that is no recipe any more is an Err here, and the recipe is skipped
  const match = matched.ok ? (matched.value[recipeId] ?? null) : null;
  if (match === null || match.status === 'blocked' || match.availableCount === 0) {
    return { ok: true, value: { snapshot: current, changeSet: null, report: cookReportBuilder(recipeId, match, [], current) } };
  }

  const allocations: Allocation[] = [];
  for (const row of match.rows) {
    if (!row.fulfilled) continue;
    const allocation = fefoAllocator(row.foodTypeId, row.qReq, views);
    if (!allocation.ok) return allocation;
    allocations.push(allocation.value);
  }
  const changeSet = cookChangeSetBuilder(recipeId, allocations, current);
  if (!changeSet.ok) return changeSet;
  const report = cookReportBuilder(recipeId, match, allocations, current);
  const next = changeSetApplier(current, changeSet.value);
  if (!next.ok) return next;
  return { ok: true, value: { snapshot: next.value, changeSet: changeSet.value, report } };
}

function cookRecipes(cmd: CommandPayloads['CookRecipes'], snapshot: Snapshot, today: DateISO): Handled {
  let current = snapshot;
  const changeSets: ChangeSet[] = [];
  const reports: CookReportEntry[] = [];
  // queue order, and a recipe queued twice runs twice
  for (const recipeId of cmd.recipeIds) {
    const step = cookOne(recipeId, current, today);
    if (!step.ok) return step;
    current = step.value.snapshot;
    if (step.value.changeSet !== null) changeSets.push(step.value.changeSet);
    reports.push(step.value.report);
  }
  return { ok: true, value: { changeSets, payload: { reports } } };
}

/** Routes one of the three commands to the workflow that carries it out. */
function handle(command: RecipeCommand, snapshot: Snapshot, today: DateISO): Handled {
  switch (command.type) {
    case 'SaveRecipe':
      return saveRecipe(command.payload, snapshot);
    case 'DeleteRecipe':
      return deleteRecipe(command.payload, snapshot);
    case 'CookRecipes':
      return cookRecipes(command.payload, snapshot, today);
  }
}

/**
 * BX-04 RecipeCommandCoordinator. Creates, edits and deletes recipes, and runs the cook queue (blueprint
 * 3.2). It has three workflows, one for each of the three commands that `handle` routes.
 *
 * It reads and writes nothing, so that the whole cook loop can be replayed. `cookRecipes` cooks the queued
 * recipes strictly in queue order against a running copy of the snapshot: each recipe commits as a unit of
 * its own, the next one sees the depleted stock, and there is no rollback of the queue (spec 4.5). It
 * returns one ChangeSet for each recipe that was cooked and one report entry for each queued entry. The top
 * coordinator then writes the ChangeSets one by one, so a recipe that was cooked stays cooked even if a
 * later write fails.
 */
export function createRecipeCommandCoordinator() {
  return { handle };
}
