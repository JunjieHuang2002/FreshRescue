#!/usr/bin/env node
// Boots the API and the built web app, then checks that the pieces are wired together:
//   1. the API answers /healthz on port 4000
//   2. the web app serves the real page on port 3000: it holds all 16 slot elements of the `ui` contract
//   3. a GetReferenceData query posted to port 3000 reaches Express and MySQL (the /api rewrite works)
//   4. the CSS that apps/web built holds the classes of the `ui` contract's style tokens, which Tailwind
//      finds only through the @source line for contracts/ui
// The slot ids and the token classes are read from the source of the `ui` contract, so this script
// checks the page against the contract itself. Prints `smoke OK` and exits 0, or says what failed and exits 1.
//
//   npm run build && node tools/smoke-dev.mjs
//
// It starts the same `start` scripts a person would use, each in its own process group,
// and always stops them again, so a failed run leaves nothing holding the ports. The API's
// `start` script reads DATABASE_URL from .env, as `npm run dev` does, so the API runs on the
// development database: its first start creates the tables there and seeds the store.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const API_PORT = 4000;
const WEB_PORT = 3000;
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;

/** The 16 slot ids, as `SLOT_IDS` in contracts/ui/src/render-tree.ts lists them. */
function slotIdsOfContract() {
  const source = readFileSync(resolve(root, 'contracts/ui/src/render-tree.ts'), 'utf8');
  const list = /export const SLOT_IDS = \[([^\]]*)\]/.exec(source);
  return list === null ? [] : [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

/**
 * Every class of the style tokens in contracts/ui/src/tokens.ts (TONE_CLASS, LAYOUT_CLASS, CONTROL_CLASS).
 * A class with a variant or a dot is written escaped in CSS (`hover\:bg-slate-100`, `py-0\.5`), so only the
 * plain ones are looked for: they are enough to show that Tailwind scanned the contract.
 */
function tokenClassesOfContract() {
  const source = readFileSync(resolve(root, 'contracts/ui/src/tokens.ts'), 'utf8');
  const tables = [...source.matchAll(/export const (?:TONE|LAYOUT|CONTROL)_CLASS = \{([^}]*)\}/g)].map((match) => match[1]);
  const classes = tables.flatMap((table) => [...table.matchAll(/'([^']*)'/g)].flatMap((match) => match[1].split(/\s+/)));
  return [...new Set(classes.filter((name) => /^[a-z][a-z0-9-]*$/.test(name)))];
}

class SmokeError extends Error {}

const services = [];

function startService(name, args, extraEnv) {
  const child = spawn('npm', args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    detached: true, // a process group of its own, so the whole tree can be stopped
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const service = { name, child, output: '', exited: false, code: null };
  const collect = (chunk) => {
    service.output += chunk;
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.once('error', (error) => {
    service.output += `${error.message}\n`;
    service.exited = true;
  });
  child.once('exit', (code) => {
    service.exited = true;
    service.code = code;
  });
  services.push(service);
  return service;
}

function signalGroup(service, signal) {
  if (!service.child.pid) return;
  try {
    process.kill(-service.child.pid, signal);
  } catch {
    // the group is already gone
  }
}

async function isListening(port) {
  for (const host of ['127.0.0.1', '::1']) {
    const busy = await new Promise((resolveBusy) => {
      const socket = net.connect({ host, port });
      socket.once('connect', () => {
        socket.destroy();
        resolveBusy(true);
      });
      socket.once('error', () => resolveBusy(false));
    });
    if (busy) return true;
  }
  return false;
}

async function waitUntilFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isListening(port))) return true;
    await sleep(100);
  }
  return false;
}

async function stopAll() {
  for (const service of [...services].reverse()) signalGroup(service, 'SIGTERM');
  for (const [service, port] of [
    [services.find((s) => s.name === 'web'), WEB_PORT],
    [services.find((s) => s.name === 'api'), API_PORT],
  ]) {
    if (!service) continue;
    if (!(await waitUntilFree(port, 8000))) {
      signalGroup(service, 'SIGKILL');
      await waitUntilFree(port, 3000);
    }
  }
}

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'manual' });
  return { status: response.status, text: await response.text() };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
    redirect: 'manual',
  });
  return { status: response.status, text: await response.text() };
}

async function waitUntilUp(service, url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (service.exited) throw new SmokeError(`the ${service.name} process exited early (code ${service.code})`);
    try {
      if ((await get(url)).status === 200) return;
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  throw new SmokeError(`the ${service.name} did not answer ${url} within ${timeoutMs / 1000}s`);
}

function expect(condition, message) {
  if (!condition) throw new SmokeError(message);
}

function stylesheetsOf(html) {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /\brel=["']stylesheet["']/i.test(tag))
    .map((tag) => /\bhref=["']([^"']+)["']/i.exec(tag)?.[1])
    .filter(Boolean);
  const inline = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]);
  return { links, inline };
}

