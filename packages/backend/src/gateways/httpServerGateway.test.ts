import { request } from 'node:http';
import { connect } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiReply, CoordinatorPort, RawRequest } from '@freshrescue/contract-messages';
import { BODY_LIMIT_BYTES, createHttpServerGateway } from './httpServerGateway';
import type { HttpServer, HttpServerOptions } from './httpServerGateway';

// HttpServerGateway at its edge (plan, phase 7): real HTTP on a free port, with a stand-in for the
// coordinator, so that what the gateway hands over and what it sends back can both be seen.

type Answer = { readonly status: number; readonly type: string | undefined; readonly text: string };

const OK_REPLY: ApiReply = { status: 200, response: { ok: true, data: {}, meta: { today: '2026-11-12' } } };
const TOO_LARGE_REPLY: ApiReply = {
  status: 413,
  response: { ok: false, error: { code: 'PAYLOAD_TOO_LARGE', family: 'io' }, meta: { today: null } },
};

/** A stand-in for the backend coordinator that records each request and answers what `answer` says. */
function recording(answer: (raw: RawRequest) => ApiReply | Promise<ApiReply> = () => OK_REPLY) {
  const received: RawRequest[] = [];
  const coordinator: CoordinatorPort = {
    handle: async (raw) => {
      received.push(raw);
      return answer(raw);
    },
  };
  return { coordinator, received };
}

const servers: HttpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function started(coordinator: CoordinatorPort, options?: HttpServerOptions): Promise<number> {
  const server = createHttpServerGateway(coordinator, options);
  servers.push(server);
  const listening = await server.listen(0);
  return listening.ok ? listening.value : expect.unreachable(`the server did not start: ${listening.err.detail}`);
}

/** One request through node:http, so that a test can send any header and any body, and see the status and the text. */
function send(port: number, method: string, path: string, body?: string | Buffer, headers: Record<string, string> = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const length = body === undefined || 'transfer-encoding' in headers ? {} : { 'content-length': String(Buffer.byteLength(body)) };
    const outgoing = request({ host: '127.0.0.1', port, method, path, headers: { ...length, ...headers } }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, type: incoming.headers['content-type'], text: Buffer.concat(chunks).toString('utf8') }));
    });
    outgoing.on('error', reject);
    if (body !== undefined) outgoing.write(body);
    outgoing.end();
  });
}

