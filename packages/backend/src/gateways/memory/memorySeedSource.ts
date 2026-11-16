import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import type { RawSeed } from '@freshrescue/contract-seed';
import type { SeedSourcePort } from '../ports';

/**
 * The in-memory stand-in for SeedSourceGateway (BG-05, phase 7): it holds the pre-load document that it
 * is given and hands out a fresh copy at each read, as a file read would. It does not import any test
 * data, because production code never imports `testing/`: whoever builds it passes the document in.
 * A document that cannot be copied is reported as SEED_UNREADABLE, never thrown.
 */
export function createMemorySeedSource(seed: RawSeed): SeedSourcePort {
  return {
    read: async (): Promise<Result<RawSeed, DomainError>> => {
      try {
        return { ok: true, value: structuredClone(seed) };
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        return { ok: false, err: { code: 'SEED_UNREADABLE', detail: `the seed cannot be read: ${reason}` } };
      }
    },
  };
}
