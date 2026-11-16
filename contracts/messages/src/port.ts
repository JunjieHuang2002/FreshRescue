import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import type { ApiResponse } from './envelope';
import type { RouteName } from './routes';

/**
 * A request as the HTTP gateway hands it over: the route, and the body text, or the reason the
 * body could not be read (PAYLOAD_TOO_LARGE). The failure travels on so that the reply is built
 * the same way as every other.
 */
export type RawRequest = {
  readonly route: RouteName;
  readonly body: Result<string, DomainError>;
};

/** A reply before it is serialized: the HTTP status and the envelope. */
export type ApiReply = {
  readonly status: number;
  readonly response: ApiResponse;
};

/**
 * The one thing the HTTP gateway knows about the backend. BackendCoordinator implements it, so the
 * same bundle can run behind HTTP or in process.
 */
export type CoordinatorPort = {
  handle(request: RawRequest): Promise<ApiReply>;
};
