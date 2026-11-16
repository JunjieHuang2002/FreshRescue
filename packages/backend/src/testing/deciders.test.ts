import { describe, expect, it } from 'vitest';
import type { ChangeSet } from '@freshrescue/contract-changeset';
import { EMPTY_SNAPSHOT } from '@freshrescue/contract-entities';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { CommandPayloads } from '@freshrescue/contract-messages';
import type { DateISO, Id, Named, Result, ValidName, ValidQty, ValidThreshold, ValidUnit } from '@freshrescue/contract-primitives';
import type { NameScope } from '@freshrescue/contract-rules';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import { batchCreateDecider } from '../modules/decide/batchCreateDecider';
import { batchQuantityEditDecider } from '../modules/decide/batchQuantityEditDecider';
import { batchRemoveDecider } from '../modules/decide/batchRemoveDecider';
import { categoryCreateDecider } from '../modules/decide/categoryCreateDecider';
import { categoryDeleteDecider } from '../modules/decide/categoryDeleteDecider';
import { categoryRenameDecider } from '../modules/decide/categoryRenameDecider';
import { categoryThresholdDecider } from '../modules/decide/categoryThresholdDecider';
import { foodTypeCreateDecider } from '../modules/decide/foodTypeCreateDecider';
import { foodTypeDeleteDecider } from '../modules/decide/foodTypeDeleteDecider';
import { foodTypeEditDecider } from '../modules/decide/foodTypeEditDecider';
import { foodTypeResolver } from '../modules/decide/foodTypeResolver';
import { recipeDeleteDecider } from '../modules/decide/recipeDeleteDecider';
import { recipeDraftValidator } from '../modules/decide/recipeDraftValidator';
import { recipeUpsertDecider } from '../modules/decide/recipeUpsertDecider';
import { settingsDecider } from '../modules/decide/settingsDecider';
import { unitChangeDecider } from '../modules/decide/unitChangeDecider';
import { categoryPathResolver } from '../modules/derive/categoryPathResolver';
import { recipeErrorEvaluator } from '../modules/derive/recipeErrorEvaluator';
import { changeSetMerger } from '../modules/engine/changeSetMerger';
import { seedPlanner } from '../modules/engine/seedPlanner';
import { snapshotInvariantChecker } from '../modules/engine/snapshotInvariantChecker';
import { systemDataInitializer } from '../modules/engine/systemDataInitializer';
import { capChecker } from '../modules/foundation/capChecker';
import { expiryResolver } from '../modules/foundation/expiryResolver';
import { idAllocator } from '../modules/foundation/idAllocator';
import { nameValidator } from '../modules/foundation/nameValidator';
import { scalarValidator } from '../modules/foundation/scalarValidator';
import { thresholdResolver } from '../modules/foundation/thresholdResolver';
import { seedBundleParser } from '../modules/parsing/seedBundleParser';
import { changeSetApplier } from '../modules/state/changeSetApplier';
import { APPENDIX_A_SEED } from './fixtures';

// The plan's one test that crosses modules (phase 5): the ChangeSet of every decider's success case is
// applied with ChangeSetApplier, and SnapshotInvariantChecker has to accept the result. A decider that
// proposed an illegal state, or forgot a cascade, fails here, and not only in the coordinator test of
// phase 6. The workflows below are the blueprint's pseudocode (4.2) written out with the modules, so
// the coordinators of phase 6 will find the wiring already proven.

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

/** The keys of the invariant rules that a result breaks, in the order the checker lists them. */
const brokenRules = (result: Result<unknown, DomainError>): string[] =>
  result.ok ? [] : [...(result.err.detail ?? '').matchAll(/\[(\w+)\]/g)].map((match) => match[1] ?? '');

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as object)) deepFreeze(inner);
  }
  return value;
}

const TODAY: DateISO = '2026-10-01';

// ---- the write path and the workflows ---------------------------------------------------------

/** BackendCoordinator.persist (blueprint 4.2): each ChangeSet is applied to the snapshot, and the result is checked. */
function persist(from: Snapshot, ...changeSets: readonly ChangeSet[]): Result<Snapshot, DomainError> {
  let current = from;
  for (const changeSet of changeSets) {
    const applied = changeSetApplier(current, changeSet);
    if (!applied.ok) return applied;
    const checked = snapshotInvariantChecker(applied.value);
    if (!checked.ok) return checked;
    current = checked.value;
  }
  return { ok: true, value: current };
}

/** A workflow that creates one record: reserve one id, let the decider use it, and put the counter bump in front (blueprint 4.2). */
function creating(snapshot: Snapshot, decide: (id: Id) => Result<ChangeSet, DomainError>): ChangeSet {
  const alloc = idAllocator(snapshot.counters, { ids: 1, seqs: 0 });
  return changeSetMerger([alloc.counterCs, valueOf(decide(alloc.ids[0] ?? expect.unreachable('no id was reserved')))]);
}