const post = (port: number, path: string, body: string | Buffer, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  send(port, 'POST', path, body, headers);

/** A request written by hand on a socket, for what node:http never sends: a POST with neither Content-Length nor Transfer-Encoding, which has no body. */
function sendRaw(port: number, head: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port }, () => socket.write(`${head}\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    let text = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (text += chunk));
    socket.on('end', () => resolve(text));
    socket.on('error', reject);
  });
}

describe('createHttpServerGateway', () => {
  it('hands POST /api/command to the coordinator as the command route with its body text, and sends back the reply as JSON with its status', async () => {
    const response = { ok: false, error: { code: 'CATEGORY_NOT_FOUND', family: 'rules', detail: 'no category 99' }, meta: { today: null } } as const;
    const { coordinator, received } = recording(() => ({ status: 409, response }));
    const port = await started(coordinator);

    const answer = await post(port, '/api/command', '{"type":"DeleteCategory","payload":{"scope":"food","categoryId":99}}');

    expect(received).toEqual([{ route: 'command', body: { ok: true, value: '{"type":"DeleteCategory","payload":{"scope":"food","categoryId":99}}' } }]);
    expect(answer.status).toBe(409);
    expect(answer.type).toMatch(/^application\/json/);
    expect(JSON.parse(answer.text)).toEqual(response);
  });

  it('hands POST /api/query to the coordinator as the query route', async () => {
    const { coordinator, received } = recording();
    const port = await started(coordinator);

    const answer = await post(port, '/api/query', '{"type":"GetReferenceData","params":{}}');

    expect(received).toEqual([{ route: 'query', body: { ok: true, value: '{"type":"GetReferenceData","params":{}}' } }]);
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.text)).toEqual(OK_REPLY.response);
  });

  it('reads the body as text whatever its content type, also with none, and in UTF-8; an empty body is empty text', async () => {
    const { coordinator, received } = recording();
    const port = await started(coordinator);

    await post(port, '/api/command', 'plain text', { 'content-type': 'text/plain' });
    await post(port, '/api/command', 'a=1&b=2', { 'content-type': 'application/x-www-form-urlencoded' });
    await post(port, '/api/command', '{"name":"Crème brûlée 🍮"}', {});
    await post(port, '/api/query', '', {});
    await send(port, 'POST', '/api/query');
    const bodiless = await sendRaw(port, 'POST /api/query HTTP/1.1');

    expect(received.map((raw) => raw.body)).toEqual([
      { ok: true, value: 'plain text' },
      { ok: true, value: 'a=1&b=2' },
      { ok: true, value: '{"name":"Crème brûlée 🍮"}' },
      { ok: true, value: '' },
      { ok: true, value: '' },
      { ok: true, value: '' },
    ]);
    expect(bodiless).toMatch(/^HTTP\/1\.1 200 /);
  });

  it('hands a body over the limit to the coordinator as PAYLOAD_TOO_LARGE and sends the 413 it answers; a body of exactly the limit is read', async () => {
    const { coordinator, received } = recording((raw) => (raw.body.ok ? OK_REPLY : TOO_LARGE_REPLY));
    const port = await started(coordinator, { bodyLimitBytes: 64 });

    const atLimit = await post(port, '/api/command', 'x'.repeat(64));
    const overLimit = await post(port, '/api/command', 'x'.repeat(65));
    const overInChunks = await post(port, '/api/query', 'y'.repeat(200), { 'transfer-encoding': 'chunked' });

    expect(atLimit.status).toBe(200);
    expect(received[0]?.body).toEqual({ ok: true, value: 'x'.repeat(64) });
    expect(overLimit.status).toBe(413);
    expect(JSON.parse(overLimit.text)).toEqual(TOO_LARGE_REPLY.response);
    expect(received[1]).toMatchObject({ route: 'command', body: { ok: false, err: { code: 'PAYLOAD_TOO_LARGE' } } });
    expect(overInChunks.status).toBe(413);
    expect(received[2]).toMatchObject({ route: 'query', body: { ok: false, err: { code: 'PAYLOAD_TOO_LARGE' } } });
  });

  it('reads at most 1 MiB by default', async () => {
    const { coordinator, received } = recording((raw) => (raw.body.ok ? OK_REPLY : TOO_LARGE_REPLY));
    const port = await started(coordinator);

    expect(BODY_LIMIT_BYTES).toBe(1_048_576);
    expect((await post(port, '/api/command', 'x'.repeat(BODY_LIMIT_BYTES))).status).toBe(200);
    expect((await post(port, '/api/command', 'x'.repeat(BODY_LIMIT_BYTES + 1))).status).toBe(413);
    expect(received.map((raw) => (raw.body.ok ? raw.body.value.length : raw.body.err.code))).toEqual([BODY_LIMIT_BYTES, 'PAYLOAD_TOO_LARGE']);
  });

  it('hands a body that cannot be read as text to the coordinator as BAD_ENVELOPE: an unknown charset, an unknown content encoding, a gzip body that is not gzip', async () => {
    const cases: [string, Record<string, string>, string][] = [
      ['an unknown charset', { 'content-type': 'application/json; charset=klingon' }, '{}'],
      ['an unknown content encoding', { 'content-type': 'application/json', 'content-encoding': 'snappy' }, '{}'],
      ['a gzip body that is not gzip', { 'content-type': 'application/json', 'content-encoding': 'gzip' }, 'not gzip at all'],
    ];
    for (const [label, headers, body] of cases) {
      const { coordinator, received } = recording();
      const port = await started(coordinator);

      await post(port, '/api/command', body, headers);

      expect(received, label).toHaveLength(1);
      expect(received[0], label).toMatchObject({ route: 'command', body: { ok: false, err: { code: 'BAD_ENVELOPE' } } });
    }
  });

  it('reads a gzip body, as a client may send one', async () => {
    const { coordinator, received } = recording();
    const port = await started(coordinator);

    await post(port, '/api/command', gzipSync('{"type":"CookRecipes"}'), { 'content-type': 'application/json', 'content-encoding': 'gzip' });

    expect(received[0]?.body).toEqual({ ok: true, value: '{"type":"CookRecipes"}' });
  });

  it('answers GET /healthz with { ok: true }, without the coordinator', async () => {
    const { coordinator, received } = recording();
    const port = await started(coordinator);

    const answer = await send(port, 'GET', '/healthz');

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.text)).toEqual({ ok: true });
    expect(received).toEqual([]);
  });

  it('answers 404 to any other URL, and to another method on the two routes, without the coordinator', async () => {
    const { coordinator, received } = recording();
    const port = await started(coordinator);

    const answers = await Promise.all([
      send(port, 'GET', '/'),
      post(port, '/api/nothing', '{}'),
      post(port, '/api', '{}'),
      send(port, 'GET', '/api/command'),
      send(port, 'PUT', '/api/query', '{}'),
      post(port, '/healthz', '{}'),
    ]);

    expect(answers.map((answer) => answer.status)).toEqual([404, 404, 404, 404, 404, 404]);
    expect(received).toEqual([]);
  });

  it('hands the coordinator one request at a time, even when they are sent at once, and each client gets its own reply', async () => {
    let running = 0;
    let most = 0;
    const { coordinator, received } = recording(async (raw) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 15));
      running -= 1;
      return { status: 200, response: { ok: true, data: { echo: raw.body.ok ? raw.body.value : null }, meta: { today: '2026-11-12' } } };
    });
    const port = await started(coordinator);

    const answers = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((text, index) => post(port, index % 2 === 0 ? '/api/command' : '/api/query', text)));

    expect(most).toBe(1);
    expect(received).toHaveLength(6);
    expect(answers.map((answer) => JSON.parse(answer.text).data.echo)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('goes on serving after a coordinator call that failed, which a port never should: that request gets 500 and the next one is answered', async () => {
    const { coordinator } = recording((raw) => (raw.body.ok && raw.body.value === 'boom' ? Promise.reject(new Error('a port broke its promise')) : OK_REPLY));
    const port = await started(coordinator);

    const [broken, next] = await Promise.all([post(port, '/api/command', 'boom'), post(port, '/api/command', 'fine')]);

    expect(broken.status).toBe(500);
    expect(next.status).toBe(200);
    expect((await post(port, '/api/query', 'again')).status).toBe(200);
  });

  it('answers the port it listens on, and NETWORK_ERROR for a port that is taken or is no port at all', async () => {
    const port = await started(recording().coordinator);
    const second = createHttpServerGateway(recording().coordinator);
    servers.push(second);

    expect(port).toBeGreaterThan(0);
    expect(await second.listen(port)).toMatchObject({ ok: false, err: { code: 'NETWORK_ERROR' } });
    expect(await createHttpServerGateway(recording().coordinator).listen(-1)).toMatchObject({ ok: false, err: { code: 'NETWORK_ERROR' } });
    expect(await createHttpServerGateway(recording().coordinator).listen(70_000)).toMatchObject({ ok: false, err: { code: 'NETWORK_ERROR' } });
  });

  it('stops listening when it is closed, and closing it again, or closing one that never listened, is no error', async () => {
    const server = createHttpServerGateway(recording().coordinator);
    const listening = await server.listen(0);
    const port = listening.ok ? listening.value : expect.unreachable('the server did not start');
    expect((await send(port, 'GET', '/healthz')).status).toBe(200);

    await server.close();
    await server.close();
    await createHttpServerGateway(recording().coordinator).close();

    await expect(send(port, 'GET', '/healthz')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });
});
