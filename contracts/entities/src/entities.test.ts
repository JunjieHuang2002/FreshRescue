import type { DateISO, Id, QtyMilli, ValidQty, ValidUnit } from '@freshrescue/contract-primitives';
import { FIRST_FREE_ID } from '@freshrescue/contract-rules';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { EMPTY_SNAPSHOT, SNAPSHOT_LISTS } from './index';
import type {
  Batch,
  Counters,
  FoodCategory,
  FoodType,
  RawStore,
  Recipe,
  RecipeCategory,
  RecipeIngredient,
  Settings,
  Snapshot,
  SnapshotList,
  ValidRecipeDraft,
} from './index';

describe('entities', () => {
  it('names the six lists of a snapshot', () => {
    expectTypeOf<SnapshotList>().toEqualTypeOf<Exclude<keyof Snapshot, 'settings' | 'counters'>>();
    expectTypeOf<Snapshot['settings']>().toEqualTypeOf<Settings>();
    expectTypeOf<Snapshot['counters']>().toEqualTypeOf<Counters>();

    expect(SNAPSHOT_LISTS).toHaveLength(6);
    expect(new Set(SNAPSHOT_LISTS).size).toBe(6);
    for (const list of SNAPSHOT_LISTS) expect(EMPTY_SNAPSHOT[list]).toEqual([]);
  });

  it('gives each record the fields of the specification', () => {
    expectTypeOf<FoodCategory>().toEqualTypeOf<{
      readonly id: Id;
      readonly name: string;
      readonly parentId: Id | null;
      readonly isSystem: boolean;
      readonly customThresholdDays: number | null;
    }>();
    expectTypeOf<FoodType>().toEqualTypeOf<{
      readonly id: Id;
      readonly name: string;
      readonly categoryId: Id;
      readonly unit: string;
      readonly customThresholdDays: number | null;
    }>();
    expectTypeOf<Batch>().toEqualTypeOf<{
      readonly id: Id;
      readonly foodTypeId: Id;
      readonly quantity: QtyMilli;
      readonly inboundDate: DateISO;
      readonly expirationDate: DateISO;
      readonly createdSeq: number;
    }>();
    expectTypeOf<RecipeCategory>().toEqualTypeOf<{ readonly id: Id; readonly name: string; readonly isSystem: boolean }>();
    expectTypeOf<Recipe>().toEqualTypeOf<{ readonly id: Id; readonly name: string; readonly recipeCategoryId: Id }>();
    expectTypeOf<RecipeIngredient>().toEqualTypeOf<{
      readonly recipeId: Id;
      readonly foodTypeId: Id;
      readonly requiredQuantity: QtyMilli;
      readonly requiredUnit: string;
      readonly deletedFoodTypeName: string | null;
    }>();
    expectTypeOf<Settings>().toEqualTypeOf<{ readonly simulatedToday: DateISO | null; readonly bootstrapped: boolean }>();
    expectTypeOf<Counters>().toEqualTypeOf<{ readonly nextId: Id; readonly nextSeq: number }>();
    expectTypeOf<RawStore>().toEqualTypeOf<Readonly<Record<string, unknown>>>();

    // a real batch: 500 ml of Milk on Oct 1 with a 5-day shelf life (spec 4.2.1)
    const milk: Batch = {
      id: 12,
      foodTypeId: 5,
      quantity: 500_000,
      inboundDate: '2026-10-01',
      expirationDate: '2026-10-06',
      createdSeq: 1,
    };
    expect(milk.expirationDate > milk.inboundDate).toBe(true);
  });

  it('starts an empty store with the two system ids reserved and a draft that is validated', () => {
    expect(EMPTY_SNAPSHOT.settings).toEqual({ simulatedToday: null, bootstrapped: false });
    expect(EMPTY_SNAPSHOT.counters).toEqual({ nextId: FIRST_FREE_ID, nextSeq: 1 });

    // a validated draft carries branded quantities and units, so unvalidated text cannot reach a decider
    expectTypeOf<ValidRecipeDraft['rows'][number]>().toEqualTypeOf<{
      readonly foodTypeId: Id;
      readonly requiredQuantity: ValidQty;
      readonly requiredUnit: ValidUnit;
    }>();
    expectTypeOf<ValidRecipeDraft['recipeCategoryId']>().toEqualTypeOf<Id>();
  });
});
