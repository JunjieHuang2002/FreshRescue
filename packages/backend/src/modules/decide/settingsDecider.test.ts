import { describe, expect, it } from 'vitest';
import { EMPTY_SNAPSHOT } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { buildBatch, buildFoodType, buildSnapshot } from '../../testing/fixtures';
import { snapshotInvariantChecker } from '../engine/snapshotInvariantChecker';
import { todayResolver } from '../foundation/todayResolver';
import { changeSetApplier } from '../state/changeSetApplier';
import { settingsDecider } from './settingsDecider';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);

/** A bootstrapped store with a Food Type and a batch, and no Simulated Today. */
const snapshot = buildSnapshot({
  foodTypes: [buildFoodType({ id: 30, name: 'Chicken' })],
  batches: [buildBatch({ id: 40, foodTypeId: 30 })],
  settings: { simulatedToday: null, bootstrapped: true },
});

describe('BC-35 SettingsDecider', () => {
  it('sets Simulated Today to the date', () => {
    expect(settingsDecider('2026-10-05')).toEqual({
      ops: [{ kind: 'putSettings', row: { simulatedToday: '2026-10-05', bootstrapped: true } }],
    });
  });

  it('clears Simulated Today with null, so that the device date is used again (spec section 3)', () => {
    expect(settingsDecider(null)).toEqual({ ops: [{ kind: 'putSettings', row: { simulatedToday: null, bootstrapped: true } }] });
  });

  it('writes one operation and nothing else: no Food Type, no batch, no counter', () => {
    expect(settingsDecider('2026-10-05').ops).toHaveLength(1);
    expect(settingsDecider(null).ops).toHaveLength(1);
  });

  it('keeps the store bootstrapped: a command reaches a decider only after startup has seeded the store', () => {
    const after = valueOf(changeSetApplier(snapshot, settingsDecider('2026-10-05')));

    expect(after.settings).toEqual({ simulatedToday: '2026-10-05', bootstrapped: true });
    expect(snapshot.settings.bootstrapped).toBe(true);
  });

  it('changes nothing in the store but the setting, and the result is a legal state', () => {
    const set = valueOf(changeSetApplier(snapshot, settingsDecider('2026-10-05')));
    const cleared = valueOf(changeSetApplier(set, settingsDecider(null)));

    expect({ ...set, settings: snapshot.settings }).toEqual(snapshot);
    expect(cleared).toEqual(snapshot);
    expect(snapshotInvariantChecker(set)).toEqual({ ok: true, value: set });
  });

  it('is what the next request resolves today from: the date while it is set, the device date after it is cleared (spec 4.3.4)', () => {
    const set = valueOf(changeSetApplier(snapshot, settingsDecider('2026-10-05')));
    const cleared = valueOf(changeSetApplier(set, settingsDecider(null)));

    expect(todayResolver('2026-10-01', set.settings.simulatedToday)).toBe('2026-10-05');
    expect(todayResolver('2026-10-01', cleared.settings.simulatedToday)).toBe('2026-10-01');
  });

  it('has no error: it answers a ChangeSet and not a Result, and a date can be set again over a date', () => {
    const first = valueOf(changeSetApplier(snapshot, settingsDecider('2026-10-05')));
    const second = valueOf(changeSetApplier(first, settingsDecider('2026-12-25')));

    expect('ok' in settingsDecider('2026-10-05')).toBe(false);
    expect(second.settings.simulatedToday).toBe('2026-12-25');
  });

  it('does not judge the date: CommandParser refuses a malformed one (DATE_INVALID), and the invariant checker is the second line', () => {
    for (const malformed of ['not-a-date', '2026-02-30', '2026-13-01', '10/05/2026']) {
      const after = valueOf(changeSetApplier(snapshot, settingsDecider(malformed)));
      const checked = snapshotInvariantChecker(after);

      expect(checked).toMatchObject({ ok: false, err: { code: 'INVARIANT_BROKEN' } });
      expect(checked.ok ? '' : checked.err.detail).toContain('[dates]');
    }
  });

  it('cannot leave a store half seeded: on a store without the system categories the result is refused', () => {
    const after = valueOf(changeSetApplier(EMPTY_SNAPSHOT, settingsDecider('2026-10-05')));

    expect(snapshotInvariantChecker(after)).toMatchObject({ ok: false, err: { code: 'INVARIANT_BROKEN' } });
  });
});
