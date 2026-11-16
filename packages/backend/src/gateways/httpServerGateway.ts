import { createServer } from 'node:http';
import type { Server } from 'node:http';
import express from 'express';
import type { Express, Request, Response } from 'express';
import type { DomainError } from '@freshrescue/contract-errors';
import { ROUTES } from '@freshrescue/contract-messages';
import type { CoordinatorPort, RouteName } from '@freshrescue/contract-messages';
import type { Result } from '@freshrescue/contract-primitives';

/** The largest request body the API reads, 1 MiB: far more than the largest message the screens send. */
export const BODY_LIMIT_BYTES = 1024 * 1024;

export type HttpServerOptions = {
  /** The body size limit in bytes, BODY_LIMIT_BYTES unless a test sets a smaller one. */
  readonly bodyLimitBytes?: number;
};

/** The server as the composition root sees it: it starts listening, and it stops. */
export type HttpServer = {
  /** Listens on the port (0 picks a free one) and answers with the port it got, or NETWORK_ERROR. */
  listen(port: number): Promise<Result<number, DomainError>>;
  /** Stops taking connections, closes the idle ones, and resolves once every open request is answered. */
  close(): Promise<void>;
};

/** The Express text parser, which reads a body as text up to a size limit. */
type TextReader = ReturnType<typeof express.text>;

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null;

/**
 * Why a body could not be read. Over the limit is PAYLOAD_TOO_LARGE (413). Any other failure (a charset
 * or a content encoding that cannot be decoded, a body cut short) leaves no text that could hold an
 * envelope, so it is BAD_ENVELOPE (400), the code the parsers give a body that is not one.
 */
function unreadableBody(cause: unknown, limit: number): DomainError {
  if (isRecord(cause) && cause.type === 'entity.too.large') {
    return { code: 'PAYLOAD_TOO_LARGE', detail: `the body is larger than the ${limit} bytes the API reads` };
  }
  return { code: 'BAD_ENVELOPE', detail: `the body cannot be read as text: ${reasonOf(cause)}` };
}

/**
 * The body of a request as text, whatever its content type, or the reason it could not be read. The
 * Express text parser calls back with its error. Some versions of it can also throw before they start
 * reading (older ones on a Content-Type header they cannot parse), so the call is wrapped as well, and
 * the promise always resolves.
 */
function readBody(readText: TextReader, limit: number, req: Request, res: Response): Promise<Result<string, DomainError>> {
  return new Promise((resolve) => {
    const settle = (cause?: unknown): void => {
      if (cause === undefined || cause === null) resolve({ ok: true, value: typeof req.body === 'string' ? req.body : '' });
      else resolve({ ok: false, err: unreadableBody(cause, limit) });
    };
    try {
      readText(req, res, settle);
    } catch (cause) {
      settle(cause);
    }
  });
}

/**
 * A queue that runs its tasks one at a time, in the order they were handed in: each starts when the
 * one before has finished, whether it succeeded or not. The coordinator reads the whole snapshot at the
 * start of a request and writes at the end, so two requests must never overlap (plan, phase 6).
 */
function oneAtATime(): <T>(task: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = last.then(task);
    last = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/** The three routes: GET /healthz, and the two POST routes of the `messages` contract. Every other URL answers 404. */
function appOf(coordinator: CoordinatorPort, limit: number): Express {
  const app = express();
  app.disable('x-powered-by');
  const readText = express.text({ type: () => true, limit });
  const queue = oneAtATime();

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  for (const [route, path] of Object.entries(ROUTES) as [RouteName, string][]) {
    app.post(path, async (req, res) => {
      const body = await readBody(readText, limit, req, res);
      const reply = await queue(() => coordinator.handle({ route, body }));
      res.status(reply.status).json(reply.response);
    });
  }
  return app;
}

function listen(server: Server, port: number): Promise<Result<number, DomainError>> {
  return new Promise((resolve) => {
    const refuse = (cause: unknown): void => {
      server.off('listening', accept);
      resolve({ ok: false, err: { code: 'NETWORK_ERROR', detail: `the API cannot listen on port ${port}: ${reasonOf(cause)}` } });
    };
    const accept = (): void => {
      server.off('error', refuse);
      const address = server.address();
      resolve({ ok: true, value: isRecord(address) && typeof address.port === 'number' ? address.port : port });
    };
    server.once('error', refuse);
    server.once('listening', accept);
    try {
      server.listen(port);
    } catch (cause) {
      // a port that is not a port number is refused at once, by a throw
      server.off('error', refuse);
      refuse(cause);
    }
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
}

/**
 * BG-01 HttpServerGateway. Binds HTTP to the `CoordinatorPort` with Express (plan, phase 7): it hands
 * each request to the coordinator as `RawRequest { route, body }` and sends the reply it gets back,
 * `ApiReply.response` as JSON with `ApiReply.status`. It decides nothing about a message.
 *
 * - `POST /api/command` and `POST /api/query`. The body is read as text, whatever its content type,
 *   up to the size limit. A body over the limit is not an error here: it travels to the coordinator as
 *   a failed body, PAYLOAD_TOO_LARGE, so that its reply is built like every other one (413).
 * - Requests run one at a time, through a promise chain, because the coordinator assumes it. That holds
 *   for one API process, which is why the API runs as exactly one.
 * - `GET /healthz` answers `{ ok: true }` and does not touch the store. Any other URL, or another
 *   method on the two routes, answers 404.
 *
 * Nothing here throws: the native calls that can (reading a body, opening the port) are caught and
 * converted to a `DomainError`.
 */
export function createHttpServerGateway(coordinator: CoordinatorPort, options: HttpServerOptions = {}): HttpServer {
  const server = createServer(appOf(coordinator, options.bodyLimitBytes ?? BODY_LIMIT_BYTES));
  return { listen: (port) => listen(server, port), close: () => close(server) };
}
