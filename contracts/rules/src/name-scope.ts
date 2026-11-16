/**
 * The four scopes in which a name must be unique, case-insensitively and after trimming (spec
 * section 3). The scopes are independent: a Food Type may share a name with a category.
 */
export const NAME_SCOPES = ['foodType', 'recipe', 'foodCategory', 'cuisine'] as const;

export type NameScope = (typeof NAME_SCOPES)[number];

/** The two category trees, which is also the `scope` of a category command. */
export const CATEGORY_SCOPES = ['foodCategory', 'cuisine'] as const satisfies readonly NameScope[];

export type CategoryScope = (typeof CATEGORY_SCOPES)[number];
