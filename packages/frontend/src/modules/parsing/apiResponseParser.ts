import { ERROR_FAMILY_OF } from '@freshrescue/contract-errors';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { MessageData, MessageType, RawHttpResult } from '@freshrescue/contract-messages';
import type { Result } from '@freshrescue/contract-primitives';
import {
  BATCH_STATUSES,
  COOK_OUTCOMES,
  EMPTY_STATES,
  INGREDIENT_STATES,
  RECIPE_STATUSES,
  RECOMMENDATION_TIERS,
  SKIP_REASONS,
  THRESHOLD_SOURCES,
} from '@freshrescue/contract-rules';

// The shape of the `data` that a reply to each message promises, written as data. Every field of
// every read model is checked, because a view trusts what it is given and a JSON body is only text
// until it has been looked at.
type Shape =
  | { readonly t: 'int' | 'str' | 'bool' }
  | { readonly t: 'obj'; readonly fields: { readonly [name: string]: Shape } }
  | { readonly t: 'list'; readonly of: Shape }
  | { readonly t: 'null'; readonly of: Shape }
  | { readonly t: 'enum'; readonly values: readonly string[] };

const int: Shape = { t: 'int' };
const str: Shape = { t: 'str' };
const bool: Shape = { t: 'bool' };
const obj = (fields: { readonly [name: string]: Shape }): Shape => ({ t: 'obj', fields });
const list = (of: Shape): Shape => ({ t: 'list', of });
const nullable = (of: Shape): Shape => ({ t: 'null', of });
const oneOf = (values: readonly string[]): Shape => ({ t: 'enum', values });

const STATUS = oneOf(BATCH_STATUSES);
const BY_STATUS = obj({ fresh: int, nearExpiry: int, expired: int });
const BATCH = obj({
  id: int,
  foodTypeId: int,
  quantity: int,
  inboundDate: str,
  expirationDate: str,
  createdSeq: int,
  daysLeft: int,
  status: STATUS,
});
const WARNING = obj({
  batchId: int,
  foodTypeId: int,
  foodTypeName: str,
  unit: str,
  quantity: int,
  expirationDate: str,
  daysLeft: int,
  status: STATUS,
});
const LINE = obj({
  foodTypeId: int,
  name: str,
  requiredQuantity: int,
  requiredUnit: str,
  available: nullable(int),
  state: oneOf(INGREDIENT_STATES),
  rescued: bool,
  foodTypeUnit: nullable(str),
});
const CATEGORY_FIELDS = { id: int, name: str, isSystem: bool, customThresholdDays: nullable(int) };
const CATEGORY = obj({ ...CATEGORY_FIELDS, children: list(obj({ ...CATEGORY_FIELDS, children: list(obj({})) })) });
const NOTHING = obj({});

const SHAPES = {
  SaveCategory: obj({ categoryId: int }),
  DeleteCategory: NOTHING,
  SetCategoryThreshold: NOTHING,
  SaveFoodType: obj({ foodTypeId: int }),
  ChangeFoodTypeUnit: NOTHING,
  DeleteFoodType: NOTHING,
  InboundBatch: NOTHING,
  EditBatchQuantity: NOTHING,
  RemoveBatch: NOTHING,
  SaveRecipe: obj({ recipeId: int }),
  DeleteRecipe: NOTHING,
  CookRecipes: obj({
    reports: list(
      obj({
        recipeId: int,
        recipeName: str,
        outcome: oneOf(COOK_OUTCOMES),
        reason: nullable(oneOf(SKIP_REASONS)),
        deducted: list(obj({ foodTypeId: int, name: str, quantity: int, unit: str })),
        missing: list(obj({ foodTypeId: int, name: str, needed: int, available: int, unit: str })),
      }),
    ),
  }),
  SetSimulatedToday: NOTHING,
  GetReferenceData: obj({
    today: str,
    simulatedToday: nullable(str),
    globalThresholdDays: int,
    units: list(str),
    foodCategories: list(CATEGORY),
    cuisines: list(CATEGORY),
    foodTypes: list(obj({ id: int, name: str, unit: str, categoryId: int })),
  }),
  GetInventoryList: obj({
    rows: list(
      obj({
        foodTypeId: int,
        name: str,
        categoryPath: list(str),
        unit: str,
        total: int,
        byStatus: BY_STATUS,
        overall: nullable(STATUS),
      }),
    ),
  }),
  GetFoodTypeDetail: obj({
    foodTypeId: int,
    name: str,
    categoryId: int,
    categoryPath: list(str),
    unit: str,
    customThresholdDays: nullable(int),
    threshold: obj({ days: int, source: oneOf(THRESHOLD_SOURCES) }),
    total: int,
    byStatus: BY_STATUS,
    overall: nullable(STATUS),
    batches: list(BATCH),
    referencingRecipes: list(obj({ recipeId: int, name: str })),
  }),
  GetWarningPanel: obj({ nearExpiry: list(WARNING), expired: list(WARNING) }),
  GetRecommendations: obj({
    tier: nullable(oneOf(RECOMMENDATION_TIERS)),
    recipes: list(
      obj({
        recipeId: int,
        name: str,
        cuisineName: str,
        availableCount: int,
        totalCount: int,
        ingredients: list(LINE),
      }),
    ),
    emptyState: nullable(oneOf(EMPTY_STATES)),
  }),
  GetCatalog: obj({
    cuisineId: nullable(int),
    rows: list(
      obj({
        recipeId: int,
        name: str,
        cuisineId: int,
        cuisineName: str,
        status: oneOf(RECIPE_STATUSES),
        availableCount: int,
        totalCount: int,
        ingredients: list(LINE),
      }),
    ),
  }),
} as const satisfies Record<MessageType, Shape>;