/** InventoryCommandCoordinator.inbound (blueprint 4.2). A new name creates the Food Type with its first batch, in one ChangeSet. */
function inbound(snapshot: Snapshot, today: DateISO, cmd: CommandPayloads['InboundBatch']): Result<ChangeSet, DomainError> {
  const ref = foodTypeResolver(cmd.foodTypeId, cmd.foodName, snapshot);
  if (!ref.ok) return ref;
  const qty = scalarValidator('qty', cmd.quantity);
  if (!qty.ok) return qty;
  const dates = expiryResolver(cmd.expiry, today);
  if (!dates.ok) return dates;

  const alloc = idAllocator(snapshot.counters, { ids: ref.value.kind === 'new' ? 2 : 1, seqs: 1 });
  const parts: ChangeSet[] = [alloc.counterCs];
  let foodTypeId: Id;
  if (ref.value.kind === 'new') {
    foodTypeId = alloc.ids[0] ?? 0;
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
  parts.push(batchCreateDecider(foodTypeId, qty.value, dates.value, alloc.ids.at(-1) ?? 0, alloc.seqs[0] ?? 0));
  return { ok: true, value: changeSetMerger(parts) };
}

/** InventoryCommandCoordinator.changeUnit (blueprint 4.2). */
function changeUnit(snapshot: Snapshot, cmd: CommandPayloads['ChangeFoodTypeUnit']): Result<ChangeSet, DomainError> {
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
  return unitChangeDecider(cmd.foodTypeId, unit.value, rows, snapshot);
}

/** RecipeCommandCoordinator.saveRecipe (blueprint 4.2). An edit reserves no id, so there is no first id to hand over, and the decider ignores it. */
function saveRecipe(snapshot: Snapshot, cmd: CommandPayloads['SaveRecipe']): Result<ChangeSet, DomainError> {
  const name = nameValidator(cmd.name, 'recipe', snapshot, cmd.recipeId);
  if (!name.ok) return name;
  const draft = recipeDraftValidator(cmd.draft, snapshot);
  if (!draft.ok) return draft;
  const alloc = idAllocator(snapshot.counters, { ids: cmd.recipeId === null ? 1 : 0, seqs: 0 });
  const upserted = recipeUpsertDecider(cmd.recipeId, name.value, draft.value, snapshot, alloc.ids[0] ?? 0);
  return upserted.ok ? { ok: true, value: changeSetMerger([alloc.counterCs, upserted.value]) } : upserted;
}

// ---- the store the cases start from -------------------------------------------------------------

const parsedSeed = valueOf(seedBundleParser(APPENDIX_A_SEED));

/** ReferenceCommandCoordinator.bootstrap (blueprint 4.2) on an empty store: the system data, the counter bump, then the Appendix A plan. */
function bootstrap(): Snapshot {
  const alloc = idAllocator(EMPTY_SNAPSHOT.counters, { ids: parsedSeed.idDemand, seqs: 0 });
  const changeSet = changeSetMerger([systemDataInitializer(EMPTY_SNAPSHOT), alloc.counterCs, seedPlanner(parsedSeed, alloc.ids, EMPTY_SNAPSHOT)]);
  return valueOf(persist(EMPTY_SNAPSHOT, changeSet));
}

const inboundOf = (foodName: string, milli: number, days: number): CommandPayloads['InboundBatch'] => ({
  foodTypeId: null,
  foodName,
  categoryId: null,
  unit: null,
  quantity: milli,
  expiry: { days },
});

/** Stock added through the inbound workflow, one request after the other, each persisted. */
function stocked(from: Snapshot, ...requests: readonly CommandPayloads['InboundBatch'][]): Snapshot {
  let current = from;
  for (const request of requests) current = valueOf(persist(current, valueOf(inbound(current, TODAY, request))));
  return current;
}

/** Appendix A as it is after startup: 8 Food Types, 6 recipes and no stock. Frozen, so that nothing can edit it. */
const seeded: Snapshot = deepFreeze(bootstrap());

/** The same, with stock: Chicken 100 g and 200 g, Beef 150 g, Milk 500 ml. */
const kitchen: Snapshot = deepFreeze(
  stocked(seeded, inboundOf('Chicken', 100_000, 3), inboundOf('Chicken', 200_000, 10), inboundOf('Beef', 150_000, 5), inboundOf('Milk', 500_000, 5)),
);

const idOf = (rows: readonly Named[], name: string): Id => rows.find((row) => row.name === name)?.id ?? expect.unreachable(`there is no "${name}"`);
const food = (snapshot: Snapshot, name: string): Id => idOf(snapshot.foodTypes, name);
const category = (snapshot: Snapshot, name: string): Id => idOf(snapshot.foodCategories, name);
const cuisine = (snapshot: Snapshot, name: string): Id => idOf(snapshot.recipeCategories, name);
const recipe = (snapshot: Snapshot, name: string): Id => idOf(snapshot.recipes, name);
const batchOf = (snapshot: Snapshot, foodTypeName: string, index = 0): Id =>
  snapshot.batches.filter((batch) => batch.foodTypeId === food(snapshot, foodTypeName))[index]?.id ?? expect.unreachable(`there is no batch of ${foodTypeName}`);

const nameOf = (snapshot: Snapshot, raw: string, scope: NameScope, selfId: Id | null = null): ValidName => valueOf(nameValidator(raw, scope, snapshot, selfId));
const unitOf = (raw: string): ValidUnit => valueOf(scalarValidator('unit', raw));
const qtyOf = (milli: number): ValidQty => valueOf(scalarValidator('qty', milli));
const daysOf = (count: number): ValidThreshold => valueOf(scalarValidator('thresholdDays', count));

// ---- the success case of every decider ------------------------------------------------------------

/** A case starts from `kitchen` unless it names a store of its own, which a case that clears something needs. */
type Case = {
  readonly module: string;
  readonly title: string;
  readonly decide: (snapshot: Snapshot) => ChangeSet;
  readonly from?: Snapshot;
};

/** The kitchen, with a threshold of 5 days on Meat, and the kitchen with Simulated Today set: stores that have something to clear. */
const meatHasThreshold: Snapshot = deepFreeze(valueOf(persist(kitchen, valueOf(categoryThresholdDecider(category(kitchen, 'Meat'), daysOf(5), kitchen)))));
const todayIsSimulated: Snapshot = deepFreeze(valueOf(persist(kitchen, settingsDecider('2026-10-05'))));

const CASES: readonly Case[] = [
  {
    module: 'BC-20',
    title: 'a new Parent',
    decide: (s) => creating(s, (id) => categoryCreateDecider('foodCategory', nameOf(s, 'Fruit', 'foodCategory'), null, s, id)),
  },
  {
    module: 'BC-20',
    title: 'a new Child under Meat',
    decide: (s) => creating(s, (id) => categoryCreateDecider('foodCategory', nameOf(s, 'Game', 'foodCategory'), category(s, 'Meat'), s, id)),
  },
  {
    module: 'BC-20',
    title: 'a new cuisine',
    decide: (s) => creating(s, (id) => categoryCreateDecider('cuisine', nameOf(s, 'Japanese Cuisine', 'cuisine'), null, s, id)),
  },
  {
    module: 'BC-21',
    title: 'a Parent renamed',
    decide: (s) => valueOf(categoryRenameDecider('foodCategory', category(s, 'Meat'), nameOf(s, 'Meats', 'foodCategory', category(s, 'Meat')), s)),
  },
  {
    module: 'BC-21',
    title: 'a cuisine renamed',
    decide: (s) => valueOf(categoryRenameDecider('cuisine', cuisine(s, 'French Cuisine'), nameOf(s, 'Cuisine Française', 'cuisine', cuisine(s, 'French Cuisine')), s)),
  },
  { module: 'BC-22', title: 'a Parent with Children, Food Types and stock', decide: (s) => valueOf(categoryDeleteDecider('foodCategory', category(s, 'Meat'), s)) },
  { module: 'BC-22', title: 'a Child', decide: (s) => valueOf(categoryDeleteDecider('foodCategory', category(s, 'Leafy Greens'), s)) },
  { module: 'BC-22', title: 'a cuisine with recipes', decide: (s) => valueOf(categoryDeleteDecider('cuisine', cuisine(s, 'Chinese Cuisine'), s)) },
  { module: 'BC-23', title: 'a threshold set on a Child', decide: (s) => valueOf(categoryThresholdDecider(category(s, 'Red Meat'), daysOf(2), s)) },
  { module: 'BC-23', title: 'a threshold cleared', decide: (s) => valueOf(categoryThresholdDecider(category(s, 'Meat'), null, s)), from: meatHasThreshold },
  {
    module: 'BC-24',
    title: 'a Food Type in the default category',
    decide: (s) => creating(s, (id) => foodTypeCreateDecider(nameOf(s, 'Salt', 'foodType'), null, unitOf('grams'), null, s, id)),
  },
  {
    module: 'BC-24',
    title: 'a Food Type in a Child, with a threshold',
    decide: (s) =>
      creating(s, (id) => foodTypeCreateDecider(nameOf(s, 'Kale', 'foodType'), category(s, 'Leafy Greens'), unitOf('grams'), daysOf(2), s, id)),
  },
  {
    module: 'BC-25',
    title: 'a Food Type renamed, moved and given a threshold',
    decide: (s) =>
      valueOf(foodTypeEditDecider(food(s, 'Tomato'), nameOf(s, 'Tomatoes', 'foodType', food(s, 'Tomato')), category(s, 'Leafy Greens'), daysOf(2), s)),
  },
  {
    module: 'BC-25',
    title: 'a Food Type moved to Other with its threshold cleared',
    decide: (s) => valueOf(foodTypeEditDecider(food(s, 'Beef'), nameOf(s, 'Beef', 'foodType', food(s, 'Beef')), null, null, s)),
  },
  { module: 'BC-26', title: 'a Food Type with no batch that a recipe uses', decide: (s) => valueOf(foodTypeDeleteDecider(food(s, 'Spinach'), s)) },
  {
    module: 'BC-27',
    title: 'a unit change with two batches (spec 4.2.2)',
    decide: (s) =>
      valueOf(
        changeUnit(s, {
          foodTypeId: food(s, 'Chicken'),
          unit: 'pieces',
          batches: [
            { batchId: batchOf(s, 'Chicken', 0), quantity: 500 },
            { batchId: batchOf(s, 'Chicken', 1), quantity: 1000 },
          ],
        }),
      ),
  },
  { module: 'BC-27', title: 'a unit change with no batch', decide: (s) => valueOf(changeUnit(s, { foodTypeId: food(s, 'Rice'), unit: 'kg', batches: [] })) },
  { module: 'BC-28', title: 'an inbound by name that joins a Food Type, whatever the case', decide: (s) => valueOf(inbound(s, TODAY, inboundOf('MILK', 250_000, 4))) },
  {
    module: 'BC-28',
    title: 'an inbound by name that creates a Food Type and its first batch',
    decide: (s) => valueOf(inbound(s, TODAY, { ...inboundOf('Mango', 2_500, 6), unit: 'pieces', categoryId: category(s, 'Vegetables') })),
  },
  {
    module: 'BC-29',
    title: 'an inbound by id',
    decide: (s) => valueOf(inbound(s, TODAY, { ...inboundOf('', 300_000, 20), foodTypeId: food(s, 'Rice'), foodName: null })),
  },
  {
    module: 'BC-30',
    title: 'a batch quantity edited',
    decide: (s) => {
      expect(capChecker(s, { kind: 'edit', batchId: batchOf(s, 'Chicken'), qty: qtyOf(120_500) }).ok).toBe(true);
      return valueOf(batchQuantityEditDecider(batchOf(s, 'Chicken'), qtyOf(120_500), s));
    },
  },
  { module: 'BC-31', title: 'the only batch of a Food Type removed', decide: (s) => valueOf(batchRemoveDecider(batchOf(s, 'Beef'), s)) },
  {
    module: 'BC-32',
    title: 'a new recipe, with the default cuisine',
    decide: (s) =>
      valueOf(
        saveRecipe(s, {
          recipeId: null,
          name: 'Beef Rice',
          draft: {
            cuisineId: null,
            rows: [
              { foodTypeId: food(s, 'Beef'), quantity: 100_000, unit: 'grams' },
              { foodTypeId: food(s, 'Rice'), quantity: 200_000, unit: 'grams' },
            ],
          },
        }),
      ),
  },
  {
    module: 'BC-33',
    title: 'a recipe edited: its name, cuisine and rows replaced',
    decide: (s) =>
      valueOf(
        saveRecipe(s, {
          recipeId: recipe(s, 'Spinach Omelette'),
          name: 'Spinach Omelette Deluxe',
          draft: {
            cuisineId: cuisine(s, 'Vietnamese Cuisine'),
            rows: [
              { foodTypeId: food(s, 'Egg'), quantity: 4_000, unit: 'pieces' },
              { foodTypeId: food(s, 'Spinach'), quantity: 80_000, unit: 'grams' },
            ],
          },
        }),
      ),
  },
  { module: 'BC-34', title: 'a recipe deleted with its rows', decide: (s) => valueOf(recipeDeleteDecider(recipe(s, 'Tomato Egg Stir-Fry'), s)) },
  { module: 'BC-35', title: 'Simulated Today set', decide: () => settingsDecider('2026-10-05') },
  { module: 'BC-35', title: 'Simulated Today cleared', decide: () => settingsDecider(null), from: todayIsSimulated },
];

describe('the 16 deciders, together', () => {
  describe('every success case gives a state that the invariant checker accepts', () => {
    it.each(CASES)('$module: $title', ({ decide, from = kitchen }) => {
      const changeSet = decide(from);

      const applied = valueOf(changeSetApplier(from, changeSet));

      expect(snapshotInvariantChecker(applied)).toEqual({ ok: true, value: applied });
      expect(applied).not.toEqual(from);
    });

    it('has at least one success case for each of BC-20 to BC-35', () => {
      const covered = new Set(CASES.map((testCase) => testCase.module));

      expect([...covered].sort()).toEqual(Array.from({ length: 16 }, (_, offset) => `BC-${20 + offset}`));
    });

    it('starts from a store that is itself legal: the Appendix A bootstrap, with stock', () => {
      expect(snapshotInvariantChecker(seeded).ok).toBe(true);
      expect(snapshotInvariantChecker(kitchen).ok).toBe(true);
      expect(seeded.foodTypes.map((foodType) => foodType.name)).toEqual(['Beef', 'Broccoli', 'Chicken', 'Egg', 'Milk', 'Rice', 'Spinach', 'Tomato']);
      expect(kitchen.batches).toHaveLength(4);
    });
  });

  describe('spec 4.2.1: one Food Type, two batches', () => {
    it('keeps Milk as one Food Type under Dairy → Liquid Dairy, with two batches that have their own dates', () => {
      const oct1 = valueOf(persist(seeded, valueOf(inbound(seeded, '2026-10-01', inboundOf('Milk', 500_000, 5)))));
      const oct2 = valueOf(persist(oct1, valueOf(inbound(oct1, '2026-10-02', inboundOf('milk', 1_000_000, 10)))));
      const milk = food(oct2, 'Milk');

      expect(oct2.foodTypes.filter((foodType) => foodType.name.toLowerCase() === 'milk')).toHaveLength(1);
      expect(categoryPathResolver(oct2)[milk]?.names).toEqual(['Dairy', 'Liquid Dairy']);
      expect(oct2.batches.map((batch) => [batch.foodTypeId, batch.quantity, batch.inboundDate, batch.expirationDate, batch.createdSeq])).toEqual([
        [milk, 500_000, '2026-10-01', '2026-10-06', 1],
        [milk, 1_000_000, '2026-10-02', '2026-10-12', 2],
      ]);
    });
  });

  describe('spec 4.2.2: changing the unit of Chicken, with batches of 100 g and 200 g, to pieces', () => {
    const chicken = food(kitchen, 'Chicken');
    const [first, second] = [batchOf(kitchen, 'Chicken', 0), batchOf(kitchen, 'Chicken', 1)];

    it('is one ChangeSet that changes the unit and both quantities', () => {
      const changeSet = valueOf(changeUnit(kitchen, { foodTypeId: chicken, unit: 'pieces', batches: [{ batchId: first, quantity: 500 }, { batchId: second, quantity: 1000 }] }));
      const next = valueOf(persist(kitchen, changeSet));

      expect(changeSet.ops.map((op) => op.kind)).toEqual(['putFoodType', 'putBatch', 'putBatch']);
      expect(next.foodTypes.find((foodType) => foodType.id === chicken)?.unit).toBe('pieces');
      expect(next.batches.filter((batch) => batch.foodTypeId === chicken).map((batch) => [batch.id, batch.quantity])).toEqual([[first, 500], [second, 1000]]);
    });

    it('makes the recipes that need grams of Chicken Unit Conflicts, without rewriting them (spec 4.2.2.4)', () => {
      const next = valueOf(persist(kitchen, valueOf(changeUnit(kitchen, { foodTypeId: chicken, unit: 'pieces', batches: [{ batchId: first, quantity: 500 }, { batchId: second, quantity: 1000 }] }))));
      const conflicted = Object.entries(recipeErrorEvaluator(next)).map(([id]) => Number(id));

      expect(conflicted.sort()).toEqual(['Chicken Broccoli Gratin', 'Chicken Fried Rice', 'Vietnamese Chicken Rice'].map((name) => recipe(next, name)).sort());
      expect(next.recipeIngredients).toEqual(kitchen.recipeIngredients);
    });

    it('is refused as a whole when a batch is left out (BATCH_SET_MISMATCH) or the unit is the same (UNIT_UNCHANGED)', () => {
      expect(errorOf(changeUnit(kitchen, { foodTypeId: chicken, unit: 'pieces', batches: [{ batchId: first, quantity: 500 }] })).code).toBe('BATCH_SET_MISMATCH');
      expect(errorOf(changeUnit(kitchen, { foodTypeId: chicken, unit: 'grams', batches: [{ batchId: first, quantity: 500 }, { batchId: second, quantity: 1000 }] })).code).toBe('UNIT_UNCHANGED');
    });

    it('is refused as a whole when the new total is over the cap (CAP_EXCEEDED), before the decider is asked', () => {
      const tooMuch = { foodTypeId: chicken, unit: 'kg', batches: [{ batchId: first, quantity: 300_000_000 }, { batchId: second, quantity: 200_000_001 }] };

      expect(errorOf(changeUnit(kitchen, tooMuch)).code).toBe('CAP_EXCEEDED');
    });
  });

  describe('deleting a category, a Food Type and a recipe cascades as the specification says (exception rows 7, 9 and 15)', () => {
    it('row 9: deleting a Parent moves its Food Types to Other, drops the thresholds, and T_eff is derived again', () => {
      const meat = category(kitchen, 'Meat');
      const withThresholds = valueOf(
        persist(
          kitchen,
          valueOf(categoryThresholdDecider(meat, daysOf(5), kitchen)),
        ),
      );
      const redMeatThreshold = valueOf(persist(withThresholds, valueOf(categoryThresholdDecider(category(withThresholds, 'Red Meat'), daysOf(2), withThresholds))));
      const [beef, chicken] = [food(redMeatThreshold, 'Beef'), food(redMeatThreshold, 'Chicken')];
      const before = thresholdResolver(redMeatThreshold);

      const after = valueOf(persist(redMeatThreshold, valueOf(categoryDeleteDecider('foodCategory', meat, redMeatThreshold))));

      expect(before[beef]).toEqual({ days: 2, source: 'child' });
      expect(before[chicken]).toEqual({ days: 5, source: 'parent' });
      expect(thresholdResolver(after)[beef]).toEqual({ days: 3, source: 'global' });
      expect(thresholdResolver(after)[chicken]).toEqual({ days: 3, source: 'global' });
      expect(after.foodCategories.map((candidate) => candidate.name)).toEqual(['Other', 'Dairy', 'Liquid Dairy', 'Vegetables', 'Leafy Greens']);
      expect(categoryPathResolver(after)[beef]?.names).toEqual(['Other']);
      expect(after.batches).toEqual(redMeatThreshold.batches);
    });

    it('row 9: deleting a cuisine moves its recipes to the cuisine Other', () => {
      const after = valueOf(persist(kitchen, valueOf(categoryDeleteDecider('cuisine', cuisine(kitchen, 'Chinese Cuisine'), kitchen))));

      const chineseRecipes = ['Beef and Broccoli Stir-Fry', 'Chicken Fried Rice', 'Tomato Egg Stir-Fry'];
      expect(chineseRecipes.map((name) => after.recipes.find((candidate) => candidate.id === recipe(after, name))?.recipeCategoryId)).toEqual([
        SYSTEM_IDS.CUISINE_OTHER,
        SYSTEM_IDS.CUISINE_OTHER,
        SYSTEM_IDS.CUISINE_OTHER,
      ]);
      expect(after.recipes).toHaveLength(kitchen.recipes.length);
    });

    it('row 15: a Food Type with a batch is not deleted (HAS_BATCHES), and it is once its last batch is removed', () => {
      const beef = food(kitchen, 'Beef');
      expect(errorOf(foodTypeDeleteDecider(beef, kitchen))).toMatchObject({ code: 'HAS_BATCHES', detail: 'Remove the 1 batch first' });

      const drained = valueOf(persist(kitchen, valueOf(batchRemoveDecider(batchOf(kitchen, 'Beef'), kitchen))));
      const after = valueOf(persist(drained, valueOf(foodTypeDeleteDecider(beef, drained))));

      expect(after.foodTypes.some((foodType) => foodType.id === beef)).toBe(false);
    });

    it('row 7: a recipe that used the deleted Food Type keeps its row and its name for display, and is blocked', () => {
      const beef = food(kitchen, 'Beef');
      const drained = valueOf(persist(kitchen, valueOf(batchRemoveDecider(batchOf(kitchen, 'Beef'), kitchen))));
      const after = valueOf(persist(drained, valueOf(foodTypeDeleteDecider(beef, drained))));
      const stirFry = recipe(after, 'Beef and Broccoli Stir-Fry');

      expect(after.recipeIngredients.filter((row) => row.recipeId === stirFry).map((row) => [row.foodTypeId, row.requiredQuantity, row.deletedFoodTypeName])).toEqual([
        [beef, 300_000, 'Beef'],
        [food(after, 'Broccoli'), 200_000, null],
      ]);
      expect(recipeErrorEvaluator(after)[stirFry]).toEqual([{ reason: 'missingFoodType', foodTypeId: beef, deletedFoodTypeName: 'Beef' }]);
    });

    it('a deleted recipe takes its rows with it, and the Food Types it used stay', () => {
      const after = valueOf(persist(kitchen, valueOf(recipeDeleteDecider(recipe(kitchen, 'Chicken Fried Rice'), kitchen))));

      expect(after.recipes).toHaveLength(kitchen.recipes.length - 1);
      expect(after.recipeIngredients).toHaveLength(kitchen.recipeIngredients.length - 3);
      expect(after.foodTypes).toEqual(kitchen.foodTypes);
    });
  });

  describe('names and categories (exception rows 3, 18 and 19)', () => {
    it('row 18: an inbound name that matches a Food Type, ignoring case, adds a batch to it and creates nothing', () => {
      for (const typed of ['MILK', 'milk', ' Milk ']) {
        const next = valueOf(persist(kitchen, valueOf(inbound(kitchen, TODAY, inboundOf(typed, 100_000, 4)))));

        expect(next.foodTypes).toEqual(kitchen.foodTypes);
        expect(next.batches).toHaveLength(kitchen.batches.length + 1);
        expect(next.batches.at(-1)?.foodTypeId).toBe(food(kitchen, 'Milk'));
      }
    });

    it('row 18: a name that matches nothing creates a Food Type and its first batch together, and nothing is matched loosely', () => {
      for (const typed of ['Tomatoes', 'Mlik', 'Chick']) {
        const request = { ...inboundOf(typed, 100_000, 4), unit: 'grams' };
        const changeSet = valueOf(inbound(kitchen, TODAY, request));
        const next = valueOf(persist(kitchen, changeSet));

        expect(changeSet.ops.map((op) => op.kind)).toEqual(['putCounters', 'putFoodType', 'putBatch']);
        expect(next.foodTypes).toHaveLength(kitchen.foodTypes.length + 1);
        expect(next.foodTypes.at(-1)).toMatchObject({ name: typed, unit: 'grams', categoryId: SYSTEM_IDS.FOOD_OTHER });
        expect(next.batches.at(-1)?.foodTypeId).toBe(next.foodTypes.at(-1)?.id);
      }
    });

    it('row 3: an inbound that names no Food Type is an empty name (NAME_EMPTY), and so is a name of blanks', () => {
      expect(errorOf(inbound(kitchen, TODAY, { ...inboundOf('', 100_000, 4), foodName: null, unit: 'grams' }))).toMatchObject({ code: 'NAME_EMPTY' });
      expect(errorOf(inbound(kitchen, TODAY, { ...inboundOf('   ', 100_000, 4), unit: 'grams' })).code).toBe('NAME_EMPTY');
    });

    it('a new name with no unit creates nothing: the Food Type and its batch are made together or not at all (spec 4.2.5)', () => {
      expect(errorOf(inbound(kitchen, TODAY, inboundOf('Mango', 100_000, 4))).code).toBe('UNIT_UNKNOWN');
    });

    it('row 19: a category named Other is refused by NameValidator, in both trees', () => {
      expect(errorOf(nameValidator('other', 'foodCategory', kitchen, null)).code).toBe('NAME_RESERVED');
      expect(errorOf(nameValidator('OTHER', 'cuisine', kitchen, null)).code).toBe('NAME_RESERVED');
    });

    it('row 19: a Child under Other, or under a Child, is refused by the decider (PARENT_INVALID)', () => {
      const name = nameOf(kitchen, 'Snacks', 'foodCategory');

      expect(errorOf(categoryCreateDecider('foodCategory', name, SYSTEM_IDS.FOOD_OTHER, kitchen, 99)).code).toBe('PARENT_INVALID');
      expect(errorOf(categoryCreateDecider('foodCategory', name, category(kitchen, 'Red Meat'), kitchen, 99)).code).toBe('PARENT_INVALID');
    });
  });

  describe('recipe drafts', () => {
    const beef = food(kitchen, 'Beef');
    const row = (foodTypeId: Id, quantity: number, unit = 'grams') => ({ foodTypeId, quantity, unit });
    const draftError = (rows: readonly ReturnType<typeof row>[], cuisineId: Id | null = null): string =>
      errorOf(saveRecipe(kitchen, { recipeId: null, name: 'New Recipe', draft: { cuisineId, rows } })).code;

    it('are refused with the code of the rule they break, and nothing is written', () => {
      expect(draftError([])).toBe('NO_INGREDIENTS');
      expect(draftError([row(beef, 1_000), row(beef, 2_000)])).toBe('DUP_INGREDIENT');
      expect(draftError([row(999, 1_000)])).toBe('UNKNOWN_FOOD_TYPE');
      expect(draftError([row(beef, 0)])).toBe('QTY_NOT_POSITIVE');
      expect(draftError([row(beef, 500_000_001)])).toBe('QTY_TOO_LARGE');
      expect(draftError([row(beef, 1.5)])).toBe('QTY_NOT_INTEGER');
      expect(draftError([row(beef, 1_000, 'tbsp')])).toBe('UNIT_UNKNOWN');
      expect(draftError([row(beef, 1_000)], 999)).toBe('CATEGORY_NOT_FOUND');
    });

    it('are refused when the recipe name is taken, whatever its case, by the validator before the draft is looked at', () => {
      const duplicate = saveRecipe(kitchen, { recipeId: null, name: 'chicken fried rice', draft: { cuisineId: null, rows: [] } });

      expect(errorOf(duplicate).code).toBe('NAME_DUPLICATE');
    });

    it('may name a Required Unit that is not the Food Type\'s, and the recipe is then a Unit Conflict (spec section 3)', () => {
      const changeSet = valueOf(saveRecipe(kitchen, { recipeId: null, name: 'Beef Soup', draft: { cuisineId: null, rows: [row(beef, 300, 'kg')] } }));
      const next = valueOf(persist(kitchen, changeSet));

      expect(recipeErrorEvaluator(next)[recipe(next, 'Beef Soup')]).toEqual([{ reason: 'unitConflict', foodTypeId: beef, requiredUnit: 'kg', foodTypeUnit: 'grams' }]);
    });

    it('can repair a recipe that a deleted Food Type blocked: the user picks another Food Type for the row (spec 4.2.4.4)', () => {
      const drained = valueOf(persist(kitchen, valueOf(batchRemoveDecider(batchOf(kitchen, 'Beef'), kitchen))));
      const deleted = valueOf(persist(drained, valueOf(foodTypeDeleteDecider(beef, drained))));
      const stirFry = recipe(deleted, 'Beef and Broccoli Stir-Fry');
      expect(recipeErrorEvaluator(deleted)[stirFry]).toBeDefined();

      const repaired = valueOf(
        persist(
          deleted,
          valueOf(
            saveRecipe(deleted, {
              recipeId: stirFry,
              name: 'Beef and Broccoli Stir-Fry',
              draft: { cuisineId: cuisine(deleted, 'Chinese Cuisine'), rows: [row(food(deleted, 'Chicken'), 300_000), row(food(deleted, 'Broccoli'), 200_000)] },
            }),
          ),
        ),
      );

      expect(recipeErrorEvaluator(repaired)[stirFry]).toBeUndefined();
    });
  });

  describe('the invariant checker is the second line of defence: a decider that skipped a cascade would be refused', () => {
    const without = (changeSet: ChangeSet, drop: (op: ChangeSet['ops'][number]) => boolean): ChangeSet => ({ ops: changeSet.ops.filter((op) => !drop(op)) });

    it('a category delete that left its Food Types behind breaks foodTypeCategory', () => {
      const full = valueOf(categoryDeleteDecider('foodCategory', category(kitchen, 'Meat'), kitchen));

      expect(brokenRules(persist(kitchen, without(full, (op) => op.kind === 'putFoodType')))).toContain('foodTypeCategory');
    });

    it('a Parent delete that left its Children behind breaks parentExists', () => {
      const full = valueOf(categoryDeleteDecider('foodCategory', category(kitchen, 'Meat'), kitchen));
      const childIds = [category(kitchen, 'Red Meat'), category(kitchen, 'Poultry')];

      expect(brokenRules(persist(kitchen, without(full, (op) => op.kind === 'deleteFoodCategory' && childIds.includes(op.id))))).toContain('parentExists');
    });

    it('a cuisine delete that left its recipes behind breaks recipeCuisine', () => {
      const full = valueOf(categoryDeleteDecider('cuisine', cuisine(kitchen, 'Chinese Cuisine'), kitchen));

      expect(brokenRules(persist(kitchen, without(full, (op) => op.kind === 'putRecipe')))).toContain('recipeCuisine');
    });

    it('a Food Type delete that did not stamp the rows breaks rowFoodType', () => {
      const full = valueOf(foodTypeDeleteDecider(food(kitchen, 'Spinach'), kitchen));

      expect(brokenRules(persist(kitchen, without(full, (op) => op.kind === 'putIngredient')))).toContain('rowFoodType');
    });

    it('a recipe delete that left the rows behind breaks rowRecipe', () => {
      const full = valueOf(recipeDeleteDecider(recipe(kitchen, 'Chicken Fried Rice'), kitchen));

      expect(brokenRules(persist(kitchen, without(full, (op) => op.kind === 'deleteIngredientsOfRecipe')))).toContain('rowRecipe');
    });

    it('a new record without the counter bump breaks counters, which is why the coordinator merges IdAllocator\'s ChangeSet in', () => {
      const alloc = idAllocator(kitchen.counters, { ids: 1, seqs: 0 });
      const created = valueOf(categoryCreateDecider('cuisine', nameOf(kitchen, 'Japanese Cuisine', 'cuisine'), null, kitchen, alloc.ids[0] ?? 0));

      expect(brokenRules(persist(kitchen, created))).toContain('counters');
      expect(persist(kitchen, changeSetMerger([alloc.counterCs, created])).ok).toBe(true);
    });

    it('a delete of an unknown record never gets that far: the decider refuses it, and the applier would too (UNKNOWN_TARGET)', () => {
      expect(errorOf(batchRemoveDecider(999, kitchen)).code).toBe('BATCH_NOT_FOUND');
      expect(errorOf(changeSetApplier(kitchen, { ops: [{ kind: 'deleteBatch', id: 999 }] })).code).toBe('UNKNOWN_TARGET');
    });
  });
});
