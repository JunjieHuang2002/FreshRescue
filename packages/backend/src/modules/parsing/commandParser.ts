import Joi from 'joi';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import { COMMAND_TYPES } from '@freshrescue/contract-messages';
import type { Command, CommandPayloads, CommandType } from '@freshrescue/contract-messages';
import type { Result } from '@freshrescue/contract-primitives';
import { CATEGORY_SCOPES } from '@freshrescue/contract-rules';

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

// ---- dates -----------------------------------------------------------------------------------

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** True for a real calendar date written `YYYY-MM-DD`: month 1 to 12, and a day that the month has, leap years included. */
function isCalendarDate(text: string): boolean {
  const match = DATE_TEXT.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const length = month === 2 && isLeap ? 29 : (MONTH_LENGTHS[month - 1] ?? 0);
  return day >= 1 && day <= length;
}

// ---- the field types of the wire -------------------------------------------------------------
//
// Every field is always present on the wire, and `null` is the one way to say "none" (contract
// `messages`). The parser reads the shape and the JSON type of each field and nothing more: a
// quantity, a number of days, a threshold, a name and a unit pass whatever their value is, so that the
// validators of the coordinator can answer with the precise code (QTY_*, DAYS_INVALID, THRESHOLD_INVALID,
// NAME_*, UNIT_UNKNOWN). Only an id has a rule here, because an id that is not a positive integer names nothing.

const ID = Joi.number().integer().min(1).required();
const NULLABLE_ID = Joi.number().integer().min(1).allow(null).required();
/** Any JSON number. `unsafe` lets one beyond the safe integers through, so that QTY_TOO_LARGE can answer it. */
const NUMBER = Joi.number().unsafe().required();
const NULLABLE_NUMBER = Joi.number().unsafe().allow(null).required();
const TEXT = Joi.string().allow('').required();
const NULLABLE_TEXT = Joi.string().allow('').allow(null).required();
const SCOPE = Joi.string()
  .valid(...CATEGORY_SCOPES)
  .required();

/** A calendar date. A text that is not one is DATE_INVALID, and a value that is not text is WRONG_TYPE. */
const DATE_RULE = Joi.any()
  .custom((value, helpers) => {
    if (typeof value !== 'string') return helpers.error('string.base');
    return isCalendarDate(value) ? value : helpers.error('shape.date');
  })
  .messages({
    'string.base': '{{#label}} must be a string',
    'shape.date': '{{#label}} must be a calendar date written YYYY-MM-DD',
  });
const NULLABLE_DATE = DATE_RULE.allow(null).required();

/** How long a batch lasts: `{ days }` or `{ date }`, exactly one of them (spec section 3). */
const EXPIRY = Joi.object({ days: Joi.number().unsafe(), date: DATE_RULE }).xor('days', 'date').required();

/**
 * Name the Food Type by `foodTypeId` or by `foodName`, never both. Neither is let through on purpose:
 * the inbound form makes both fields optional, and a blank optional field is sent as null, so a form
 * whose name was left blank with no Food Type picked arrives as two nulls. That is an empty name, and
 * the coordinator reads it as one (FoodTypeResolver gives `new('')`) so that NameValidator answers
 * NAME_EMPTY, the validation message that spec section 3 and exception row 3 ask for. Refusing it here
 * would answer a shape error that points at no field.
 * Joi's own `xor` counts a `null` as present, so this reads the two fields itself.
 */
const nameTheFoodTypeAtMostOnce: Joi.CustomValidator<CommandPayloads['InboundBatch']> = (value, helpers) =>
  value.foodTypeId !== null && value.foodName !== null ? helpers.error('shape.combination') : value;

// ---- the payload of each command -------------------------------------------------------------

