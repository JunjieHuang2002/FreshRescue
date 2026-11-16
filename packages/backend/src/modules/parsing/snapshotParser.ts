import Joi from 'joi';
import { EMPTY_SNAPSHOT } from '@freshrescue/contract-entities';
import type { RawStore, Snapshot } from '@freshrescue/contract-entities';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

// The shape of the store, field by field, as the entities of the contract `entities` have it. A
// field that may be null in an entity may be null here, and every field is always present. Only the
// shape is checked: a whole number, a piece of text, a boolean, a `YYYY-MM-DD` text. Whether a value
// is in range, a reference points at a record, or a name is unique is the business of
// SnapshotInvariantChecker, which looks at a snapshot after each change.
const INTEGER = Joi.number().integer().required();
const NULLABLE_INTEGER = Joi.number().integer().allow(null).required();
const TEXT = Joi.string().allow('').required();
const BOOLEAN = Joi.boolean().required();
const DATE_TEXT = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);

const rowsOf = (row: Joi.ObjectSchema): Joi.ArraySchema => Joi.array().items(row).required();

const STORE = Joi.object({
  foodCategories: rowsOf(
    Joi.object({ id: INTEGER, name: TEXT, parentId: NULLABLE_INTEGER, isSystem: BOOLEAN, customThresholdDays: NULLABLE_INTEGER }),
  ),
  foodTypes: rowsOf(Joi.object({ id: INTEGER, name: TEXT, categoryId: INTEGER, unit: TEXT, customThresholdDays: NULLABLE_INTEGER })),
  batches: rowsOf(
    Joi.object({
      id: INTEGER,
      foodTypeId: INTEGER,
      quantity: INTEGER,
      inboundDate: DATE_TEXT.required(),
      expirationDate: DATE_TEXT.required(),
      createdSeq: INTEGER,
    }),
  ),
  recipeCategories: rowsOf(Joi.object({ id: INTEGER, name: TEXT, isSystem: BOOLEAN })),
  recipes: rowsOf(Joi.object({ id: INTEGER, name: TEXT, recipeCategoryId: INTEGER })),
  recipeIngredients: rowsOf(
    Joi.object({
      recipeId: INTEGER,
      foodTypeId: INTEGER,
      requiredQuantity: INTEGER,
      requiredUnit: TEXT,
      deletedFoodTypeName: Joi.string().allow('').allow(null).required(),
    }),
  ),
  settings: Joi.object({ simulatedToday: DATE_TEXT.allow(null).required(), bootstrapped: BOOLEAN }).required(),
  counters: Joi.object({ nextId: INTEGER, nextSeq: INTEGER }).required(),
}).required();

/** No conversion: the text "12" is not the number 12. A field that the entities do not have is dropped. */
const OPTIONS: Joi.ValidationOptions = { abortEarly: true, convert: false, stripUnknown: true };

/**
 * BP-03 SnapshotParser. Turns the raw store document into a typed `Snapshot`. It checks the shape
 * and nothing else (blueprint 1.3), so a value that is the right type but is not allowed, such as a
 * quantity of 0 or a Food Type that points at no category, is left for SnapshotInvariantChecker.
 *
 * - `null` is an empty store, and it reads as `EMPTY_SNAPSHOT`: no record, not bootstrapped, and the
 *   counters at their start. It is not an error.
 * - CORRUPT_STORE: the document is not an object at all, so it cannot be a store.
 * - SCHEMA_MISMATCH: the document is an object, but a list or a row is not the shape of the
 *   entities: a list is missing or is not a list, a row lacks a field, or a field has the wrong type.
 *   The detail names the first one, with its path.
 *
 * Every list keeps the order it was stored in, which is creation order, because that order is the
 * tie-break of the A to Z sort. A field that the entities do not have is dropped.
 */
export function snapshotParser(raw: RawStore | null): Result<Snapshot, DomainError> {
  if (raw === null) return { ok: true, value: EMPTY_SNAPSHOT };
  if (typeof raw !== 'object' || Array.isArray(raw)) return fail('CORRUPT_STORE', 'the stored document is not an object');

  const parsed = STORE.validate(raw, OPTIONS);
  if (parsed.error !== undefined) return fail('SCHEMA_MISMATCH', parsed.error.message);
  return { ok: true, value: parsed.value as Snapshot };
}
