import type { DomainError } from '@freshrescue/contract-errors';
import { ROUTE_METHOD, ROUTES } from '@freshrescue/contract-messages';
import type { Envelope, RawHttpResult } from '@freshrescue/contract-messages';
import type { Result } from '@freshrescue/contract-primitives';

/**
 * What AppCoordinator needs of the network (blueprint 1.7, FG-01): send one envelope and get the raw
 * HTTP result back, a status and a body text, which ApiResponseParser then reads. A request that gets
 * no answer at all is an error instead: NETWORK_ERROR or TIMEOUT. It never rejects.
 */
export type ApiPort = {
  send(envelope: Envelope): Promise<Result<RawHttpResult, DomainError>>;
};

export type ApiGatewayOptions = {
  /**
   * Where the API is. The browser leaves it empty and posts to its own page, which forwards `/api/*`
   * to the API (the Next rewrite), so no request leaves the origin. A test names its server.
   */
  readonly baseUrl?: string;
  /** How long a request may take before it is given up as TIMEOUT. */
  readonly timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

/** The message of whatever a native call threw, for the detail of the error. */
const reasonOf = (thrown: unknown): string => (thrown instanceof Error ? thrown.message : String(thrown));

/**
 * One request and the reading of its body, as a value. `fetch` rejects when there is no answer (no
 * server, no network, a dropped connection), and reading the body can fail the same way: both are
 * NETWORK_ERROR. An answer with any status is a result, because only the parser can tell what it means.
 */
async function exchange(url: string, envelope: Envelope): Promise<Result<RawHttpResult, DomainError>> {
  try {
    const response = await fetch(url, {
      method: ROUTE_METHOD,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    return { ok: true, value: { status: response.status, bodyText: await response.text() } };
  } catch (thrown) {
    return { ok: false, err: { code: 'NETWORK_ERROR', detail: `${envelope.type} to ${url}: ${reasonOf(thrown)}` } };
  }
}

/**
 * FG-01 ApiGateway. Posts each envelope as JSON to its route, a command to `/api/command` and a query
 * to `/api/query` (blueprint 3.4), and hands back the status and the body text. A request that has had
 * no answer after `timeoutMs` is TIMEOUT. The timeout is a timer that races the request, not an
 * AbortSignal, so the gateway behaves the same in the browser, in jsdom and in Node. The request that
 * lost the race is left to finish on its own, and its outcome is dropped.
 *
 * Nothing is touched when the gateway is created: `fetch` and the timer are looked up when a request
 * is sent, so the module can be imported where there is no browser (Next renders the page on the server).
 */
export function createApiGateway(options: ApiGatewayOptions = {}): ApiPort {
  const baseUrl = options.baseUrl ?? '';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async send(envelope) {
      // a command envelope carries a payload and a query envelope params (blueprint 3.4)
      const url = `${baseUrl}${'payload' in envelope ? ROUTES.command : ROUTES.query}`;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tooLate = new Promise<Result<RawHttpResult, DomainError>>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, err: { code: 'TIMEOUT', detail: `${envelope.type} to ${url}: no answer within ${timeoutMs} ms` } }),
          timeoutMs,
        );
      });
      const result = await Promise.race([exchange(url, envelope), tooLate]);
      clearTimeout(timer);
      return result;
    },
  };
}
