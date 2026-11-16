import { describe, expect, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { APPENDIX_A_SEED } from '../../testing/fixtures';
import { seedBundleParser } from '../../modules/parsing/seedBundleParser';
import { createMemorySeedSource } from './memorySeedSource';

const valueOf = <T>(result: Result<T, DomainError>): T =>
  result.ok ? result.value : expect.unreachable(`expected Ok, but got ${result.err.code}: ${result.err.detail}`);

describe('createMemorySeedSource', () => {
  it('reads the document that it holds, as it is', async () => {
    const source = createMemorySeedSource(APPENDIX_A_SEED);

    expect(await source.read()).toEqual({ ok: true, value: APPENDIX_A_SEED });
  });

  it('gives a document that SeedBundleParser accepts, when it holds the Appendix A seed', async () => {
    const parsed = valueOf(seedBundleParser(valueOf(await createMemorySeedSource(APPENDIX_A_SEED).read())));

    expect(parsed.idDemand).toBe(24);
  });

  it('hands out a fresh copy at each read, as a file read would: changing one changes nothing else', async () => {
    const seed = { foodCategories: [{ key: 'meat' }] };
    const source = createMemorySeedSource(seed);

    const first = valueOf(await source.read()) as typeof seed;
    first.foodCategories.push({ key: 'extra' });
    first.foodCategories[0] = { key: 'changed' };

    expect(valueOf(await source.read())).toEqual({ foodCategories: [{ key: 'meat' }] });
    expect(seed).toEqual({ foodCategories: [{ key: 'meat' }] });
  });

  it('holds anything, not only a valid seed, because reading is not judging: SeedBundleParser judges it (BAD_SEED)', async () => {
    for (const seed of [null, 42, 'text', [], {}]) {
      const read = valueOf(await createMemorySeedSource(seed).read());

      expect(read).toEqual(seed);
      expect(seedBundleParser(read)).toMatchObject({ ok: false, err: { code: 'BAD_SEED' } });
    }
  });

  it('answers SEED_UNREADABLE for a document that cannot be copied, and does not throw', async () => {
    const source = createMemorySeedSource({ foodCategories: () => 'a function cannot be copied' });

    const result = await source.read();

    expect(result).toMatchObject({ ok: false, err: { code: 'SEED_UNREADABLE' } });
  });
});
