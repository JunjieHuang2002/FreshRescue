import { describe, expect, it } from 'vitest';
import type { Outcome } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { CommandPayloads } from '@freshrescue/contract-messages';
import type { Result } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import { buildBatch, buildFoodCategory, buildFoodType, buildIngredient, buildRecipe, buildSnapshot } from '../testing/fixtures';
import { recipeErrorEvaluator } from '../modules/derive/recipeErrorEvaluator';
import { snapshotInvariantChecker } from '../modules/engine/snapshotInvariantChecker';
import { changeSetApplier } from '../modules/state/changeSetApplier';
import { createInventoryCommandCoordinator } from './InventoryCommandCoordinator';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);
const errorOf = (result: Result<unknown, DomainError>): DomainError =>
  result.ok ? expect.unreachable('expected an Err, but got an Ok') : result.err;

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as object)) deepFreeze(inner);
  }
  return value;
}

/** What the write path does with an Outcome: each ChangeSet applied in order, and every result checked. */
function settle(from: Snapshot, outcome: Outcome): Snapshot {
  let current = from;
  for (const changeSet of outcome.changeSets ?? []) {
    current = valueOf(changeSetApplier(current, changeSet));
    valueOf(snapshotInvariantChecker(current));
  }
  return current;
}

const coordinator = createInventoryCommandCoordinator();
const TODAY = '2026-10-01';

const [MEAT, CHICKEN, MILK, BEEF, EGG] = [10, 30, 31, 32, 33];

/**
 * Chicken (30, grams) has two batches, 40 with 100 g and 41 with 200 g. Milk (31, ml) has none. Beef (32, grams) has one
 * batch of 450,000, which is near the cap of 500,000. Egg (33, pieces) is used by a recipe. Meat (10) is a food category.
 * The counters are at 44 and 5. Frozen, so that a workflow that edited its input would fail.
 */
const snapshot: Snapshot = deepFreeze(
  buildSnapshot({
    foodCategories: [buildFoodCategory({ id: MEAT, name: 'Meat' })],
    foodTypes: [
      buildFoodType({ id: CHICKEN, name: 'Chicken' }),
      buildFoodType({ id: MILK, name: 'Milk', unit: 'ml' }),
      buildFoodType({ id: BEEF, name: 'Beef' }),
      buildFoodType({ id: EGG, name: 'Egg', unit: 'pieces' }),
    ],
    batches: [
      buildBatch({ id: 40, foodTypeId: CHICKEN, quantity: 100_000, createdSeq: 1 }),
      buildBatch({ id: 41, foodTypeId: CHICKEN, quantity: 200_000, createdSeq: 2, inboundDate: '2026-10-02', expirationDate: '2026-10-12' }),
      buildBatch({ id: 42, foodTypeId: BEEF, quantity: 450_000_000, createdSeq: 3 }),
    ],
    recipes: [buildRecipe({ id: 50, name: 'Chicken Rice' })],
    recipeIngredients: [buildIngredient({ recipeId: 50, foodTypeId: CHICKEN, requiredQuantity: 250_000, requiredUnit: 'grams' })],
  }),
);
const [NEXT_ID, NEXT_SEQ] = [snapshot.counters.nextId, snapshot.counters.nextSeq];

type Inbound = CommandPayloads['InboundBatch'];

/** An inbound of 50 g of Chicken, picked by id, with a shelf life of 5 days, unless a test says otherwise. */
const inboundOf = (over: Partial<Inbound> = {}): Inbound => ({
  foodTypeId: CHICKEN,
  foodName: null,
  categoryId: null,
  unit: null,
  quantity: 50_000,
  expiry: { days: 5 },
  ...over,
});
const inbound = (over: Partial<Inbound> = {}) => coordinator.handle({ type: 'InboundBatch', payload: inboundOf(over) }, snapshot, TODAY);

