import { StatusCodes } from 'http-status-codes';
import type { ErrorCode, ErrorFamily } from './codes';

/**
 * Default HTTP status of each family. `form` errors are raised in the browser and never travel over
 * HTTP, so its entry is only a nominal value.
 */
export const HTTP_STATUS_BY_FAMILY = {
  shape: StatusCodes.BAD_REQUEST,
  validation: StatusCodes.UNPROCESSABLE_ENTITY,
  rules: StatusCodes.CONFLICT,
  io: StatusCodes.SERVICE_UNAVAILABLE,
  form: StatusCodes.BAD_REQUEST,
} as const satisfies Record<ErrorFamily, number>;

/**
 * The HTTP status of every code: the default of its family, except for 13 codes. Twelve are faults
 * of the server (a corrupt store or seed, a decider that built an illegal change, a failed write)
 * and answer 500, and `PAYLOAD_TOO_LARGE` answers 413. A missing record answers 409 and not 404,
 * because both routes are fixed RPC endpoints: 404 stays for an unknown URL. The library names
 * 413 `REQUEST_TOO_LONG`.
 *
 * `satisfies Record<ErrorCode, number>` makes a code that has no status a compile error.
 */
export const HTTP_STATUS_BY_CODE = {
  // shape: 400, except a bad store or seed, which is the server's fault
  BAD_ENVELOPE: HTTP_STATUS_BY_FAMILY.shape,
  UNKNOWN_COMMAND: HTTP_STATUS_BY_FAMILY.shape,
  UNKNOWN_QUERY: HTTP_STATUS_BY_FAMILY.shape,
  MISSING_FIELD: HTTP_STATUS_BY_FAMILY.shape,
  WRONG_TYPE: HTTP_STATUS_BY_FAMILY.shape,
  BAD_COMBINATION: HTTP_STATUS_BY_FAMILY.shape,
  DATE_INVALID: HTTP_STATUS_BY_FAMILY.shape,
  CORRUPT_STORE: StatusCodes.INTERNAL_SERVER_ERROR,
  SCHEMA_MISMATCH: StatusCodes.INTERNAL_SERVER_ERROR,
  BAD_SEED: StatusCodes.INTERNAL_SERVER_ERROR,
  DUP_SEED_KEY: StatusCodes.INTERNAL_SERVER_ERROR,
  SEED_BAD_CATEGORY: StatusCodes.INTERNAL_SERVER_ERROR,
  SEED_BAD_FOODTYPE: StatusCodes.INTERNAL_SERVER_ERROR,

  // validation: 422
  NAME_EMPTY: HTTP_STATUS_BY_FAMILY.validation,
  NAME_TOO_LONG: HTTP_STATUS_BY_FAMILY.validation,
  NAME_DUPLICATE: HTTP_STATUS_BY_FAMILY.validation,
  NAME_RESERVED: HTTP_STATUS_BY_FAMILY.validation,
  QTY_NOT_POSITIVE: HTTP_STATUS_BY_FAMILY.validation,
  QTY_TOO_LARGE: HTTP_STATUS_BY_FAMILY.validation,
  QTY_NOT_INTEGER: HTTP_STATUS_BY_FAMILY.validation,
  UNIT_UNKNOWN: HTTP_STATUS_BY_FAMILY.validation,
  THRESHOLD_INVALID: HTTP_STATUS_BY_FAMILY.validation,
  DAYS_INVALID: HTTP_STATUS_BY_FAMILY.validation,
  PAST_EXPIRY: HTTP_STATUS_BY_FAMILY.validation,
  CAP_EXCEEDED: HTTP_STATUS_BY_FAMILY.validation,

  // rules: 409, except the guards that only an inconsistent snapshot or a faulty decider can fire
  CATEGORY_NOT_FOUND: HTTP_STATUS_BY_FAMILY.rules,
  PARENT_INVALID: HTTP_STATUS_BY_FAMILY.rules,
  SYSTEM_PROTECTED: HTTP_STATUS_BY_FAMILY.rules,
  THRESHOLD_FORBIDDEN: HTTP_STATUS_BY_FAMILY.rules,
  FOOD_TYPE_NOT_FOUND: HTTP_STATUS_BY_FAMILY.rules,
  HAS_BATCHES: HTTP_STATUS_BY_FAMILY.rules,
  BATCH_NOT_FOUND: HTTP_STATUS_BY_FAMILY.rules,
  RECIPE_NOT_FOUND: HTTP_STATUS_BY_FAMILY.rules,
  UNIT_UNCHANGED: HTTP_STATUS_BY_FAMILY.rules,
  BATCH_SET_MISMATCH: HTTP_STATUS_BY_FAMILY.rules,
  NO_INGREDIENTS: HTTP_STATUS_BY_FAMILY.rules,
  DUP_INGREDIENT: HTTP_STATUS_BY_FAMILY.rules,
  UNKNOWN_FOOD_TYPE: HTTP_STATUS_BY_FAMILY.rules,
  CONFLICTING_OPS: StatusCodes.INTERNAL_SERVER_ERROR,
  UNKNOWN_TARGET: StatusCodes.INTERNAL_SERVER_ERROR,
  INVARIANT_BROKEN: StatusCodes.INTERNAL_SERVER_ERROR,
  INSUFFICIENT_STOCK: StatusCodes.INTERNAL_SERVER_ERROR,

  // io: 503, except a failed write or an unreadable seed (500) and an oversized body (413)
  STORE_UNAVAILABLE: HTTP_STATUS_BY_FAMILY.io,
  STORE_WRITE_FAILED: StatusCodes.INTERNAL_SERVER_ERROR,
  SEED_UNREADABLE: StatusCodes.INTERNAL_SERVER_ERROR,
  NETWORK_ERROR: HTTP_STATUS_BY_FAMILY.io,
  TIMEOUT: HTTP_STATUS_BY_FAMILY.io,
  BAD_JSON: HTTP_STATUS_BY_FAMILY.io,
  HTTP_STATUS: HTTP_STATUS_BY_FAMILY.io,
  PAYLOAD_TOO_LARGE: StatusCodes.REQUEST_TOO_LONG,
  BAD_RESPONSE: HTTP_STATUS_BY_FAMILY.io,
  SLOT_NOT_FOUND: HTTP_STATUS_BY_FAMILY.io,

  // form: raised in the browser, so the status is nominal
  FIELD_REQUIRED: HTTP_STATUS_BY_FAMILY.form,
  QTY_FORMAT: HTTP_STATUS_BY_FAMILY.form,
  QTY_DECIMALS: HTTP_STATUS_BY_FAMILY.form,
  INT_FORMAT: HTTP_STATUS_BY_FAMILY.form,
  DATE_FORMAT: HTTP_STATUS_BY_FAMILY.form,
  CHOICE_UNKNOWN: HTTP_STATUS_BY_FAMILY.form,
} as const satisfies Record<ErrorCode, number>;
