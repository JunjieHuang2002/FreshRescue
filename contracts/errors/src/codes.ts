/** The five families of the error catalog (blueprint 1.2). */
export const ERROR_FAMILIES = ['shape', 'validation', 'rules', 'io', 'form'] as const;

export type ErrorFamily = (typeof ERROR_FAMILIES)[number];

/**
 * The 58-code catalog, written once as a table of code to family (blueprint 1.2). Everything that
 * needs the list of codes derives it from this table: `ErrorCode` is its key type, and the HTTP
 * status table must cover every key or the build fails.
 */
export const ERROR_FAMILY_OF = {
  // shape (13): the request, the store or the seed is not the right shape
  BAD_ENVELOPE: 'shape',
  UNKNOWN_COMMAND: 'shape',
  UNKNOWN_QUERY: 'shape',
  MISSING_FIELD: 'shape',
  WRONG_TYPE: 'shape',
  BAD_COMBINATION: 'shape',
  DATE_INVALID: 'shape',
  CORRUPT_STORE: 'shape',
  SCHEMA_MISMATCH: 'shape',
  BAD_SEED: 'shape',
  DUP_SEED_KEY: 'shape',
  SEED_BAD_CATEGORY: 'shape',
  SEED_BAD_FOODTYPE: 'shape',

  // validation (12): a value breaks a rule of the input dictionary (spec section 3)
  NAME_EMPTY: 'validation',
  NAME_TOO_LONG: 'validation',
  NAME_DUPLICATE: 'validation',
  NAME_RESERVED: 'validation',
  QTY_NOT_POSITIVE: 'validation',
  QTY_TOO_LARGE: 'validation',
  QTY_NOT_INTEGER: 'validation',
  UNIT_UNKNOWN: 'validation',
  THRESHOLD_INVALID: 'validation',
  DAYS_INVALID: 'validation',
  PAST_EXPIRY: 'validation',
  CAP_EXCEEDED: 'validation',

  // rules (17): a business rule or an invariant refuses the change
  CATEGORY_NOT_FOUND: 'rules',
  PARENT_INVALID: 'rules',
  SYSTEM_PROTECTED: 'rules',
  THRESHOLD_FORBIDDEN: 'rules',
  FOOD_TYPE_NOT_FOUND: 'rules',
  HAS_BATCHES: 'rules',
  BATCH_NOT_FOUND: 'rules',
  RECIPE_NOT_FOUND: 'rules',
  UNIT_UNCHANGED: 'rules',
  BATCH_SET_MISMATCH: 'rules',
  NO_INGREDIENTS: 'rules',
  DUP_INGREDIENT: 'rules',
  UNKNOWN_FOOD_TYPE: 'rules',
  CONFLICTING_OPS: 'rules',
  UNKNOWN_TARGET: 'rules',
  INVARIANT_BROKEN: 'rules',
  INSUFFICIENT_STOCK: 'rules',

  // io (10): the store, the seed file or the network failed
  STORE_UNAVAILABLE: 'io',
  STORE_WRITE_FAILED: 'io',
  SEED_UNREADABLE: 'io',
  NETWORK_ERROR: 'io',
  TIMEOUT: 'io',
  BAD_JSON: 'io',
  HTTP_STATUS: 'io',
  PAYLOAD_TOO_LARGE: 'io',
  BAD_RESPONSE: 'io',
  SLOT_NOT_FOUND: 'io',

  // form (6): raised in the browser while reading a form, and never sent over HTTP
  FIELD_REQUIRED: 'form',
  QTY_FORMAT: 'form',
  QTY_DECIMALS: 'form',
  INT_FORMAT: 'form',
  DATE_FORMAT: 'form',
  CHOICE_UNKNOWN: 'form',
} as const satisfies Record<string, ErrorFamily>;

export type ErrorCode = keyof typeof ERROR_FAMILY_OF;

/** The codes of one family, derived from the table: `ErrorCodeOf<'form'>` is the six form codes. */
export type ErrorCodeOf<F extends ErrorFamily> = {
  [C in ErrorCode]: (typeof ERROR_FAMILY_OF)[C] extends F ? C : never;
}[ErrorCode];
