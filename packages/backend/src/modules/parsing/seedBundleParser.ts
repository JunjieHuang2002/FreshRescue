import Joi from 'joi';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { SEED_ID_ORDER } from '@freshrescue/contract-seed';
import type { ParsedSeed, RawSeed, SeedBundle } from '@freshrescue/contract-seed';

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

// The seed document, as `SeedBundle` has it (spec 4.4.E and Appendix A). A thing is named by a key
// that is non-empty text, and `null` stands for the system category `Other`. Quantities are whole
// thousandths. Only the shape is checked here, because the seed names things by key and holds no ids:
// whether a name is allowed, a unit is in the list or a quantity is in range is judged after
// SeedPlanner has made records of it, by SnapshotInvariantChecker.
const KEY = Joi.string().required();
const TEXT = Joi.string().required();
const NULLABLE_KEY = Joi.string().allow(null).required();

const listOf = (row: Joi.ObjectSchema): Joi.ArraySchema => Joi.array().items(row).required();

const SEED = Joi.object({
  foodCategories: listOf(Joi.object({ key: KEY, name: TEXT, parentKey: NULLABLE_KEY })),
  cuisines: listOf(Joi.object({ key: KEY, name: TEXT })),
  foodTypes: listOf(Joi.object({ key: KEY, name: TEXT, categoryKey: NULLABLE_KEY, unit: TEXT })),
  recipes: listOf(
    Joi.object({
      key: KEY,
      name: TEXT,
      cuisineKey: NULLABLE_KEY,
      ingredients: listOf(Joi.object({ foodTypeKey: KEY, quantity: Joi.number().integer().required(), unit: TEXT })),
    }),
  ),
}).required();

/** No conversion: the text "300" is not the number 300. A field that the bundle does not have is dropped. */
const OPTIONS: Joi.ValidationOptions = { abortEarly: true, convert: false, stripUnknown: true };

const keysOf = (rows: readonly { readonly key: string }[]): Set<string> => new Set(rows.map((row) => row.key));

/** The first key that a list uses twice, in the words of an error, or null. A key is unique within its list. */
function duplicateKey(seed: SeedBundle): string | null {
  for (const list of SEED_ID_ORDER) {
    const seen = new Set<string>();
    for (const { key } of seed[list]) {
      if (seen.has(key)) return `${list}: the key "${key}" is used twice`;
      seen.add(key);
    }
  }
  return null;
}

/** The first key that something names and that no record has, as an error, or null. */
function danglingKey(seed: SeedBundle): DomainError | null {
  const categories = keysOf(seed.foodCategories);
  const cuisines = keysOf(seed.cuisines);
  const foodTypes = keysOf(seed.foodTypes);
  const bad = (code: ErrorCode, detail: string): DomainError => ({ code, detail });

  for (const category of seed.foodCategories) {
    if (category.parentKey !== null && !categories.has(category.parentKey)) {
      const named = `the parent "${category.parentKey}"`;
      return bad('SEED_BAD_CATEGORY', `food category "${category.key}" names ${named}, and there is no such food category`);
    }
  }
  for (const foodType of seed.foodTypes) {
    if (foodType.categoryKey !== null && !categories.has(foodType.categoryKey)) {
      const named = `the category "${foodType.categoryKey}"`;
      return bad('SEED_BAD_CATEGORY', `Food Type "${foodType.key}" names ${named}, and there is no such food category`);
    }
  }
  for (const recipe of seed.recipes) {
    if (recipe.cuisineKey !== null && !cuisines.has(recipe.cuisineKey)) {
      const named = `the cuisine "${recipe.cuisineKey}"`;
      return bad('SEED_BAD_CATEGORY', `recipe "${recipe.key}" names ${named}, and there is no such cuisine`);
    }
    for (const ingredient of recipe.ingredients) {
      if (!foodTypes.has(ingredient.foodTypeKey)) {
        const named = `the Food Type "${ingredient.foodTypeKey}"`;
        return bad('SEED_BAD_FOODTYPE', `recipe "${recipe.key}" uses ${named}, and there is no such Food Type`);
      }
    }
  }
  return null;
}

/**
 * BP-04 SeedBundleParser. Turns the raw seed document into a `ParsedSeed`: a `SeedBundle` whose keys
 * have been checked, with `idDemand`, the number of ids that SeedPlanner will need. The checks run in
 * this order, and the first fault is the error:
 *
 * - BAD_SEED: the document is not the shape of a `SeedBundle`: not an object, a list missing or not
 *   a list, a row that lacks a field, or a field of the wrong type. The detail names it, with its path.
 * - DUP_SEED_KEY: a key is used twice in one list. A key is unique within its list, and a key may be
 *   the same in two lists (a food category and a Food Type can both be `milk`), because a key is only
 *   ever looked up in the one list that it names.
 * - SEED_BAD_CATEGORY: a food category names a parent, a Food Type names a category, or a recipe
 *   names a cuisine, and there is no such record. A key of the wrong list is no such record.
 * - SEED_BAD_FOODTYPE: a recipe ingredient names a Food Type that the seed does not have.
 *
 * `idDemand` is one id for each food category, cuisine, Food Type and recipe, the lists of
 * `SEED_ID_ORDER`. An ingredient row takes no id. Each list keeps the order of the file.
 */
export function seedBundleParser(raw: RawSeed): Result<ParsedSeed, DomainError> {
  const parsed = SEED.validate(raw, OPTIONS);
  if (parsed.error !== undefined) return fail('BAD_SEED', parsed.error.message);
  const seed = parsed.value as SeedBundle;

  const duplicate = duplicateKey(seed);
  if (duplicate !== null) return fail('DUP_SEED_KEY', duplicate);
  const dangling = danglingKey(seed);
  if (dangling !== null) return { ok: false, err: dangling };

  const idDemand = SEED_ID_ORDER.reduce((total, list) => total + seed[list].length, 0);
  return { ok: true, value: { ...seed, idDemand } };
}
