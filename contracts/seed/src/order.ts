import type { SeedBundle } from './bundle';

/**
 * The order in which SeedPlanner consumes the reserved ids (blueprint 1.6): all food categories,
 * then all cuisines, then all Food Types, then all recipes, each list in file order. The
 * coordinator reserves exactly `idDemand` ids, so only one module owns the id scheme. Ingredient
 * rows take no id: a row is named by its recipe and its Food Type.
 */
export const SEED_ID_ORDER = ['foodCategories', 'cuisines', 'foodTypes', 'recipes'] as const satisfies readonly (keyof SeedBundle)[];

export type SeedIdList = (typeof SEED_ID_ORDER)[number];
