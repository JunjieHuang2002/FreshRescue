import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SeedBundle } from '@freshrescue/contract-seed';
import { seedBundleParser } from '../modules/parsing/seedBundleParser';
import { APPENDIX_A_SEED } from '../testing/fixtures';
import { SEED_LOCATION, createSeedSourceGateway } from './seedSourceGateway';

// The seed file and the gateway that reads it (plan, phase 7): packages/backend/seed/freshrescue.seed.json
// holds spec Appendix A with quantities in thousandths, and a file that cannot be read is SEED_UNREADABLE.

let folder: string;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'freshrescue-seed-'));
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

/** What the gateway reads from the seed file that ships with the backend. */
async function shippedSeed(): Promise<SeedBundle> {
  const result = await createSeedSourceGateway().read();
  return result.ok ? (result.value as SeedBundle) : expect.unreachable(`the seed file cannot be read: ${result.err.detail}`);
}

describe('createSeedSourceGateway', () => {
  it('reads packages/backend/seed/freshrescue.seed.json by default', () => {
    expect(SEED_LOCATION.replaceAll('\\', '/')).toMatch(/\/packages\/backend\/seed\/freshrescue\.seed\.json$/);
  });

  it('hands on the seed file, which is spec Appendix A: the preset categories and cuisines, 8 Food Types, 6 recipes and no batch', async () => {
    const seed = await shippedSeed();

    expect(seed).toEqual(APPENDIX_A_SEED);
    expect(seed.foodCategories.map((category) => category.name)).toEqual(['Meat', 'Red Meat', 'Poultry', 'Dairy', 'Liquid Dairy', 'Vegetables', 'Leafy Greens']);
    expect(seed.cuisines.map((cuisine) => cuisine.name)).toEqual(['Chinese Cuisine', 'Vietnamese Cuisine', 'French Cuisine']);
    expect(seed.foodTypes.map((foodType) => foodType.name)).toEqual(['Beef', 'Broccoli', 'Chicken', 'Egg', 'Milk', 'Rice', 'Spinach', 'Tomato']);
    expect(seed.recipes).toHaveLength(6);
    expect(Object.keys(seed).sort()).toEqual(['cuisines', 'foodCategories', 'foodTypes', 'recipes']);
  });

  it('holds quantities in thousandths, and every row in the unit of its Food Type, so that no recipe starts blocked', async () => {
    const seed = await shippedSeed();
    const unitOf = new Map(seed.foodTypes.map((foodType) => [foodType.key, foodType.unit]));

    expect(seed.recipes.find((recipe) => recipe.name === 'Beef and Broccoli Stir-Fry')?.ingredients).toEqual([
      { foodTypeKey: 'beef', quantity: 300_000, unit: 'grams' },
      { foodTypeKey: 'broccoli', quantity: 200_000, unit: 'grams' },
    ]);
    for (const recipe of seed.recipes) {
      for (const row of recipe.ingredients) expect(row.unit, `${recipe.name}: ${row.foodTypeKey}`).toBe(unitOf.get(row.foodTypeKey));
    }
  });

  it('passes SeedBundleParser, which asks for one id for each of its 24 categories, cuisines, Food Types and recipes', async () => {
    expect(seedBundleParser(await shippedSeed())).toMatchObject({ ok: true, value: { idDemand: 24 } });
  });

  it('reads the file again at every call, so a caller that changes what it got changes nothing', async () => {
    const gateway = createSeedSourceGateway();
    const first = await gateway.read();
    if (first.ok) (first.value as { recipes: unknown[] }).recipes.length = 0;

    expect(await gateway.read()).toEqual({ ok: true, value: APPENDIX_A_SEED });
  });

  it('answers SEED_UNREADABLE when the file is not there, or is a folder', async () => {
    for (const location of [join(folder, 'missing.seed.json'), folder]) {
      const result = await createSeedSourceGateway(location).read();

      expect(result).toMatchObject({ ok: false, err: { code: 'SEED_UNREADABLE' } });
      expect(result.ok ? '' : result.err.detail).toContain(location);
    }
  });

  it('answers SEED_UNREADABLE when the file holds no JSON, and hands on JSON that is no seed, for the parser to refuse', async () => {
    const notJson = join(folder, 'broken.seed.json');
    const notSeed = join(folder, 'other.seed.json');
    await writeFile(notJson, '{ "foodCategories": [ ');
    await writeFile(notSeed, '{ "recipes": "none" }');

    expect(await createSeedSourceGateway(notJson).read()).toMatchObject({ ok: false, err: { code: 'SEED_UNREADABLE' } });
    const other = await createSeedSourceGateway(notSeed).read();
    expect(other).toEqual({ ok: true, value: { recipes: 'none' } });
    expect(seedBundleParser(other.ok ? other.value : null)).toMatchObject({ ok: false, err: { code: 'BAD_SEED' } });
  });
});
