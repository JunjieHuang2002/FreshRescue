import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import type { RawSeed } from '@freshrescue/contract-seed';
import type { SeedSourcePort } from './ports';

/** Where the pre-load document lives: `packages/backend/seed/freshrescue.seed.json` (plan, phase 7). */
export const SEED_LOCATION = fileURLToPath(new URL('../../seed/freshrescue.seed.json', import.meta.url));

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
const unreadable = (detail: string): Result<never, DomainError> => ({ ok: false, err: { code: 'SEED_UNREADABLE', detail } });

/**
 * BG-05 SeedSourceGateway. Reads the pre-load seed document from its file and hands it on as the JSON
 * value it holds, which SeedBundleParser then checks (blueprint 1.3). It reads the file at each call,
 * so each read is a fresh document. The location is a constant; a test may pass another one.
 *
 * SEED_UNREADABLE when the file cannot be read, or what it holds is not JSON at all. A document that
 * is JSON but not a seed is the parser's business (BAD_SEED and the rest). Nothing is thrown: the two
 * native calls that can throw, reading the file and `JSON.parse`, are caught and converted.
 */
export function createSeedSourceGateway(location: string = SEED_LOCATION): SeedSourcePort {
  return {
    read: async (): Promise<Result<RawSeed, DomainError>> => {
      let text: string;
      try {
        text = await readFile(location, 'utf8');
      } catch (cause) {
        return unreadable(`the seed file ${location} cannot be read: ${reasonOf(cause)}`);
      }
      try {
        return { ok: true, value: JSON.parse(text) as RawSeed };
      } catch (cause) {
        return unreadable(`the seed file ${location} is not JSON: ${reasonOf(cause)}`);
      }
    },
  };
}
