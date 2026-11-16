import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// Proves the guard rails of eslint.guards.mjs (plan, phase 1). For each rule it lints snippets
// that must be rejected and snippets that must be accepted, through the real eslint.config.mjs,
// as if each snippet were a file at a given path. A lint pattern that matches nothing passes
// silently in normal use, so it would fail here instead.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const GUARD_RULES = [
  'no-restricted-imports',
  'no-restricted-syntax',
  'no-restricted-globals',
  'max-lines',
  'max-lines-per-function',
];

type Case = readonly [path: string, code: string];

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: root });
});

/** The guard rules that fire when `code` is linted as the file `path`. */
async function fired(path: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(root, path) });
  const messages = result?.messages ?? [];
  const broken = messages.find((message) => message.fatal);
  if (broken) throw new Error(`the snippet for ${path} does not parse: ${broken.message}`);
  const ids = messages.map((message) => message.ruleId ?? '').filter((id) => GUARD_RULES.includes(id));
  return [...new Set(ids)];
}

async function expectRejected(rule: string, cases: readonly Case[]): Promise<void> {
  for (const [path, code] of cases) {
    expect(await fired(path, code), `${path} must reject: ${code.slice(0, 70)}`).toContain(rule);
  }
}

async function expectAccepted(cases: readonly Case[]): Promise<void> {
  for (const [path, code] of cases) {
    expect(await fired(path, code), `${path} must accept: ${code.slice(0, 70)}`).toEqual([]);
  }
}

/** Every path in `paths` combined with every snippet in `codes`. */
function across(paths: readonly string[], codes: readonly string[]): Case[] {
  return paths.flatMap((path) => codes.map((code): Case => [path, code]));
}

const codeLines = (count: number): string =>
  Array.from({ length: count }, (_, index) => `export const v${index} = ${index};`).join('\n');

/** A function of exactly `total` lines. */
const functionOf = (total: number): string =>
  `export function run() {\n${Array.from({ length: total - 2 }, (_, index) => `  const v${index} = ${index};`).join('\n')}\n}\n`;

const BACKEND_MODULE = 'packages/backend/src/modules/foundation/probe.ts';
const FRONTEND_MODULE = 'packages/frontend/src/modules/slices/probe.ts';
const BACKEND_SUB = 'packages/backend/src/coordinators/QueryCoordinator.ts';
const FRONTEND_SUB = 'packages/frontend/src/coordinators/ShellCoordinator.ts';
const BACKEND_TOP = 'packages/backend/src/coordinators/BackendCoordinator.ts';
const FRONTEND_TOP = 'packages/frontend/src/coordinators/AppCoordinator.ts';
const BACKEND_GATEWAY = 'packages/backend/src/gateways/storeReadGateway.ts';
const MYSQL_SUPPORT = 'packages/backend/src/gateways/mysql/pool.ts';
const MEMORY_GATEWAY = 'packages/backend/src/gateways/memory/memoryStore.ts';
const FRONTEND_GATEWAY = 'packages/frontend/src/gateways/domHostGateway.ts';
const CONTRACT = 'contracts/primitives/src/probe.ts';
const API_APP = 'apps/api/src/probe.ts';
const WEB_APP = 'apps/web/src/app/probe.tsx';

const PURE_CODE = [BACKEND_MODULE, FRONTEND_MODULE, BACKEND_SUB, FRONTEND_SUB, BACKEND_TOP, FRONTEND_TOP];

const importOf = (specifier: string): string => `import { x } from '${specifier}';\nexport const a = x;\n`;

