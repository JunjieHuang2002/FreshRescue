import Joi from 'joi';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import { QUERY_TYPES } from '@freshrescue/contract-messages';
import type { Query, QueryType } from '@freshrescue/contract-messages';
import type { Result } from '@freshrescue/contract-primitives';

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

// Every field is always present on the wire, and `null` is the one way to say "none" (contract
// `messages`). An id that is not a positive integer names nothing, so it is the wrong type.
const NULLABLE_ID = Joi.number().integer().min(1).allow(null).required();

/** One schema for each of the 6 queries. `satisfies` makes a query without a schema a compile error. */
const PARAMS = {
  GetReferenceData: Joi.object({}),
  GetInventoryList: Joi.object({}),
  GetFoodTypeDetail: Joi.object({ foodTypeId: Joi.number().integer().min(1).required() }),
  GetWarningPanel: Joi.object({}),
  GetRecommendations: Joi.object({}),
  GetCatalog: Joi.object({ cuisineId: NULLABLE_ID }),
} satisfies Record<QueryType, Joi.ObjectSchema>;

/** The whole envelope of each query, `{ type, params }`. */
const ENVELOPES = Object.fromEntries(
  QUERY_TYPES.map((type) => [type, Joi.object({ type: Joi.string().required(), params: PARAMS[type].required() }).required()]),
) as Record<QueryType, Joi.ObjectSchema>;

/** Only the `type` of an envelope, read first so that an unknown query is named before its params are looked at. */
const HEAD = Joi.object({ type: Joi.string().required() }).required().label('body');

/** No conversion: the text "12" is not the number 12. Fields that are not in the contract are dropped. */
const OPTIONS: Joi.ValidationOptions = { abortEarly: true, convert: false, stripUnknown: true };

/** Names the first fault that Joi found: a field that is not there, or a field of the wrong type. */
function shapeError(error: Joi.ValidationError): DomainError {
  const code: ErrorCode = error.details[0]?.type === 'any.required' ? 'MISSING_FIELD' : 'WRONG_TYPE';
  return { code, detail: error.message };
}

const isQueryType = (type: string): type is QueryType => (QUERY_TYPES as readonly string[]).includes(type);

/**
 * BP-02 QueryParser. Turns the text of a request body into a typed `Query`, or into the shape error
 * that says what is wrong with it. A query only reads, and its params are few: an id, or a cuisine
 * that may be null.
 *
 * - BAD_ENVELOPE: the body is not JSON, is not an object, or has no `type` that is text
 * - UNKNOWN_QUERY: `type` is text but is not one of the 6 queries
 * - MISSING_FIELD: a field that must be there is not, the `params` themselves included
 * - WRONG_TYPE: a field has the wrong JSON type, or an id is not a positive integer
 *
 * Joi does the checking, and each Joi failure is translated into one of these codes: nothing is
 * thrown. The one native call that throws, `JSON.parse`, is caught here and becomes BAD_ENVELOPE. A
 * field that the contract does not have is dropped, so the params that come out are exactly those of
 * their type, and a query with no params comes out with `{}`.
 */
export function queryParser(body: string): Result<Query, DomainError> {
  let document: unknown;
  try {
    document = JSON.parse(body);
  } catch {
    return fail('BAD_ENVELOPE', 'the body is not JSON text');
  }

  const head = HEAD.validate(document, OPTIONS);
  if (head.error !== undefined) return fail('BAD_ENVELOPE', head.error.message);
  const type = String(head.value.type);
  if (!isQueryType(type)) return fail('UNKNOWN_QUERY', `"${type}" is not one of the queries`);

  const parsed = ENVELOPES[type].validate(document, OPTIONS);
  if (parsed.error !== undefined) return { ok: false, err: shapeError(parsed.error) };
  return { ok: true, value: parsed.value as Query };
}
