#!/usr/bin/env node
// The Docker stack runs and answers (plan, phase 11, row 3). Starts the stack of compose.yaml from its images,
// checks it in this order, and always ends by taking it down together with its volume:
//   1. `docker compose up -d --wait` returns only when db, api and web are all healthy; the logs of a service
//      that never becomes healthy are printed
//   2. GET / on port 3000 answers 200 and holds the 16 slot elements of the `ui` contract
//   3. a GetReferenceData query posted to /api/query on port 3000, which the web container forwards to the
//      API, returns the 8 seeded Food Types, and GetCatalog returns the 6 recipes
//   4. one command round trip: a SaveCategory command sent through port 3000 creates a category, and a later
//      query lists it
//   5. after `docker compose restart api` and a wait for its health, the category is still there and the seed
//      was not loaded twice: still 8 Food Types and 6 recipes
//   6. `docker compose down -v`, whatever happened before, after which no container and no volume of the
//      project is left (row 4)
// It takes down only a stack that it started itself. When the project already has a container or a data
// volume, it says so and touches nothing, because `down -v` would erase that data. The slot ids are read
// from the source of the `ui` contract, as tools/smoke-dev.mjs reads them.
//
// Prints `compose OK` and exits 0, or says what failed and exits 1.
//
//   docker compose build && node tools/smoke-compose.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const WEB_PORT = 3000;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const UP_TIMEOUT_S = 300;
const HEALTH_TIMEOUT_MS = 120_000;
const SERVICES = ['db', 'api', 'web'];
/** Spec Appendix A, as the seed file holds it. */
const SEEDED_FOOD_TYPES = ['Beef', 'Broccoli', 'Chicken', 'Egg', 'Milk', 'Rice', 'Spinach', 'Tomato'];
const SEEDED_RECIPES = 6;
const NEW_CATEGORY = 'Smoke Check Shelf';

// ---- docker compose -------------------------------------------------------------------------

