import { describe, expect, it } from 'vitest';
import { EMPTY_SNAPSHOT } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { SYSTEM_IDS } from '@freshrescue/contract-rules';
import { buildSnapshot, OTHER_CUISINE, OTHER_FOOD_CATEGORY } from '../../testing/fixtures';
import { changeSetApplier } from '../state/changeSetApplier';
import { snapshotInvariantChecker } from './snapshotInvariantChecker';
import { systemDataInitializer } from './systemDataInitializer';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);

describe('BC-39 SystemDataInitializer', () => {
  it('adds both system categories Other to an empty store, with their reserved ids (spec 1.2)', () => {
    expect(systemDataInitializer(EMPTY_SNAPSHOT)).toEqual({
      ops: [
        { kind: 'putFoodCategory', row: { id: SYSTEM_IDS.FOOD_OTHER, name: 'Other', parentId: null, isSystem: true, customThresholdDays: null } },
        { kind: 'putRecipeCategory', row: { id: SYSTEM_IDS.CUISINE_OTHER, name: 'Other', isSystem: true } },
      ],
    });
  });

  it('makes the food Other a top-level leaf with no threshold, and the cuisine Other a plain tag', () => {
    const after = valueOf(changeSetApplier(EMPTY_SNAPSHOT, systemDataInitializer(EMPTY_SNAPSHOT)));

    expect(after.foodCategories).toEqual([OTHER_FOOD_CATEGORY]);
    expect(after.recipeCategories).toEqual([OTHER_CUISINE]);
  });

  it('gives an empty ChangeSet when both are present, so running it again changes nothing', () => {
    expect(systemDataInitializer(buildSnapshot())).toEqual({ ops: [] });

    const once = valueOf(changeSetApplier(EMPTY_SNAPSHOT, systemDataInitializer(EMPTY_SNAPSHOT)));
    expect(systemDataInitializer(once)).toEqual({ ops: [] });
  });

  it('adds only the one that is missing', () => {
    const noCuisine = { ...buildSnapshot(), recipeCategories: [] };
    const noFoodCategory = { ...buildSnapshot(), foodCategories: [] };

    expect(systemDataInitializer(noCuisine).ops.map((op) => op.kind)).toEqual(['putRecipeCategory']);
    expect(systemDataInitializer(noFoodCategory).ops.map((op) => op.kind)).toEqual(['putFoodCategory']);
  });

  it('leaves the counters alone: ids 1 and 2 are below the first id the counter hands out', () => {
    const changeSet = systemDataInitializer(EMPTY_SNAPSHOT);

    expect(changeSet.ops.some((op) => op.kind === 'putCounters')).toBe(false);
    expect(EMPTY_SNAPSHOT.counters.nextId).toBeGreaterThan(Math.max(SYSTEM_IDS.FOOD_OTHER, SYSTEM_IDS.CUISINE_OTHER));
  });

  it('turns an empty store into one that passes the invariant checker', () => {
    const after = valueOf(changeSetApplier(EMPTY_SNAPSHOT, systemDataInitializer(EMPTY_SNAPSHOT)));

    expect(snapshotInvariantChecker(EMPTY_SNAPSHOT)).toMatchObject({ ok: false, err: { code: 'INVARIANT_BROKEN' } });
    expect(snapshotInvariantChecker(after)).toEqual({ ok: true, value: after });
  });
});
