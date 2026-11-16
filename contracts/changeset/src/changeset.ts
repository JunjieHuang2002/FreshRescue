import type {
  Batch,
  Counters,
  FoodCategory,
  FoodType,
  Recipe,
  RecipeCategory,
  RecipeIngredient,
  Settings,
} from '@freshrescue/contract-entities';
import type { Id } from '@freshrescue/contract-primitives';

/**
 * One record-level operation: a put (insert or replace) or a delete, 14 kinds in all. A decider
 * builds these and never edits the snapshot. A record may appear in a `ChangeSet` once, so
 * ChangeSetApplier can reject two operations on one record (CONFLICTING_OPS) and a delete of a
 * record that is not there (UNKNOWN_TARGET). The ingredient rows of a recipe are the one exception:
 * they are replaced by a single `deleteIngredientsOfRecipe` followed by the new `putIngredient`s.
 */
export type EntityOp =
  | { readonly kind: 'putFoodCategory'; readonly row: FoodCategory }
  | { readonly kind: 'deleteFoodCategory'; readonly id: Id }
  | { readonly kind: 'putFoodType'; readonly row: FoodType }
  | { readonly kind: 'deleteFoodType'; readonly id: Id }
  | { readonly kind: 'putBatch'; readonly row: Batch }
  | { readonly kind: 'deleteBatch'; readonly id: Id }
  | { readonly kind: 'putRecipeCategory'; readonly row: RecipeCategory }
  | { readonly kind: 'deleteRecipeCategory'; readonly id: Id }
  | { readonly kind: 'putRecipe'; readonly row: Recipe }
  | { readonly kind: 'deleteRecipe'; readonly id: Id }
  | { readonly kind: 'putIngredient'; readonly row: RecipeIngredient }
  | { readonly kind: 'deleteIngredientsOfRecipe'; readonly recipeId: Id }
  | { readonly kind: 'putSettings'; readonly row: Settings }
  | { readonly kind: 'putCounters'; readonly row: Counters };

/**
 * Every kind of `EntityOp`. `satisfies` rejects a name that is not a kind, and the assertion in
 * changeset.test.ts rejects a kind that is missing here.
 */
export const ENTITY_OP_KINDS = [
  'putFoodCategory',
  'deleteFoodCategory',
  'putFoodType',
  'deleteFoodType',
  'putBatch',
  'deleteBatch',
  'putRecipeCategory',
  'deleteRecipeCategory',
  'putRecipe',
  'deleteRecipe',
  'putIngredient',
  'deleteIngredientsOfRecipe',
  'putSettings',
  'putCounters',
] as const satisfies readonly EntityOp['kind'][];

/** One change to the stored state: ordered operations. Every change goes through one of these. */
export type ChangeSet = {
  readonly ops: readonly EntityOp[];
};

/**
 * What a backend workflow returns (blueprint 2.4). A command has change sets, and a payload when
 * it has something to answer with, such as a new id. A query has a payload and leaves `changeSets`
 * out, so it never reaches the persist step.
 */
export type Outcome<P = unknown> = {
  readonly changeSets?: readonly ChangeSet[];
  readonly payload?: P;
};