async function run() {
  expect(
    existsSync(resolve(root, 'apps/web/.next/BUILD_ID')),
    'apps/web has no production build. Run `npm run build` first.',
  );
  for (const port of [API_PORT, WEB_PORT]) {
    expect(!(await isListening(port)), `port ${port} is already in use. Stop whatever is listening on it first.`);
  }

  // 1. the API
  const api = startService('api', ['run', 'start', '-w', '@freshrescue/api'], { API_PORT: String(API_PORT) });
  await waitUntilUp(api, `${API}/healthz`, 30_000);
  const health = await get(`${API}/healthz`);
  expect(JSON.parse(health.text).ok === true, `the API's /healthz answered ${health.text}`);
  console.log(`  ok  the API answers /healthz on port ${API_PORT}`);

  // 2. the web app, and the slots that AppHost renders for the DOM host to paint into
  const web = startService('web', ['run', 'start', '-w', '@freshrescue/web'], {});
  await waitUntilUp(web, `${WEB}/`, 60_000);
  const page = await get(`${WEB}/`);
  expect(page.text.includes('FreshRescue'), 'the home page does not contain "FreshRescue"');
  const slots = slotIdsOfContract();
  expect(slots.length === 16, `contracts/ui/src/render-tree.ts lists ${slots.length} slot ids, where 16 were expected`);
  const missingSlots = slots.filter((slot) => !page.text.includes(`data-slot="${slot}"`));
  expect(missingSlots.length === 0, `the home page lacks the slot element(s) ${missingSlots.join(', ')}`);
  console.log(`  ok  the web app renders its page on port ${WEB_PORT}, with all ${slots.length} slot elements`);

  // 3. the rewrite, all the way to MySQL: the reference data comes from the stored snapshot, and a
  //    store that answers at all holds the system category Other, which startup writes when it seeds
  const answer = await postJson(`${WEB}/api/query`, { type: 'GetReferenceData', params: {} });
  expect(answer.status === 200, `GetReferenceData through port ${WEB_PORT} answered status ${answer.status}: ${answer.text.slice(0, 300)}`);
  let reply = null;
  try {
    reply = JSON.parse(answer.text);
  } catch {
    // not JSON: reported just below
  }
  expect(reply !== null && typeof reply === 'object', `GetReferenceData through port ${WEB_PORT} did not answer JSON: ${answer.text.slice(0, 300)}`);
  expect(
    reply.ok === true && /^\d{4}-\d{2}-\d{2}$/.test(reply.meta?.today ?? ''),
    `GetReferenceData through port ${WEB_PORT} did not answer an ApiResponse for today: ${answer.text.slice(0, 300)}`,
  );
  expect(
    (reply.data?.foodCategories ?? []).some((category) => category.isSystem === true && category.name === 'Other'),
    `the reference data holds no system category Other, so it did not come from the seeded store: ${answer.text.slice(0, 300)}`,
  );
  console.log(`  ok  a GetReferenceData query through port ${WEB_PORT} reaches Express on port ${API_PORT} and MySQL`);

  // 4. the CSS
  const { links, inline } = stylesheetsOf(page.text);
  expect(links.length + inline.length > 0, 'the home page links no stylesheet');
  let css = inline.join('\n');
  for (const href of links) {
    const sheet = await get(new URL(href, WEB).toString());
    expect(sheet.status === 200, `the stylesheet ${href} answered status ${sheet.status}`);
    css += `\n${sheet.text}`;
  }
  const tokens = tokenClassesOfContract();
  expect(tokens.length > 0, 'no class was found in the style tokens of contracts/ui/src/tokens.ts');
  const absent = tokens.filter((name) => !new RegExp(`\\.${name}(?![\\w-])`).test(css));
  expect(
    absent.length === 0,
    `the built CSS lacks ${absent.map((name) => `.${name}`).join(', ')} of the ui contract's tokens; ${links.length} stylesheet(s) were searched: ${links.join(', ') || 'none'}`,
  );
  console.log(`  ok  the built CSS holds all ${tokens.length} plain classes of the ui contract's style tokens`);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopAll().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  });
}

let failure = null;
try {
  await run();
} catch (error) {
  failure = error;
}
await stopAll();

if (failure) {
  console.error(`smoke FAILED: ${failure.message}`);
  if (!(failure instanceof SmokeError)) console.error(failure.stack);
  for (const service of services) {
    const lines = service.output.trimEnd().split('\n').slice(-30);
    console.error(`--- last output of the ${service.name} ---\n${lines.join('\n')}`);
  }
  process.exit(1);
}
console.log('smoke OK');
