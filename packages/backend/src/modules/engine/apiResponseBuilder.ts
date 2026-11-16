import { ERROR_FAMILY_OF, HTTP_STATUS_BY_CODE } from '@freshrescue/contract-errors';
import type { DomainError } from '@freshrescue/contract-errors';
import type { ApiError, ApiReply } from '@freshrescue/contract-messages';
import type { DateISO, Result } from '@freshrescue/contract-primitives';

/** HTTP 200 OK: the status of every reply that succeeded. */
const OK_STATUS = 200;

/**
 * BC-44 ApiResponseBuilder. Wraps the result of a request into the one reply shape, `ApiResponse
 * { ok, data or error, meta: { today } }`, together with its HTTP status (blueprint 3.4). Every
 * request ends here, whether it succeeded or failed at any step (blueprint 2.3).
 *
 * - Ok: status 200, `data` is the payload, and `meta.today` is the date the request was derived for.
 *   A command with nothing to answer with has no payload and sends `{}`.
 * - Err: the status of the code in the errors contract, which is the default of its family except
 *   for the 13 codes listed there; `error` carries the code, its family and the detail when there is
 *   one; and `meta.today` is null, because the result of a failed request carries no date.
 */
export function apiResponseBuilder(result: Result<{ readonly payload: unknown; readonly today: DateISO }, DomainError>): ApiReply {
  if (result.ok) {
    const { payload, today } = result.value;
    return { status: OK_STATUS, response: { ok: true, data: payload === undefined ? {} : payload, meta: { today } } };
  }

  const { code, detail } = result.err;
  const family = ERROR_FAMILY_OF[code];
  const error: ApiError = detail === undefined ? { code, family } : { code, detail, family };
  return { status: HTTP_STATUS_BY_CODE[code], response: { ok: false, error, meta: { today: null } } };
}