describe('guard rails', { timeout: 120_000 }, () => {
  it('stops pure code from reading a clock or a random source, and every source file from throwing', async () => {
    await expectRejected(
      'no-restricted-syntax',
      across([...PURE_CODE, CONTRACT], [
        'export const bad = () => new Date();',
        'export const bad = () => Date.now();',
        "export const bad = () => Date['now']();",
        'export const bad = () => Date();',
        'export const bad = () => Math.random();',
      ]),
    );
    await expectAccepted(
      across(PURE_CODE, [
        'export const ok = (iso: string) => new Date(iso);',
        'export const ok = () => new Date(2026, 9, 1);',
        'export const ok = () => Date.UTC(2026, 9, 1);',
        'export const ok = (a: number, b: number) => Math.max(a, b);',
      ]),
    );
    // gateways do the IO, so the clock belongs to them
    await expectAccepted([[BACKEND_GATEWAY, 'export const ok = () => new Date();']]);

    // errors are values: no `throw` anywhere in source, whether in pure code, a gateway or an app
    await expectRejected(
      'no-restricted-syntax',
      across([...PURE_CODE, BACKEND_GATEWAY, MYSQL_SUPPORT, MEMORY_GATEWAY, FRONTEND_GATEWAY, API_APP, WEB_APP], [
        "export const bad = () => { throw new Error('x'); };",
        "export function bad(code: string) { throw code; }",
        'export const bad = () => { try { return 1; } catch (inner) { throw inner; } };',
      ]),
    );
    await expectRejected('no-restricted-syntax', [[CONTRACT, "throw new Error('x');"]]);
    // the one native call that throws on bad input is caught, and the failure is returned
    await expectAccepted(
      across([...PURE_CODE, BACKEND_GATEWAY, FRONTEND_GATEWAY, API_APP], [
        'export const ok = (text: string) => { try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; } };',
      ]),
    );
  });

  it('keeps every IO global and IO import out of pure code', async () => {
    await expectRejected(
      'no-restricted-globals',
      across([...PURE_CODE, CONTRACT], [
        "export const bad = () => fetch('/x');",
        'export const bad = () => process.env.X;',
        'export const bad = () => document.title;',
        "export const bad = () => localStorage.getItem('k');",
        'export const bad = () => setTimeout(() => 1, 5);',
        'export const bad = () => crypto.randomUUID();',
        'export const bad = () => performance.now();',
        'export const bad = () => console.log(1);',
      ]),
    );
    await expectRejected(
      'no-restricted-imports',
      across([...PURE_CODE, CONTRACT], [
        importOf('node:fs'),
        importOf('node:fs/promises'),
        importOf('fs'),
        importOf('path'),
        importOf('http'),
        importOf('express'),
        importOf('mysql2/promise'),
        importOf('react'),
        importOf('next/navigation'),
      ]),
    );
    await expectRejected('no-restricted-syntax', [[BACKEND_MODULE, "export const bad = () => import('node:fs');"]]);
    await expectAccepted([
      ...across([BACKEND_MODULE, FRONTEND_MODULE], [
        importOf('joi'),
        importOf('xstate'),
        importOf('http-status-codes'),
        importOf('@freshrescue/contract-primitives'),
      ]),
      [CONTRACT, importOf('http-status-codes')],
      // a gateway is where IO belongs
      [BACKEND_GATEWAY, importOf('express') + importOf('node:fs/promises') + "export const f = () => fetch('/x');"],
      [FRONTEND_GATEWAY, 'export const ok = () => document.title + String(setTimeout(() => 1, 5));'],
    ]);
  });

  it('gives modules, coordinators and gateways no peer', async () => {
    // a module imports contracts only
    await expectRejected(
      'no-restricted-imports',
      across([BACKEND_MODULE, FRONTEND_MODULE], [
        importOf('./other'),
        importOf('../foundation/other'),
        importOf('../../coordinators/QueryCoordinator'),
        importOf('../../testing/fixtures'),
        "export { x } from './other';",
      ]),
    );
    // a sub-coordinator has no peer and no gateway; it may use modules
    await expectRejected(
      'no-restricted-imports',
      across([BACKEND_SUB, FRONTEND_SUB], [
        importOf('./InventoryCoordinator'),
        importOf('../coordinators/RecipeCommandCoordinator'),
        importOf('../gateways/ports'),
        importOf('../gateways/memory/memoryStore'),
        importOf('../testing/fixtures'),
      ]),
    );
    await expectAccepted(
      across([BACKEND_SUB, FRONTEND_SUB], [importOf('../modules/foundation/todayResolver'), importOf('@freshrescue/contract-messages')]),
    );
    // a top coordinator reaches its sub-coordinators and its gateways, but never testing/
    await expectAccepted(
      across([BACKEND_TOP, FRONTEND_TOP], [importOf('./QueryCoordinator'), importOf('../gateways/ports'), importOf('../modules/derive/stockAggregator')]),
    );
    await expectRejected('no-restricted-imports', across([BACKEND_TOP, FRONTEND_TOP], [importOf('../testing/fixtures')]));
    // a gateway has no module, no coordinator and no other gateway
    await expectRejected('no-restricted-imports', [
      [BACKEND_GATEWAY, importOf('../modules/engine/changeSetEncoder')],
      [BACKEND_GATEWAY, importOf('../coordinators/BackendCoordinator')],
      [BACKEND_GATEWAY, importOf('./clockGateway')],
      [BACKEND_GATEWAY, importOf('../testing/fixtures')],
      [MYSQL_SUPPORT, importOf('../../modules/state/changeSetApplier')],
      [MYSQL_SUPPORT, importOf('../clockGateway')],
      [MEMORY_GATEWAY, importOf('./fixedClock')],
      [FRONTEND_GATEWAY, importOf('../modules/views/appShellView')],
      [FRONTEND_GATEWAY, importOf('../coordinators/AppCoordinator')],
    ]);
    await expectAccepted([
      [BACKEND_GATEWAY, importOf('./ports')],
      [BACKEND_GATEWAY, importOf('./mysql/pool')],
      [MYSQL_SUPPORT, importOf('../ports')],
      [MEMORY_GATEWAY, importOf('../ports')],
      [FRONTEND_GATEWAY, importOf('@freshrescue/contract-ui')],
    ]);
    // no app package is imported below apps, and an app imports its own package only
    await expectRejected(
      'no-restricted-imports',
      across([...PURE_CODE, BACKEND_GATEWAY, CONTRACT, 'packages/backend/src/index.ts'], [importOf('@freshrescue/api'), importOf('@freshrescue/web')]),
    );
    await expectRejected(
      'no-restricted-imports',
      across([API_APP], [importOf('@freshrescue/contract-primitives'), importOf('@freshrescue/frontend'), importOf('@freshrescue/web')]),
    );
    await expectRejected(
      'no-restricted-imports',
      across([WEB_APP], [importOf('@freshrescue/contract-ui'), importOf('@freshrescue/backend'), importOf('@freshrescue/api')]),
    );
    await expectAccepted([
      [API_APP, importOf('@freshrescue/backend')],
      [WEB_APP, importOf('@freshrescue/frontend') + importOf('next')],
    ]);
  });

  it('caps a file at 1000 lines and a coordinator function at 60', async () => {
    const padded = `${codeLines(1000)}\n\n\n// comment lines and blank lines are not counted\n/* a block\n   comment */\n`;
    await expectRejected('max-lines', [
      [BACKEND_MODULE, codeLines(1001)],
      [BACKEND_SUB, codeLines(1001)],
      [BACKEND_GATEWAY, codeLines(1001)],
      [CONTRACT, codeLines(1001)],
      [API_APP, codeLines(1001)],
      ['packages/backend/src/testing/fixtures.ts', codeLines(1001)],
    ]);
    await expectAccepted([
      [BACKEND_MODULE, padded],
      [BACKEND_SUB, padded],
      [BACKEND_GATEWAY, padded],
    ]);
    // the function cap belongs to coordinators
    await expectRejected('max-lines-per-function', across([BACKEND_SUB, FRONTEND_SUB, BACKEND_TOP, FRONTEND_TOP], [functionOf(61)]));
    await expectAccepted([
      ...across([BACKEND_SUB, FRONTEND_TOP], [functionOf(60)]),
      [BACKEND_MODULE, functionOf(61)],
      [BACKEND_GATEWAY, functionOf(61)],
    ]);
  });

  it('lets a contract hold types and constants and nothing else', async () => {
    await expectRejected('no-restricted-syntax', [
      [CONTRACT, 'export function f() { return 1; }'],
      [CONTRACT, 'export const f = () => 1;'],
      [CONTRACT, 'export const f = function () { return 1; };'],
      [CONTRACT, 'export class C {}'],
      [CONTRACT, 'export const o = { m() { return 1; } };'],
      ['contracts/ui/src/probe.ts', 'export const f = (x: number) => x;'],
      // a constant can still call a clock, so a contract may not
      [CONTRACT, 'export const now = new Date();'],
    ]);
    await expectAccepted([
      [CONTRACT, "export type Id = number & { readonly brand: 'Id' };"],
      [CONTRACT, 'export interface Port { handle(raw: string): Promise<string>; }'],
      [CONTRACT, 'export type Fn = (x: number) => string;'],
      [CONTRACT, 'export const LIMITS = { NAME_MAX: 200 } as const;'],
      [CONTRACT, "export const UNIT_LIST = ['grams', 'kg'] as const satisfies readonly string[];"],
      [CONTRACT, "import type { Id } from '@freshrescue/contract-primitives';\nexport type A = Id;"],
    ]);
  });

  it('exempts tests from every rule', async () => {
    const everything = `${importOf('./other')}${importOf('node:fs')}export const t = [new Date(), Date.now(), Math.random(), fetch, document];\nexport const boom = () => { throw new Error('a test may throw'); };\n`;
    await expectAccepted([
      ['packages/backend/src/modules/foundation/probe.test.ts', everything],
      ['packages/frontend/src/modules/views/probe.dom.test.ts', everything],
      ['packages/backend/src/coordinators/QueryCoordinator.test.ts', everything + functionOf(100)],
      ['packages/backend/src/gateways/storeReadGateway.db.test.ts', importOf('../modules/engine/changeSetEncoder')],
      ['contracts/primitives/src/primitives.test.ts', 'export function f() { return 1; }\nexport class C {}\n'],
      ['apps/api/src/probe.e2e.test.ts', importOf('@freshrescue/contract-primitives')],
      [BACKEND_MODULE.replace('probe.ts', 'probe.test.ts'), codeLines(1500)],
      // testing/ holds builders and fakes for tests: not a module, so it keeps no module rule
      ['packages/backend/src/testing/fixtures.ts', importOf('../modules/foundation/idAllocator') + 'export const t = new Date();\n'],
    ]);
  });
});
