import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { MessageType } from '@freshrescue/contract-messages';
import type { FieldError, NoticeModel, Severity } from '@freshrescue/contract-ui';

/**
 * What the error is about, when the caller knows (blueprint 4.1 passes the message that was sent):
 * `message` lets a code point at the field of the form that it concerns, and `batchCount` is how
 * many batches a Food Type has, for the notice of HAS_BATCHES.
 */
export type NoticeContext = {
  readonly message?: MessageType | null;
  readonly batchCount?: number | null;
};

type Entry = { readonly severity: Severity; readonly text: string };

const warn = (text: string): Entry => ({ severity: 'warning', text });
const fault = (text: string): Entry => ({ severity: 'error', text });

// One notice for each of the 58 codes. `satisfies Record<ErrorCode, Entry>` makes a code without one a
// compile error. A 'warning' is something the person can put right (a value, a rule); an 'error' is a
// fault of the server, the store or the network, which only a retry or a developer can fix.
const NOTICES = {
  // shape
  BAD_ENVELOPE: fault('The server did not understand the request.'),
  UNKNOWN_COMMAND: fault('The server does not know this action.'),
  UNKNOWN_QUERY: fault('The server does not know this request.'),
  MISSING_FIELD: fault('The request is missing a value that the server needs.'),
  WRONG_TYPE: fault('A value in the request has the wrong type.'),
  BAD_COMBINATION: fault('The request names two things that cannot be used together.'),
  DATE_INVALID: warn('That date does not exist. Enter a real calendar date, like 2026-10-01.'),
  CORRUPT_STORE: fault('The stored data is damaged and cannot be read.'),
  SCHEMA_MISMATCH: fault('The stored data does not fit this version of the app.'),
  BAD_SEED: fault('The starting data is not valid.'),
  DUP_SEED_KEY: fault('The starting data uses the same key twice.'),
  SEED_BAD_CATEGORY: fault('The starting data names a category that does not exist.'),
  SEED_BAD_FOODTYPE: fault('The starting data names a Food Type that does not exist.'),

  // validation
  NAME_EMPTY: warn('The name is empty. Enter 1 to 200 characters.'),
  NAME_TOO_LONG: warn('The name is too long. Use at most 200 characters.'),
  NAME_DUPLICATE: warn('That name is already used. Choose another name.'),
  NAME_RESERVED: warn('The name Other is reserved. Choose another name.'),
  QTY_NOT_POSITIVE: warn('The quantity must be at least 0.001.'),
  QTY_TOO_LARGE: warn('The quantity must be at most 500,000.'),
  QTY_NOT_INTEGER: warn('The quantity can have at most 3 decimal places.'),
  UNIT_UNKNOWN: warn('Choose one of the units in the list.'),
  THRESHOLD_INVALID: warn('The threshold must be a whole number of days, at least 1.'),
  DAYS_INVALID: warn('The shelf life must be a whole number of days, 0 or more.'),
  PAST_EXPIRY: warn('That expiration date has already passed. Enter a shelf life of 0 or more days, or a date on or after today.'),
  CAP_EXCEEDED: warn('That would take this Food Type above 500,000 in total, so nothing was changed.'),

  // rules
  CATEGORY_NOT_FOUND: warn('That category no longer exists.'),
  PARENT_INVALID: warn('A category goes under a Parent category only, not under Other and not under another child.'),
  SYSTEM_PROTECTED: warn('Other is a system category. It cannot be renamed or deleted.'),
  THRESHOLD_FORBIDDEN: warn('Other cannot have a threshold of its own.'),
  FOOD_TYPE_NOT_FOUND: warn('That Food Type no longer exists.'),
  HAS_BATCHES: warn('Remove all batches first.'),
  BATCH_NOT_FOUND: warn('That batch no longer exists.'),
  RECIPE_NOT_FOUND: warn('That recipe no longer exists.'),
  UNIT_UNCHANGED: warn('That is already the unit of this Food Type. Choose a different unit.'),
  BATCH_SET_MISMATCH: warn('The batches changed while the form was open. Close it and try again.'),
  NO_INGREDIENTS: warn('A recipe needs at least one ingredient.'),
  DUP_INGREDIENT: warn('A Food Type can be used only once in a recipe.'),
  UNKNOWN_FOOD_TYPE: warn('An ingredient names a Food Type that does not exist.'),
  CONFLICTING_OPS: fault('The server built a change that contradicts itself, so nothing was changed.'),
  UNKNOWN_TARGET: fault('The server tried to change something that is not there, so nothing was changed.'),
  INVARIANT_BROKEN: fault('That change would leave the data inconsistent, so it was refused and nothing was changed.'),
  INSUFFICIENT_STOCK: fault('The server tried to take more than there is, so nothing was changed.'),

  // io
  STORE_UNAVAILABLE: fault('The data store is not available. Try again in a moment.'),
  STORE_WRITE_FAILED: fault('The change could not be saved, so nothing was changed.'),
  SEED_UNREADABLE: fault('The starting data could not be read.'),
  NETWORK_ERROR: fault('Cannot reach the server. Check that it is running, then try again.'),
  TIMEOUT: fault('The server took too long to answer. Try again.'),
  BAD_JSON: fault('The server sent a reply that is not JSON, so this page cannot read it.'),
  HTTP_STATUS: fault('The server answered with an unexpected HTTP status.'),
  PAYLOAD_TOO_LARGE: fault('The request is too large for the server.'),
  BAD_RESPONSE: fault('The server sent a reply that does not have the expected shape.'),
  SLOT_NOT_FOUND: fault('The page is missing the area where this should appear. Reload the page.'),

  // form
  FIELD_REQUIRED: warn('This field is required.'),
  QTY_FORMAT: warn('Use digits and one decimal point, like 1.5.'),
  QTY_DECIMALS: warn('Use at most 3 decimal places.'),
  INT_FORMAT: warn('Use a whole number, like 3.'),
  DATE_FORMAT: warn('Use a date like 2026-10-01.'),
  CHOICE_UNKNOWN: warn('Choose one of the options in the list.'),
} as const satisfies Record<ErrorCode, Entry>;