/** Runs `docker compose <args>` in the repository, and gives back its exit code and everything it printed. */
function compose(args, timeoutMs = 600_000) {
  const run = spawnSync('docker', ['compose', ...args], { cwd: root, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const failure = run.error === undefined ? '' : `${run.error.message}\n`;
  return { code: run.status ?? -1, output: `${run.stdout ?? ''}${run.stderr ?? ''}${failure}` };
}

/** Parses JSON, or gives back null. */
function parsed(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The name of the project and the names of its volumes, as compose resolves them. */
function project() {
  const config = compose(['config', '--format', 'json']);
  const value = config.code === 0 ? parsed(config.output) : null;
  if (value === null || typeof value.name !== 'string') return { problem: `docker compose config failed: ${config.output.trim().slice(-400)}` };
  return { name: value.name, volumes: Object.values(value.volumes ?? {}).map((volume) => volume.name) };
}

/** The containers of the project with their service, state and health. `ps --format json` prints one object per line. */
function containers() {
  const listed = compose(['ps', '--all', '--format', 'json']);
  if (listed.code !== 0) return [];
  const text = listed.output.trim();
  const rows = text.startsWith('[') ? (parsed(text) ?? []) : text.split('\n').filter((line) => line.trim() !== '').map(parsed);
  return rows.filter((row) => row !== null && typeof row === 'object');
}

/** The volumes of the project that exist. */
function volumesLeft(names) {
  const listed = spawnSync('docker', ['volume', 'ls', '--quiet'], { encoding: 'utf8' });
  const present = new Set((listed.stdout ?? '').split('\n').map((line) => line.trim()));
  return names.filter((name) => present.has(name));
}

function lastLines(text, count) {
  return text.trimEnd().split('\n').slice(-count).join('\n');
}

/** Prints the logs of each service that is not healthy, so a failed start says why. */
function printLogsOfUnhealthy() {
  const rows = containers();
  for (const service of SERVICES) {
    const row = rows.find((each) => each.Service === service);
    if (row !== undefined && row.State === 'running' && row.Health === 'healthy') continue;
    const state = row === undefined ? 'no container' : `${row.State}${row.Health ? `, ${row.Health}` : ''}`;
    console.error(`--- ${service} (${state}): last lines of its logs ---`);
    console.error(lastLines(compose(['logs', '--no-color', '--tail', '60', service]).output, 60));
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

// ---- the stack through port 3000 ------------------------------------------------------------

/** One request to the web container: its status and body, or status 0 and the reason when there was no answer. */
async function request(path, init = {}) {
  try {
    const response = await fetch(`${WEB}${path}`, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    return { status: response.status, text: await response.text() };
  } catch (error) {
    return { status: 0, text: error instanceof Error ? error.message : String(error) };
  }
}

/** Posts one envelope to /api/<route> on port 3000, and gives back the data of a successful ApiResponse or the problem. */
async function send(route, envelope) {
  const answer = await request(`/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) });
  const reply = parsed(answer.text);
  if (answer.status === 200 && reply?.ok === true) return { data: reply.data };
  return { problem: `${envelope.type} through port ${WEB_PORT} answered ${answer.status}: ${answer.text.slice(0, 300)}` };
}

/** What the store holds, as the page would read it: the Food Types, the food categories and the recipes. */
async function stored() {
  const reference = await send('query', { type: 'GetReferenceData', params: {} });
  if (reference.problem) return reference;
  const catalog = await send('query', { type: 'GetCatalog', params: { cuisineId: null } });
  if (catalog.problem) return catalog;
  const categories = (reference.data.foodCategories ?? []).flatMap((node) => [node, ...(node.children ?? [])]);
  return {
    foodTypes: (reference.data.foodTypes ?? []).map((foodType) => foodType.name),
    categories: categories.map((node) => ({ id: node.id, name: node.name })),
    recipes: (catalog.data.rows ?? []).map((row) => row.name),
  };
}

/** The problem with the seeded data, or null: the 8 Food Types of Appendix A and its 6 recipes, each exactly once. */
function seedProblem(store) {
  if (JSON.stringify(store.foodTypes) !== JSON.stringify(SEEDED_FOOD_TYPES)) {
    return `the reference data lists the Food Types ${JSON.stringify(store.foodTypes)}, where the seed has ${JSON.stringify(SEEDED_FOOD_TYPES)}`;
  }
  return store.recipes.length === SEEDED_RECIPES ? null : `the catalog lists ${store.recipes.length} recipes, where the seed has ${SEEDED_RECIPES}`;
}

/** The 16 slot ids, as `SLOT_IDS` in contracts/ui/src/render-tree.ts lists them. */
function slotIdsOfContract() {
  const source = readFileSync(resolve(root, 'contracts/ui/src/render-tree.ts'), 'utf8');
  const list = /export const SLOT_IDS = \[([^\]]*)\]/.exec(source);
  return list === null ? [] : [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

async function waitUntilHealthy(service) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const row = containers().find((each) => each.Service === service);
    if (row?.State === 'running' && row.Health === 'healthy') return null;
    if (row !== undefined && row.State !== 'running' && row.State !== 'restarting') return `the ${service} container is ${row.State}`;
    await sleep(1_000);
  }
  return `the ${service} service did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s`;
}

// ---- the checks -----------------------------------------------------------------------------

/** Each check gives back null when it holds, or the problem. They run in order, and the first problem stops the run. */
const CHECKS = [
  [
    'docker compose up -d --wait returned: db, api and web are healthy',
    async () => {
      const up = compose(['up', '--detach', '--wait', '--wait-timeout', String(UP_TIMEOUT_S)], (UP_TIMEOUT_S + 60) * 1000);
      if (up.code === 0) return null;
      printLogsOfUnhealthy();
      return `docker compose up -d --wait failed (exit ${up.code}):\n${lastLines(up.output, 20)}`;
    },
  ],
  [
    `GET / on port ${WEB_PORT} answers 200 and holds all 16 slot elements`,
    async () => {
      const page = await request('/');
      if (page.status !== 200) return `GET / on port ${WEB_PORT} answered ${page.status}: ${page.text.slice(0, 300)}`;
      const slots = slotIdsOfContract();
      if (slots.length !== 16) return `contracts/ui/src/render-tree.ts lists ${slots.length} slot ids, where 16 were expected`;
      const missing = slots.filter((slot) => !page.text.includes(`data-slot="${slot}"`));
      return missing.length === 0 ? null : `the page lacks the slot element(s) ${missing.join(', ')}`;
    },
  ],
  [
    `GetReferenceData and GetCatalog through port ${WEB_PORT} give the 8 seeded Food Types and the 6 recipes`,
    async () => {
      const store = await stored();
      return store.problem ?? seedProblem(store);
    },
  ],
  [
    `a SaveCategory command through port ${WEB_PORT} creates "${NEW_CATEGORY}", and a later query lists it`,
    async () => {
      const saved = await send('command', { type: 'SaveCategory', payload: { scope: 'foodCategory', categoryId: null, parentId: null, name: NEW_CATEGORY } });
      if (saved.problem) return saved.problem;
      const store = await stored();
      if (store.problem) return store.problem;
      const listed = store.categories.some((category) => category.id === saved.data.categoryId && category.name === NEW_CATEGORY);
      return listed ? null : `the new category ${saved.data.categoryId} is not in the reference data: ${JSON.stringify(store.categories)}`;
    },
  ],
  [
    'after docker compose restart api, the category is still there, and the seed was not loaded twice',
    async () => {
      const restarted = compose(['restart', 'api']);
      if (restarted.code !== 0) return `docker compose restart api failed (exit ${restarted.code}): ${lastLines(restarted.output, 10)}`;
      const unhealthy = await waitUntilHealthy('api');
      if (unhealthy !== null) {
        printLogsOfUnhealthy();
        return unhealthy;
      }
      const store = await stored();
      if (store.problem) return store.problem;
      if (!store.categories.some((category) => category.name === NEW_CATEGORY)) return `"${NEW_CATEGORY}" is gone after the restart`;
      return seedProblem(store);
    },
  ],
];

// ---- main -----------------------------------------------------------------------------------

const stack = project();
if (stack.problem) {
  console.error(`compose FAILED: ${stack.problem}`);
  process.exit(1);
}
const already = containers();
const keptVolumes = volumesLeft(stack.volumes);
if (already.length > 0 || keptVolumes.length > 0) {
  const what = [...already.map((row) => `container ${row.Name}`), ...keptVolumes.map((name) => `volume ${name}`)];
  console.error(`compose FAILED: the project "${stack.name}" already has ${what.join(', ')}. This check takes down only a stack it started itself,`);
  console.error('because `docker compose down -v` erases the data. Take it down first with `docker compose down -v` if that data can go.');
  process.exit(1);
}
if (await isListening(WEB_PORT)) {
  console.error(`compose FAILED: port ${WEB_PORT} is already in use. Stop the dev servers (or whatever listens on it) first.`);
  process.exit(1);
}

let tornDown = false;
function tearDown() {
  if (tornDown) return null;
  tornDown = true;
  const down = compose(['down', '--volumes'], 180_000);
  if (down.code !== 0) return `docker compose down -v failed (exit ${down.code}): ${lastLines(down.output, 10)}`;
  const left = [...containers().map((row) => `container ${row.Name}`), ...volumesLeft(stack.volumes).map((name) => `volume ${name}`)];
  return left.length === 0 ? null : `docker compose down -v left ${left.join(', ')}`;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    tearDown();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

let failure = null;
for (const [name, check] of CHECKS) {
  failure = await check();
  if (failure !== null) break;
  console.log(`  ok  ${name}`);
}
const teardownProblem = tearDown();
if (teardownProblem === null) console.log(`  ok  docker compose down -v left no container and no volume of the project "${stack.name}"`);

if (failure !== null || teardownProblem !== null) {
  console.error(`compose FAILED: ${failure ?? teardownProblem}`);
  if (failure !== null && teardownProblem !== null) console.error(`and the teardown: ${teardownProblem}`);
  process.exit(1);
}
console.log('compose OK');
