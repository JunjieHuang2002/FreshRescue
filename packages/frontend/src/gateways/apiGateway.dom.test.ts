import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Envelope } from '@freshrescue/contract-messages';
import { createApiGateway } from './apiGateway';

const QUERY: Envelope = { type: 'GetInventoryList', params: {} };
const COMMAND: Envelope = { type: 'RemoveBatch', payload: { batchId: 31 } };

/** What `fetch` resolves to, as far as the gateway reads it: the status and the body text. */
const answer = (status: number, bodyText: string) => ({ status, text: async () => bodyText });

const JSON_POST = (body: Envelope) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('apiGateway', () => {
  it('posts a command to /api/command and a query to /api/query as JSON, and hands back the status and the body text', async () => {
    const fetch = vi.fn(async (_url: string, _init: unknown) => answer(200, '{"ok":true}'));
    vi.stubGlobal('fetch', fetch);
    const api = createApiGateway();

    expect(await api.send(COMMAND)).toEqual({ ok: true, value: { status: 200, bodyText: '{"ok":true}' } });
    expect(await api.send(QUERY)).toEqual({ ok: true, value: { status: 200, bodyText: '{"ok":true}' } });
    expect(fetch.mock.calls).toEqual([
      ['/api/command', JSON_POST(COMMAND)],
      ['/api/query', JSON_POST(QUERY)],
    ]);
  });

  it('posts to the server that it is pointed at', async () => {
    const fetch = vi.fn(async (_url: string, _init: unknown) => answer(200, '{}'));
    vi.stubGlobal('fetch', fetch);
    await createApiGateway({ baseUrl: 'http://127.0.0.1:4100' }).send(QUERY);
    expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:4100/api/query');
  });

  it('hands back an answer with an error status as it is, because only the parser can tell what it means', async () => {
    vi.stubGlobal('fetch', async () => answer(502, '<html>Bad Gateway</html>'));
    expect(await createApiGateway().send(QUERY)).toEqual({ ok: true, value: { status: 502, bodyText: '<html>Bad Gateway</html>' } });
  });

  it('returns NETWORK_ERROR when fetch fails, which is what the browser does with no server or no network', async () => {
    vi.stubGlobal('fetch', async () => Promise.reject(new TypeError('Failed to fetch')));
    const result = await createApiGateway().send(COMMAND);
    expect(result).toEqual({ ok: false, err: { code: 'NETWORK_ERROR', detail: 'RemoveBatch to /api/command: Failed to fetch' } });
  });

  it('returns NETWORK_ERROR when the connection drops while the body is read', async () => {
    vi.stubGlobal('fetch', async () => ({ status: 200, text: async () => Promise.reject(new Error('socket hang up')) }));
    const result = await createApiGateway().send(QUERY);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.err.code).toBe('NETWORK_ERROR');
    expect(!result.ok && result.err.detail).toContain('socket hang up');
  });

  it('returns NETWORK_ERROR, and does not throw, when there is no fetch at all', async () => {
    vi.stubGlobal('fetch', undefined);
    const result = await createApiGateway().send(QUERY);
    expect(!result.ok && result.err.code).toBe('NETWORK_ERROR');
  });

  it('returns TIMEOUT when fetch never answers, after 10 seconds by default', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    let settled: unknown = 'pending';
    void createApiGateway()
      .send(QUERY)
      .then((result) => (settled = result));

    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ ok: false, err: { code: 'TIMEOUT', detail: 'GetInventoryList to /api/query: no answer within 10000 ms' } });
  });

  it('returns TIMEOUT after the time it is given', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    let settled: unknown = 'pending';
    void createApiGateway({ timeoutMs: 250 })
      .send(COMMAND)
      .then((result) => (settled = result));

    await vi.advanceTimersByTimeAsync(250);
    expect(settled).toEqual({ ok: false, err: { code: 'TIMEOUT', detail: 'RemoveBatch to /api/command: no answer within 250 ms' } });
  });

  it('uses a timer that races the request: an answer that comes in time wins, and the timer is cleared', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', () => new Promise((resolve) => setTimeout(() => resolve(answer(200, '{"late":false}')), 9_000)));
    let settled: unknown = 'pending';
    void createApiGateway()
      .send(QUERY)
      .then((result) => (settled = result));

    await vi.advanceTimersByTimeAsync(9_000);
    expect(settled).toEqual({ ok: true, value: { status: 200, bodyText: '{"late":false}' } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts the time to read the body as part of the request', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', async () => ({ status: 200, text: () => new Promise(() => {}) }));
    let settled: unknown = 'pending';
    void createApiGateway({ timeoutMs: 100 })
      .send(QUERY)
      .then((result) => (settled = result));

    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toMatchObject({ ok: false, err: { code: 'TIMEOUT' } });
  });

  it('touches nothing until a request is sent, so it can be created where there is no browser', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.useFakeTimers();
    createApiGateway();
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
