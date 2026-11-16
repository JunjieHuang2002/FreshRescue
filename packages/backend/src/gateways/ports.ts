import type { WriteOps } from '@freshrescue/contract-changeset';
import type { RawStore } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { DateISO, Empty, Result } from '@freshrescue/contract-primitives';
import type { RawSeed } from '@freshrescue/contract-seed';

// The four interfaces that BackendCoordinator uses to reach the outside world (plan, phase 6). Each real
// gateway of phase 7 and each in-memory stand-in implements one of them, so the coordinator never knows
// which it was given. A port never throws and its promise never rejects: a failure is an Err of the
// catalog, built by the gateway from whatever its native call threw (blueprint 1.1, "Errors are values").

/**
 * BG-02's port. The whole persisted document in one read, or `null` when the store holds nothing, which
 * is how a fresh store reads. STORE_UNAVAILABLE when the store cannot be read.
 */
export type StoreReadPort = {
  read(): Promise<Result<RawStore | null, DomainError>>;
};

/**
 * BG-03's port. One batch of operations applied all or nothing: when it fails (STORE_WRITE_FAILED) the
 * store is as it was before the call.
 */
export type StoreWritePort = {
  apply(ops: WriteOps): Promise<Result<Empty, DomainError>>;
};

/** BG-04's port. Today's date on the device's own calendar. */
export type ClockPort = {
  today(): DateISO;
};

/** BG-05's port. The pre-load document, as its source holds it. SEED_UNREADABLE when it cannot be read. */
export type SeedSourcePort = {
  read(): Promise<Result<RawSeed, DomainError>>;
};
