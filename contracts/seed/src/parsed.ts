import type { SeedBundle } from './bundle';

/**
 * A seed whose keys have been checked: every key is unique within its list, and every category,
 * cuisine and Food Type key that something names exists. `idDemand` is how many ids SeedPlanner
 * needs: one for each food category, cuisine, Food Type and recipe.
 */
export type ParsedSeed = SeedBundle & { readonly idDemand: number };
