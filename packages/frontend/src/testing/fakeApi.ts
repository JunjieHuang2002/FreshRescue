import { ERROR_FAMILY_OF, HTTP_STATUS_BY_CODE } from '@freshrescue/contract-errors';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Envelope, MessageData, MessageType, RawHttpResult } from '@freshrescue/contract-messages';
import type { DateISO, Result } from '@freshrescue/contract-primitives';
import type { ApiPort } from '../gateways/apiGateway';

// A scripted stand-in for the apiGateway (plan, phase 9): it answers each message name with a prepared
// reply and records every request it receives. The replies are raw HTTP results, as the real gateway
// returns them, so every reply still goes through ApiResponseParser in the coordinators. This is a
// builder for tests: it is not a module, and production code never imports it.

/** What the stand-in answers to one request: the status and body text of an answer, or the error of a request that got none. */
export type Reply = Result<RawHttpResult, DomainError>;

/** One of the 19 messages, by its name. */
export type MessageOf<T extends MessageType> = Extract<Envelope, { readonly type: T }>;

/**
 * How a message is answered: always with the same reply, or with a reply worked out from the request and the
 * number of earlier requests of that message. A reply may be a promise, which holds the answer back until it
 * settles (see `heldReply`).
 */
export type Answer<T extends MessageType> = Reply | Promise<Reply> | ((message: MessageOf<T>, earlier: number) => Reply | Promise<Reply>);

export type Script = { readonly [T in MessageType]?: Answer<T> };

export type FakeApi = ApiPort & {
  /** Every request, in the order it came. */
  readonly requests: readonly Envelope[];
  /** The names of the requests, in the order they came. */
  types(): MessageType[];
  /** The requests of one message, in the order they came. */
  sent<T extends MessageType>(type: T): MessageOf<T>[];
  /** Answers a message with another reply from now on. */
  answer<T extends MessageType>(type: T, answer: Answer<T>): void;
  /** Forgets the requests so far, so that a test can look at what one action sent. */
  forget(): void;
};

/** The reply of the backend to a message that worked: status 200 and `{ ok: true, data, meta: { today } }`. */
export function okReply<T extends MessageType>(_type: T, data: MessageData[T], today: DateISO = '2026-10-02'): Reply {
  return { ok: true, value: { status: 200, bodyText: JSON.stringify({ ok: true, data, meta: { today } }) } };
}

/** The reply of the backend to a message that failed, with the HTTP status of its code (the table of the `errors` contract). */
export function errorReply(code: ErrorCode, detail?: string): Reply {
  const error = { family: ERROR_FAMILY_OF[code], code, ...(detail === undefined ? {} : { detail }) };
  return { ok: true, value: { status: HTTP_STATUS_BY_CODE[code], bodyText: JSON.stringify({ ok: false, error, meta: { today: null } }) } };
}

/** A request that got no answer: what the real gateway reports when the network fails or the server is too slow. */
export function lostReply(code: 'NETWORK_ERROR' | 'TIMEOUT'): Reply {
  return { ok: false, err: { code, detail: 'the stand-in API did not answer' } };
}

/** A reply that is held back until `release` is called, so that a test can look at the page while a request is on its way. */
export function heldReply(reply: Reply): { readonly reply: Promise<Reply>; readonly release: () => void } {
  let release = (): void => {};
  const held = new Promise<Reply>((resolve) => {
    release = () => resolve(reply);
  });
  return { reply: held, release };
}

/**
 * A stand-in API that answers by `script`. A message that the script does not name is answered as a
 * request that got no answer, NETWORK_ERROR with a detail that names it, so a test that forgot one sees
 * a notice on the page. It answers at once and sets no timer, so the requests of one user action are
 * all answered by the time the page has settled.
 */
export function createFakeApi(script: Script = {}): FakeApi {
  const answers = new Map<MessageType, Answer<MessageType>>(Object.entries(script) as [MessageType, Answer<MessageType>][]);
  const requests: Envelope[] = [];
  // how many requests of each message came before, which `forget` does not reset
  const counts = new Map<MessageType, number>();
  return {
    requests,
    types: () => requests.map((request) => request.type),
    sent: <T extends MessageType>(type: T): MessageOf<T>[] => requests.filter((request): request is MessageOf<T> => request.type === type),
    answer: (type, answer) => {
      answers.set(type, answer as Answer<MessageType>);
    },
    forget: () => {
      requests.length = 0;
    },
    async send(envelope) {
      const earlier = counts.get(envelope.type) ?? 0;
      counts.set(envelope.type, earlier + 1);
      requests.push(envelope);
      const answer = answers.get(envelope.type);
      if (answer === undefined) return { ok: false, err: { code: 'NETWORK_ERROR', detail: `the stand-in API has no reply for ${envelope.type}` } };
      return typeof answer === 'function' ? answer(envelope as MessageOf<MessageType>, earlier) : answer;
    },
  };
}