/** One schema for each of the 13 commands. `satisfies` makes a command without a schema a compile error. */
const PAYLOADS = {
  SaveCategory: Joi.object({ scope: SCOPE, categoryId: NULLABLE_ID, parentId: NULLABLE_ID, name: TEXT }),
  DeleteCategory: Joi.object({ scope: SCOPE, categoryId: ID }),
  SetCategoryThreshold: Joi.object({ categoryId: ID, thresholdDays: NULLABLE_NUMBER }),
  SaveFoodType: Joi.object({
    foodTypeId: NULLABLE_ID,
    name: TEXT,
    categoryId: NULLABLE_ID,
    unit: NULLABLE_TEXT,
    thresholdDays: NULLABLE_NUMBER,
  }),
  ChangeFoodTypeUnit: Joi.object({
    foodTypeId: ID,
    unit: TEXT,
    batches: Joi.array().items(Joi.object({ batchId: ID, quantity: NUMBER })).required(),
  }),
  DeleteFoodType: Joi.object({ foodTypeId: ID }),
  InboundBatch: Joi.object({
    foodTypeId: NULLABLE_ID,
    foodName: NULLABLE_TEXT,
    categoryId: NULLABLE_ID,
    unit: NULLABLE_TEXT,
    quantity: NUMBER,
    expiry: EXPIRY,
  })
    .custom(nameTheFoodTypeAtMostOnce)
    .messages({ 'shape.combination': '{{#label}} must name the Food Type by foodTypeId or by foodName, and not by both' }),
  EditBatchQuantity: Joi.object({ batchId: ID, quantity: NUMBER }),
  RemoveBatch: Joi.object({ batchId: ID }),
  SaveRecipe: Joi.object({
    recipeId: NULLABLE_ID,
    name: TEXT,
    draft: Joi.object({
      cuisineId: NULLABLE_ID,
      rows: Joi.array().items(Joi.object({ foodTypeId: ID, quantity: NUMBER, unit: TEXT })).required(),
    }).required(),
  }),
  DeleteRecipe: Joi.object({ recipeId: ID }),
  CookRecipes: Joi.object({ recipeIds: Joi.array().items(Joi.number().integer().min(1)).required() }),
  SetSimulatedToday: Joi.object({ date: NULLABLE_DATE }),
} satisfies Record<CommandType, Joi.ObjectSchema>;

/** The whole envelope of each command, `{ type, payload }`. */
const ENVELOPES = Object.fromEntries(
  COMMAND_TYPES.map((type) => [type, Joi.object({ type: Joi.string().required(), payload: PAYLOADS[type].required() }).required()]),
) as Record<CommandType, Joi.ObjectSchema>;

/** Only the `type` of an envelope, read first so that an unknown command is named before its payload is looked at. */
const HEAD = Joi.object({ type: Joi.string().required() }).required().label('body');

/** No conversion: the text "12" is not the number 12. Fields that are not in the contract are dropped. */
const OPTIONS: Joi.ValidationOptions = { abortEarly: true, convert: false, stripUnknown: true };

const COMBINATION_FAULTS = new Set(['object.xor', 'object.missing', 'shape.combination']);

/** Names the first fault that Joi found with the shape code that fits it. */
function shapeError(error: Joi.ValidationError): DomainError {
  const fault = error.details[0]?.type ?? '';
  let code: ErrorCode = 'WRONG_TYPE';
  if (fault === 'any.required') code = 'MISSING_FIELD';
  else if (COMBINATION_FAULTS.has(fault)) code = 'BAD_COMBINATION';
  else if (fault === 'shape.date') code = 'DATE_INVALID';
  return { code, detail: error.message };
}

const isCommandType = (type: string): type is CommandType => (COMMAND_TYPES as readonly string[]).includes(type);

/**
 * BP-01 CommandParser. Turns the text of a request body into a typed `Command`, or into the shape
 * error that says what is wrong with it. It reads the shape and nothing else: whether a quantity is
 * in range, a name is free or a date has passed is the business of the validators and deciders.
 *
 * - BAD_ENVELOPE: the body is not JSON, is not an object, or has no `type` that is text
 * - UNKNOWN_COMMAND: `type` is text but is not one of the 13 commands
 * - MISSING_FIELD: a field that must be there is not, the `payload` itself included
 * - WRONG_TYPE: a field has the wrong JSON type, an id is not a positive integer, or a scope is
 *   not one of the two trees
 * - BAD_COMBINATION: fields that cannot go together: an inbound that names its Food Type both by id and
 *   by name, or an expiry that gives both a shelf life and a date, or neither. An inbound that names its
 *   Food Type neither way is not a bad combination: it is a blank name, which passes on to be refused
 *   as NAME_EMPTY (see `nameTheFoodTypeAtMostOnce`)
 * - DATE_INVALID: a date that is text but is not a real calendar date written YYYY-MM-DD
 *
 * Joi does the checking, and each Joi failure is translated into one of these codes: nothing is
 * thrown. The one native call that throws, `JSON.parse`, is caught here and becomes BAD_ENVELOPE.
 * A field that the contract does not have is dropped, so the command that comes out has exactly the
 * fields of its payload type.
 */
export function commandParser(body: string): Result<Command, DomainError> {
  let document: unknown;
  try {
    document = JSON.parse(body);
  } catch {
    return fail('BAD_ENVELOPE', 'the body is not JSON text');
  }

  const head = HEAD.validate(document, OPTIONS);
  if (head.error !== undefined) return fail('BAD_ENVELOPE', head.error.message);
  const type = String(head.value.type);
  if (!isCommandType(type)) return fail('UNKNOWN_COMMAND', `"${type}" is not one of the commands`);

  const parsed = ENVELOPES[type].validate(document, OPTIONS);
  if (parsed.error !== undefined) return { ok: false, err: shapeError(parsed.error) };
  return { ok: true, value: parsed.value as Command };
}