const isRecord = (value: unknown): value is { readonly [name: string]: unknown } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function fits(value: unknown, shape: Shape): boolean {
  switch (shape.t) {
    case 'int':
      return Number.isSafeInteger(value);
    case 'str':
      return typeof value === 'string';
    case 'bool':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && shape.values.includes(value);
    case 'null':
      return value === null || fits(value, shape.of);
    case 'list':
      return Array.isArray(value) && value.every((item) => fits(item, shape.of));
    case 'obj':
      return isRecord(value) && Object.entries(shape.fields).every(([name, inner]) => fits(value[name], inner));
  }
}

const failure = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

const isErrorCode = (value: unknown): value is ErrorCode => typeof value === 'string' && Object.hasOwn(ERROR_FAMILY_OF, value);

/**
 * FP-02 ApiResponseParser. Turns what the browser got back, a status and a body text, into the data
 * that the message `kind` promises, or into a `DomainError` (blueprint 1.7). The three codes of this
 * module are about the transport, and each has its own trigger:
 *
 * - BAD_JSON: the status is 2xx but the body is not JSON.
 * - BAD_RESPONSE: the status is 2xx and the body is JSON, but it is not a reply of the shape
 *   `{ ok, data or error, meta }`, its `data` is not what `kind` promises, or its error has a code that
 *   is not in the catalog.
 * - HTTP_STATUS: the status says one thing and the body another. Either the status is not 2xx and
 *   the body is no failure reply (a proxy's 502 page, an unknown URL's 404 page), or a reply that
 *   says `ok` has an error status, or a reply that says it failed has a success status.
 *
 * A failure reply is not a transport problem: the backend's own `DomainError` is passed through as
 * it is, so the caller sees `CAP_EXCEEDED`, `HAS_BATCHES` and the rest. The frontend never works
 * anything out of the reply: `meta.today` is checked and left where it is, because the reference
 * data carries the date that the screens show.
 */
export function apiResponseParser<K extends MessageType>(raw: RawHttpResult, kind: K): Result<MessageData[K], DomainError> {
  const success = raw.status >= 200 && raw.status < 300;
  let body: unknown;
  try {
    body = JSON.parse(raw.bodyText);
  } catch {
    return success
      ? failure('BAD_JSON', `the reply to ${kind} is not JSON`)
      : failure('HTTP_STATUS', `the server answered ${raw.status} with a body that is not JSON`);
  }

  const meta = isRecord(body) ? body.meta : undefined;
  const today = isRecord(meta) ? meta.today : undefined;
  if (!isRecord(body) || typeof body.ok !== 'boolean' || (typeof today !== 'string' && today !== null)) {
    return success
      ? failure('BAD_RESPONSE', `the reply to ${kind} is not an API reply`)
      : failure('HTTP_STATUS', `the server answered ${raw.status} without an API reply`);
  }

  if (body.ok) {
    if (!success) return failure('HTTP_STATUS', `the server answered ${raw.status} but the reply says it worked`);
    if (typeof today !== 'string') return failure('BAD_RESPONSE', `the reply to ${kind} does not say which day it was worked out for`);
    if (!fits(body.data, SHAPES[kind])) return failure('BAD_RESPONSE', `the data of the reply to ${kind} is not what ${kind} promises`);
    return { ok: true, value: body.data as MessageData[K] };
  }

  if (success) return failure('HTTP_STATUS', `the server answered ${raw.status} but the reply says it failed`);
  const error = body.error;
  if (!isRecord(error) || !isErrorCode(error.code)) return failure('BAD_RESPONSE', `the error of the reply to ${kind} has no known code`);
  return { ok: false, err: typeof error.detail === 'string' ? { code: error.code, detail: error.detail } : { code: error.code } };
}