describe('BX-03 InventoryCommandCoordinator', () => {
  describe('inbound: a batch of a Food Type that exists', () => {
    it('takes one id and one sequence number from the counters, and adds the batch with the dates of the shelf life', () => {
      expect(valueOf(inbound()).changeSets).toEqual([
        {
          ops: [
            { kind: 'putCounters', row: { nextId: NEXT_ID + 1, nextSeq: NEXT_SEQ + 1 } },
            {
              kind: 'putBatch',
              row: { id: NEXT_ID, foodTypeId: CHICKEN, quantity: 50_000, inboundDate: TODAY, expirationDate: '2026-10-06', createdSeq: NEXT_SEQ },
            },
          ],
        },
      ]);
    });

    it('has no payload: a command answers with the id it made only when it made a Food Type or a recipe or a category', () => {
      expect(valueOf(inbound()).payload).toBeUndefined();
    });

    it('finds the Food Type by name when no id is given, ignoring the case and the spaces, and creates nothing (spec exception row 18)', () => {
      for (const typed of ['chicken', 'CHICKEN', '  Chicken ']) {
        const outcome = valueOf(inbound({ foodTypeId: null, foodName: typed }));

        expect(outcome.changeSets?.[0]?.ops.map((op) => op.kind), typed).toEqual(['putCounters', 'putBatch']);
        expect(settle(snapshot, outcome).foodTypes).toEqual(snapshot.foodTypes);
      }
    });

    it('takes a date as the expiry: the batch expires on that date, and today is allowed', () => {
      const dated = valueOf(inbound({ expiry: { date: '2026-11-20' } }));
      const today = valueOf(inbound({ expiry: { date: TODAY } }));

      expect(settle(snapshot, dated).batches.at(-1)).toMatchObject({ inboundDate: TODAY, expirationDate: '2026-11-20' });
      expect(settle(snapshot, today).batches.at(-1)).toMatchObject({ inboundDate: TODAY, expirationDate: TODAY });
    });

    it('takes the inbound date from the `today` it is given, which may be Simulated Today, and not from any clock', () => {
      const outcome = valueOf(coordinator.handle({ type: 'InboundBatch', payload: inboundOf({ expiry: { days: 2 } }) }, snapshot, '2026-12-30'));

      expect(settle(snapshot, outcome).batches.at(-1)).toMatchObject({ inboundDate: '2026-12-30', expirationDate: '2027-01-01' });
    });

    it('does not look at the unit or the category of the command: they belong to the Food Type, which has them (spec 4.2.2, the Inbound Lock)', () => {
      const outcome = valueOf(inbound({ unit: 'kg', categoryId: 999 }));

      expect(outcome.changeSets?.[0]?.ops.map((op) => op.kind)).toEqual(['putCounters', 'putBatch']);
    });

    it('turns the store into a legal one, and never merges batches: the same Food Type and dates make a new batch', () => {
      const after = settle(snapshot, valueOf(inbound({ quantity: 100_000, expiry: { date: '2026-10-04' } })));

      expect(after.batches.filter((batch) => batch.foodTypeId === CHICKEN)).toHaveLength(3);
    });

    it('allows a total of exactly 500,000 and refuses anything over it, with the Expired stock counted (CAP_EXCEEDED)', () => {
      expect(valueOf(inbound({ foodTypeId: BEEF, quantity: 50_000_000 })).changeSets).toHaveLength(1);
      expect(errorOf(inbound({ foodTypeId: BEEF, quantity: 50_000_001 })).code).toBe('CAP_EXCEEDED');
    });
  });

  describe('inbound: a name that matches no Food Type (spec 4.2.5 and exception row 18)', () => {
    const mango = (over: Partial<Inbound> = {}) => inbound({ foodTypeId: null, foodName: 'Mango', unit: 'pieces', quantity: 2_500, ...over });

    it('creates the Food Type and its first batch in one ChangeSet, taking two ids from the counter and one sequence number', () => {
      const outcome = valueOf(mango());

      expect(outcome.changeSets).toHaveLength(1);
      expect(outcome.changeSets?.[0]).toEqual({
        ops: [
          { kind: 'putCounters', row: { nextId: NEXT_ID + 2, nextSeq: NEXT_SEQ + 1 } },
          { kind: 'putFoodType', row: { id: NEXT_ID, name: 'Mango', categoryId: SYSTEM_IDS.FOOD_OTHER, unit: 'pieces', customThresholdDays: null } },
          {
            kind: 'putBatch',
            row: { id: NEXT_ID + 1, foodTypeId: NEXT_ID, quantity: 2_500, inboundDate: TODAY, expirationDate: '2026-10-06', createdSeq: NEXT_SEQ },
          },
        ],
      });
    });

    it('puts the Food Type in the category that was chosen, or in Other when none was', () => {
      const chosen = settle(snapshot, valueOf(mango({ categoryId: MEAT })));
      const defaulted = settle(snapshot, valueOf(mango()));

      expect(chosen.foodTypes.at(-1)?.categoryId).toBe(MEAT);
      expect(defaulted.foodTypes.at(-1)?.categoryId).toBe(SYSTEM_IDS.FOOD_OTHER);
    });

    it('trims the name, keeps its case, and gives the Food Type no threshold of its own', () => {
      const after = settle(snapshot, valueOf(mango({ foodName: '  mango  Chutney ' })));

      expect(after.foodTypes.at(-1)).toMatchObject({ name: 'mango  Chutney', customThresholdDays: null });
    });

    it('does not take a near name for the same Food Type: Chickens, Chick and Mlik are new (spec exception row 18)', () => {
      for (const typed of ['Chickens', 'Chick', 'Mlik']) {
        const after = settle(snapshot, valueOf(mango({ foodName: typed })));

        expect(after.foodTypes, typed).toHaveLength(snapshot.foodTypes.length + 1);
      }
    });

    it('lets the first batch be as large as the cap', () => {
      expect(mango({ quantity: 500_000_000 }).ok).toBe(true);
    });

    it('needs a unit, one of the six, spelled as in the list (UNIT_UNKNOWN)', () => {
      expect(errorOf(mango({ unit: null })).code).toBe('UNIT_UNKNOWN');
      expect(errorOf(mango({ unit: 'dozen' })).code).toBe('UNIT_UNKNOWN');
    });

    it('needs a category that is in the food tree (CATEGORY_NOT_FOUND)', () => {
      expect(errorOf(mango({ categoryId: 999 })).code).toBe('CATEGORY_NOT_FOUND');
    });

    it('refuses a name that is too long (NAME_TOO_LONG), and writes nothing for any of these', () => {
      expect(errorOf(mango({ foodName: 'x'.repeat(201) })).code).toBe('NAME_TOO_LONG');
    });
  });

  describe('inbound: a request that names no Food Type is an empty name (spec exception row 3)', () => {
    it('answers NAME_EMPTY when it carries neither an id nor a name, which is what the form sends when its name is left blank', () => {
      expect(errorOf(inbound({ foodTypeId: null, foodName: null, unit: 'grams' })).code).toBe('NAME_EMPTY');
    });

    it('answers NAME_EMPTY for a name of blanks, with or without a unit', () => {
      expect(errorOf(inbound({ foodTypeId: null, foodName: '   ', unit: 'grams' })).code).toBe('NAME_EMPTY');
      expect(errorOf(inbound({ foodTypeId: null, foodName: '', unit: null })).code).toBe('NAME_EMPTY');
    });
  });

  describe('inbound: the checks run in the order of the blueprint (4.2)', () => {
    it('looks for the Food Type first: an id that is no Food Type is FOOD_TYPE_NOT_FOUND, whatever else is wrong', () => {
      expect(errorOf(inbound({ foodTypeId: 999, quantity: 0, expiry: { days: -1 } })).code).toBe('FOOD_TYPE_NOT_FOUND');
    });

    it('checks the quantity next (QTY_NOT_INTEGER, QTY_NOT_POSITIVE, QTY_TOO_LARGE), before the expiry', () => {
      expect(errorOf(inbound({ quantity: 1.5, expiry: { days: -1 } })).code).toBe('QTY_NOT_INTEGER');
      expect(errorOf(inbound({ quantity: 0, expiry: { days: -1 } })).code).toBe('QTY_NOT_POSITIVE');
      expect(errorOf(inbound({ quantity: 500_000_001, expiry: { days: -1 } })).code).toBe('QTY_TOO_LARGE');
    });

    it('checks the expiry before the name: a shelf life of -1 (DAYS_INVALID) or a date in the past (PAST_EXPIRY)', () => {
      expect(errorOf(inbound({ foodTypeId: null, foodName: null, expiry: { days: -1 } })).code).toBe('DAYS_INVALID');
      expect(errorOf(inbound({ foodTypeId: null, foodName: null, expiry: { days: 1.5 } })).code).toBe('DAYS_INVALID');
      expect(errorOf(inbound({ foodTypeId: null, foodName: null, expiry: { date: '2026-09-30' } })).code).toBe('PAST_EXPIRY');
      expect(errorOf(inbound({ expiry: { date: '2026-09-30' } })).code).toBe('PAST_EXPIRY');
    });

    it('checks the name before the unit, and the unit before the category', () => {
      expect(errorOf(inbound({ foodTypeId: null, foodName: '', unit: null, categoryId: 999 })).code).toBe('NAME_EMPTY');
      expect(errorOf(inbound({ foodTypeId: null, foodName: 'Mango', unit: null, categoryId: 999 })).code).toBe('UNIT_UNKNOWN');
      expect(errorOf(inbound({ foodTypeId: null, foodName: 'Mango', unit: 'pieces', categoryId: 999 })).code).toBe('CATEGORY_NOT_FOUND');
    });

    it('checks the cap last, after the Food Type is known to be good', () => {
      expect(errorOf(inbound({ foodTypeId: BEEF, quantity: 60_000_000 })).code).toBe('CAP_EXCEEDED');
    });
  });

  describe('editQuantity', () => {
    const edit = (batchId: number, quantity: number) => coordinator.handle({ type: 'EditBatchQuantity', payload: { batchId, quantity } }, snapshot, TODAY);

    it('replaces the quantity of the batch and nothing else, with no payload and no counter', () => {
      const outcome = valueOf(edit(40, 75_500));

      expect(outcome.payload).toBeUndefined();
      expect(outcome.changeSets).toEqual([
        {
          ops: [{ kind: 'putBatch', row: { id: 40, foodTypeId: CHICKEN, quantity: 75_500, inboundDate: '2026-10-01', expirationDate: '2026-10-04', createdSeq: 1 } }],
        },
      ]);
      expect(settle(snapshot, outcome).batches.map((batch) => batch.quantity)).toEqual([75_500, 200_000, 450_000_000]);
    });

    it('counts the batch itself once: a batch may be set to what it has, and up to exactly the cap (spec section 3)', () => {
      expect(edit(42, 450_000_000).ok).toBe(true);
      expect(edit(42, 500_000_000).ok).toBe(true);
      expect(errorOf(edit(42, 500_000_001)).code).toBe('QTY_TOO_LARGE');
    });

    it('refuses a quantity that is not above zero or not whole (QTY_NOT_POSITIVE, QTY_NOT_INTEGER), because editing to 0 means remove', () => {
      expect(errorOf(edit(40, 0)).code).toBe('QTY_NOT_POSITIVE');
      expect(errorOf(edit(40, -1)).code).toBe('QTY_NOT_POSITIVE');
      expect(errorOf(edit(40, 0.5)).code).toBe('QTY_NOT_INTEGER');
    });

    it('refuses an edit that takes the total over the cap, with the sibling batches counted (CAP_EXCEEDED)', () => {
      const crowded = deepFreeze(
        buildSnapshot({
          foodTypes: [buildFoodType({ id: CHICKEN, name: 'Chicken' })],
          batches: [buildBatch({ id: 40, foodTypeId: CHICKEN, quantity: 300_000_000 }), buildBatch({ id: 41, foodTypeId: CHICKEN, quantity: 150_000_000 })],
        }),
      );
      const crowdedEdit = (quantity: number) => coordinator.handle({ type: 'EditBatchQuantity', payload: { batchId: 40, quantity } }, crowded, TODAY);

      expect(crowdedEdit(350_000_000).ok).toBe(true);
      expect(errorOf(crowdedEdit(350_000_001)).code).toBe('CAP_EXCEEDED');
    });

    it('refuses a batch that is not there (BATCH_NOT_FOUND), after the quantity has been judged', () => {
      expect(errorOf(edit(999, 1_000)).code).toBe('BATCH_NOT_FOUND');
      expect(errorOf(edit(999, 0)).code).toBe('QTY_NOT_POSITIVE');
    });
  });

  describe('removeBatch', () => {
    const remove = (batchId: number) => coordinator.handle({ type: 'RemoveBatch', payload: { batchId } }, snapshot, TODAY);

    it('deletes the one batch, whole, and leaves the Food Type registered', () => {
      const outcome = valueOf(remove(42));
      const after = settle(snapshot, outcome);

      expect(outcome.changeSets).toEqual([{ ops: [{ kind: 'deleteBatch', id: 42 }] }]);
      expect(outcome.payload).toBeUndefined();
      expect(after.batches.map((batch) => batch.id)).toEqual([40, 41]);
      expect(after.foodTypes).toEqual(snapshot.foodTypes);
    });

    it('refuses a batch that is not there (BATCH_NOT_FOUND)', () => {
      expect(errorOf(remove(999)).code).toBe('BATCH_NOT_FOUND');
    });
  });

  describe('changeUnit: the worked example of spec 4.2.2', () => {
    const change = (over: Partial<CommandPayloads['ChangeFoodTypeUnit']> = {}) =>
      coordinator.handle(
        {
          type: 'ChangeFoodTypeUnit',
          payload: {
            foodTypeId: CHICKEN,
            unit: 'pieces',
            batches: [
              { batchId: 40, quantity: 500 },
              { batchId: 41, quantity: 1_000 },
            ],
            ...over,
          },
        },
        snapshot,
        TODAY,
      );

    it('changes the unit and both quantities in one ChangeSet, with no payload and no counter', () => {
      const outcome = valueOf(change());

      expect(outcome.payload).toBeUndefined();
      expect(outcome.changeSets).toHaveLength(1);
      expect(outcome.changeSets?.[0]?.ops.map((op) => op.kind)).toEqual(['putFoodType', 'putBatch', 'putBatch']);
      const after = settle(snapshot, outcome);
      expect(after.foodTypes.find((foodType) => foodType.id === CHICKEN)?.unit).toBe('pieces');
      expect(after.batches.filter((batch) => batch.foodTypeId === CHICKEN).map((batch) => batch.quantity)).toEqual([500, 1_000]);
    });

    it('leaves the dates and createdSeq of the batches, and the recipes, as they were: a recipe in grams is now a Unit Conflict', () => {
      const after = settle(snapshot, valueOf(change()));

      expect(after.batches[0]).toMatchObject({ inboundDate: '2026-10-01', expirationDate: '2026-10-04', createdSeq: 1 });
      expect(after.recipeIngredients).toEqual(snapshot.recipeIngredients);
      expect(recipeErrorEvaluator(after)[50]).toEqual([{ reason: 'unitConflict', foodTypeId: CHICKEN, requiredUnit: 'grams', foodTypeUnit: 'pieces' }]);
    });

    it('changes the unit at once when the Food Type has no batch', () => {
      const outcome = valueOf(change({ foodTypeId: MILK, unit: 'liters', batches: [] }));

      expect(settle(snapshot, outcome).foodTypes.find((foodType) => foodType.id === MILK)?.unit).toBe('liters');
    });

    it('is refused as a whole when the new total is over 500,000, and says CAP_EXCEEDED (the blocked write of the plan)', () => {
      const tooMuch = change({ batches: [{ batchId: 40, quantity: 300_000_000 }, { batchId: 41, quantity: 200_000_001 }] });

      expect(errorOf(tooMuch).code).toBe('CAP_EXCEEDED');
      expect(change({ batches: [{ batchId: 40, quantity: 300_000_000 }, { batchId: 41, quantity: 200_000_000 }] }).ok).toBe(true);
    });

    it('refuses a unit that is not on the list (UNIT_UNKNOWN) and a quantity that is not valid (QTY_NOT_POSITIVE, QTY_NOT_INTEGER, QTY_TOO_LARGE)', () => {
      expect(errorOf(change({ unit: 'dozen' })).code).toBe('UNIT_UNKNOWN');
      expect(errorOf(change({ batches: [{ batchId: 40, quantity: 0 }, { batchId: 41, quantity: 1_000 }] })).code).toBe('QTY_NOT_POSITIVE');
      expect(errorOf(change({ batches: [{ batchId: 40, quantity: 1.5 }, { batchId: 41, quantity: 1_000 }] })).code).toBe('QTY_NOT_INTEGER');
      expect(errorOf(change({ batches: [{ batchId: 40, quantity: 500_000_001 }, { batchId: 41, quantity: 1 }] })).code).toBe('QTY_TOO_LARGE');
    });

    it('refuses the unit it already has (UNIT_UNCHANGED), a Food Type that is not there (FOOD_TYPE_NOT_FOUND) and a list that is not its batches (BATCH_SET_MISMATCH)', () => {
      expect(errorOf(change({ unit: 'grams' })).code).toBe('UNIT_UNCHANGED');
      expect(errorOf(change({ foodTypeId: 999 })).code).toBe('FOOD_TYPE_NOT_FOUND');
      expect(errorOf(change({ batches: [{ batchId: 40, quantity: 500 }] })).code).toBe('BATCH_SET_MISMATCH');
      expect(errorOf(change({ batches: [{ batchId: 40, quantity: 500 }, { batchId: 42, quantity: 1_000 }] })).code).toBe('BATCH_SET_MISMATCH');
    });

    it('checks the unit, then each quantity, then the cap, and only then the batches: the cap beats BATCH_SET_MISMATCH', () => {
      expect(errorOf(change({ unit: 'dozen', batches: [{ batchId: 40, quantity: 0 }] })).code).toBe('UNIT_UNKNOWN');
      expect(errorOf(change({ batches: [{ batchId: 40, quantity: 0 }, { batchId: 41, quantity: 500_000_001 }] })).code).toBe('QTY_NOT_POSITIVE');
      expect(errorOf(change({ batches: [{ batchId: 99, quantity: 500_000_000 }, { batchId: 98, quantity: 500_000_000 }] })).code).toBe('CAP_EXCEEDED');
      expect(errorOf(change({ unit: 'grams', batches: [] })).code).toBe('UNIT_UNCHANGED');
    });
  });

  it('handles each of its four commands, and leaves the snapshot it was given as it was', () => {
    const before = structuredClone(snapshot);

    for (const command of [
      { type: 'InboundBatch', payload: inboundOf() },
      { type: 'EditBatchQuantity', payload: { batchId: 40, quantity: 5_000 } },
      { type: 'RemoveBatch', payload: { batchId: 40 } },
      { type: 'ChangeFoodTypeUnit', payload: { foodTypeId: MILK, unit: 'liters', batches: [] } },
    ] as const) {
      expect(coordinator.handle(command, snapshot, TODAY).ok, command.type).toBe(true);
    }

    expect(snapshot).toEqual(before);
  });
});