const FIELDS_SHOWN = 'Some fields need attention. Fix the ones that are marked and try again.';

// The field of the form that a backend code is about, by the message that the form sent. A code that
// is not here, or a message that is not under it, has no field: it is shown as a notice only.
const NAME = { InboundBatch: ['foodName'], SaveFoodType: ['name'], SaveCategory: ['name'], SaveRecipe: ['name'] } as const;
const FIELD_OF: { readonly [C in ErrorCode]?: { readonly [M in MessageType]?: readonly string[] } } = {
  NAME_EMPTY: NAME,
  NAME_TOO_LONG: NAME,
  NAME_DUPLICATE: { SaveFoodType: ['name'], SaveCategory: ['name'], SaveRecipe: ['name'] },
  NAME_RESERVED: { SaveCategory: ['name'] },
  QTY_NOT_POSITIVE: { InboundBatch: ['quantity'], EditBatchQuantity: ['quantity'] },
  QTY_TOO_LARGE: { InboundBatch: ['quantity'], EditBatchQuantity: ['quantity'] },
  QTY_NOT_INTEGER: { InboundBatch: ['quantity'], EditBatchQuantity: ['quantity'] },
  CAP_EXCEEDED: { InboundBatch: ['quantity'], EditBatchQuantity: ['quantity'] },
  UNIT_UNKNOWN: { InboundBatch: ['unit'], SaveFoodType: ['unit'], ChangeFoodTypeUnit: ['unit'] },
  UNIT_UNCHANGED: { ChangeFoodTypeUnit: ['unit'] },
  THRESHOLD_INVALID: { SaveFoodType: ['thresholdDays'], SetCategoryThreshold: ['thresholdDays'] },
  DAYS_INVALID: { InboundBatch: ['expiry.days'] },
  PAST_EXPIRY: { InboundBatch: ['expiry.days', 'expiry.date'] },
  DATE_INVALID: { InboundBatch: ['expiry.date'], SetSimulatedToday: ['date'] },
  FOOD_TYPE_NOT_FOUND: { InboundBatch: ['foodTypeId'] },
  NO_INGREDIENTS: { SaveRecipe: ['draft.rows'] },
};

const isFieldErrors = (error: DomainError | readonly FieldError[]): error is readonly FieldError[] => Array.isArray(error);

// A code that is not in the catalog cannot come from the typed values, and ApiResponseParser refuses
// it on the wire. The mapper still never fails, so it reads such a code as an unreadable reply.
const entryOf = (code: ErrorCode): Entry => (Object.hasOwn(NOTICES, code) ? NOTICES[code] : NOTICES.BAD_RESPONSE);

/** "Remove all N batches first." (spec exception 15): N is told by the caller, or found in the detail of the error. */
function batchesFirst(error: DomainError, context: NoticeContext | null): string {
  const told = context?.batchCount;
  const found = /\d+/.exec(error.detail ?? '')?.[0];
  const count = typeof told === 'number' && Number.isInteger(told) && told >= 1 ? told : found === undefined ? null : Number(found);
  if (count === null) return NOTICES.HAS_BATCHES.text;
  return count === 1 ? 'Remove the 1 batch first.' : `Remove all ${count} batches first.`;
}

function textOf(error: DomainError, entry: Entry, context: NoticeContext | null): string {
  if (error.code === 'HAS_BATCHES') return batchesFirst(error, context);
  // a fault carries its code and its detail, which are what a person reports and a developer needs
  if (entry.severity !== 'error') return entry.text;
  const detail = error.detail === undefined || error.detail === '' ? '' : `: ${error.detail}`;
  return `${entry.text} (${error.code}${detail})`;
}

/**
 * FC-01 ErrorNoticeMapper. Turns an error into the notice that a person reads (blueprint 1.7). It
 * takes one of two inputs and cannot fail:
 *
 * - A `DomainError`, from the backend or from the transport. Each of the 58 codes has a text and a
 *   severity. HAS_BATCHES says "Remove all N batches first." (spec exception 15). A backend code
 *   that belongs to one field of the form that sent the message (`context.message`) also puts the
 *   same text beside that field in `fieldHints`: the quantity for CAP_EXCEEDED, the name for
 *   NAME_DUPLICATE, both ends of the expiry for PAST_EXPIRY. The detail of a fault is part of its text.
 * - The `FieldError`s that FormSchemaParser found. Each one becomes the hint of its field, and the
 *   notice only says that fields need attention: the form parser sends no request, so the caller
 *   shows the hints and no notice.
 */
export function errorNoticeMapper(error: DomainError | readonly FieldError[], context: NoticeContext | null): NoticeModel {
  if (isFieldErrors(error)) {
    const fieldHints = Object.fromEntries(error.map((found) => [found.field, entryOf(found.code).text]));
    return { severity: 'warning', text: FIELDS_SHOWN, fieldHints };
  }

  const entry = entryOf(error.code);
  const message = context?.message;
  const fields = message === undefined || message === null ? undefined : FIELD_OF[error.code]?.[message];
  return {
    severity: entry.severity,
    text: textOf(error, entry, context),
    fieldHints: Object.fromEntries((fields ?? []).map((field) => [field, entry.text])),
  };
}
