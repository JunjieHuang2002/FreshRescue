import type { ChangeSet } from '@freshrescue/contract-changeset';
import type { DateISO } from '@freshrescue/contract-primitives';

/**
 * BC-35 SettingsDecider. Builds the ChangeSet that sets Simulated Today to a date, or clears it with
 * `null` so that the device date is used again (spec section 3 and 4.3.4). The next request resolves
 * `today` from it.
 *
 * It judges nothing, so it has no error. A malformed date was refused earlier by CommandParser
 * (DATE_INVALID), and SnapshotInvariantChecker checks the stored date once more (`dates`).
 *
 * The blueprint gives this module the date and nothing else, and a settings operation replaces the
 * whole row: `simulatedToday` and `bootstrapped`. It writes `bootstrapped: true`, which is what the
 * store holds whenever a command is handled, because startup seeds a store that is not bootstrapped
 * before the first request is served (blueprint 2.3). The store cannot be left half-seeded by this
 * ChangeSet: on a store that has no system categories the invariant checker refuses the result.
 */
export function settingsDecider(date: DateISO | null): ChangeSet {
  return { ops: [{ kind: 'putSettings', row: { simulatedToday: date, bootstrapped: true } }] };
}
