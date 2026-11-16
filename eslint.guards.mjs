// The blueprint's four rules as lint rules (plan, phase 1, "The guard rails").
// eslint.config.mjs spreads `guardRails` into the flat config.
//
//   Pure vs IO       modules, every coordinator and the contracts: no clock, no random source, no IO
//                    global, no IO import. Gateways do the IO, so they are free to.
//   Zero peers       a module imports contracts only. A sub-coordinator imports no peer and no
//                    gateway. A gateway imports no module, no coordinator and no other gateway. No
//                    app package is imported below apps, and an app imports its own package only.
//   1000-line cap    every non-test file under src, and a coordinator function is capped at 60 lines.
//   Contract shape   no function, arrow function or class under contracts/*/src.
//   Errors are values  no `throw` statement in any source file: a failure is returned as a
//                    DomainError, and the one native call that throws on bad input is wrapped in
//                    try/catch and converted (blueprint 1.1; the specification of phase 3).
//
// Tests are exempt from all of them, so they can import the unit under test and read the clock.
// tools/guards.test.ts lints a snippet that must be rejected and one that must be accepted for
// each rule, so a pattern that matches nothing fails there.
//
// A rule that a later flat-config entry sets replaces the option list of an earlier entry. It does
// not merge. Each folder below therefore sets every restricted-* rule it needs in one entry, and
// the entries run from the general to the specific.
import { builtinModules } from 'node:module';
import { WORKSPACES } from './tools/architecture.mjs';

const TESTS = ['**/*.test.ts', '**/*.test.tsx'];
const TOP_COORDINATORS = [
  'packages/backend/src/coordinators/BackendCoordinator.ts',
  'packages/frontend/src/coordinators/AppCoordinator.ts',
];

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const anyOf = (names) => `^(?:${names.map(escapeRegex).join('|')})(?:/|$)`;

// ---- imports --------------------------------------------------------------------------------

const IO_MESSAGE = 'Pure code does no IO: a gateway does it and the coordinator hands the result in.';
const nodeBuiltins = builtinModules.filter((name) => !name.startsWith('_') && !name.startsWith('node:'));
const IO_LIBRARIES = ['express', 'mysql2', 'react', 'react-dom', 'next', 'jsdom', 'axios', 'node-fetch', 'undici', 'ws', 'tsx'];

const IO_IMPORTS = [
  { regex: '^node:', message: IO_MESSAGE },
  { regex: anyOf(nodeBuiltins), message: IO_MESSAGE },
  { regex: anyOf(IO_LIBRARIES), message: IO_MESSAGE },
];

const apps = WORKSPACES.filter((workspace) => workspace.kind === 'app');
const NO_APP_IMPORTS = {
  regex: anyOf(apps.map((app) => app.name)),
  message: 'No app package is imported below apps.',
};

const NO_TESTING_IMPORTS = {
  regex: '(?:^|/)testing(?:/|$)',
  message: 'testing/ holds builders and fakes for tests. Production code never imports it.',
};

const importRule = (patterns) => ({ 'no-restricted-imports': ['error', { patterns }] });

// ---- clock, random source, globals ----------------------------------------------------------

const CLOCK_MESSAGE = 'Pure code reads no clock and no random source: today and ids arrive as inputs.';

const CLOCK = [
  { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: CLOCK_MESSAGE },
  { selector: "CallExpression[callee.name='Date']", message: CLOCK_MESSAGE },
  { selector: "MemberExpression[object.name='Date'][computed=false][property.name='now']", message: CLOCK_MESSAGE },
  { selector: "MemberExpression[object.name='Date'][computed=true][property.value='now']", message: CLOCK_MESSAGE },
  { selector: "MemberExpression[object.name='Math'][computed=false][property.name='random']", message: CLOCK_MESSAGE },
  { selector: "MemberExpression[object.name='Math'][computed=true][property.value='random']", message: CLOCK_MESSAGE },
  { selector: 'ImportExpression', message: 'A dynamic import() hides a dependency from the import rules.' },
];

const NO_BEHAVIOUR = [
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassDeclaration',
  'ClassExpression',
].map((selector) => ({ selector, message: 'Contracts hold types and constants only: no functions and no classes.' }));

const IO_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'BroadcastChannel',
  'window', 'document', 'self', 'navigator', 'location', 'history',
  'localStorage', 'sessionStorage', 'indexedDB',
  'process', 'Buffer', 'global', 'globalThis', 'require',
  'crypto', 'performance', 'console',
  'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
  'alert', 'confirm', 'prompt',
].map((name) => ({ name, message: IO_MESSAGE }));

const NO_THROW = [
  {
    selector: 'ThrowStatement',
    message:
      'Errors are values: return a DomainError as an Err of the errors contract. A native call that can throw is wrapped in try/catch, and its failure is converted and returned.',
  },
];

const pureRules = (patterns, syntax = []) => ({
  ...importRule(patterns),
  'no-restricted-syntax': ['error', ...syntax, ...CLOCK, ...NO_THROW],
  'no-restricted-globals': ['error', ...IO_GLOBALS],
});

// ---- the entries ----------------------------------------------------------------------------

const PEER = { regex: '^\\.{1,2}(?:/|$)', message: 'A module imports contracts only: it has no peer, so data comes in as arguments.' };
const SIBLING = { regex: '^\\.(?:/|$)', message: 'A sub-coordinator never calls another coordinator: it returns intents or outcomes.' };
const COORDINATOR_LAYER = {
  regex: '^\\.\\./(?:coordinators|gateways)(?:/|$)',
  message: 'A sub-coordinator imports modules and contracts only. The top coordinator hands it gateways through ctx.',
};
const GATEWAY_LAYER = {
  regex: '^(?:\\.\\./)+(?:modules|coordinators)(?:/|$)',
  message: 'A gateway holds no business logic: it imports contracts and IO libraries, never a module or a coordinator.',
};
const OTHER_GATEWAY = {
  regex: '(?:^|/)\\w+Gateway$',
  message: 'A gateway never imports another gateway.',
};

const appRules = apps.map((app) => ({
  name: `guards/app-imports/${app.name}`,
  files: [`${app.dir}/src/**/*.{ts,tsx}`],
  ignores: TESTS,
  rules: {
    ...importRule([
      {
        regex: anyOf(WORKSPACES.filter((other) => other.name !== app.name && other.name !== app.uses).map((other) => other.name)),
        message: `An app imports its own package only: ${app.name} uses ${app.uses}, never a contract and never the other app.`,
      },
    ]),
    'no-restricted-syntax': ['error', ...NO_THROW],
  },
}));

export const guardRails = [
  {
    name: 'guards/size',
    files: ['**/src/**/*.{ts,tsx}'],
    ignores: TESTS,
    rules: { 'max-lines': ['error', { max: 1000, skipBlankLines: true, skipComments: true }] },
  },
  {
    name: 'guards/no-app-imports-below-apps',
    files: ['packages/*/src/**/*.{ts,tsx}', 'contracts/*/src/**/*.{ts,tsx}'],
    ignores: TESTS,
    rules: importRule([NO_APP_IMPORTS]),
  },
  {
    name: 'guards/contracts',
    files: ['contracts/*/src/**/*.{ts,tsx}'],
    ignores: TESTS,
    rules: pureRules([...IO_IMPORTS, NO_APP_IMPORTS], NO_BEHAVIOUR),
  },
  {
    name: 'guards/modules',
    files: ['packages/*/src/modules/**/*.{ts,tsx}'],
    ignores: TESTS,
    rules: pureRules([PEER, ...IO_IMPORTS, NO_APP_IMPORTS]),
  },
  {
    name: 'guards/sub-coordinators',
    files: ['packages/*/src/coordinators/**/*.{ts,tsx}'],
    ignores: [...TESTS, ...TOP_COORDINATORS],
    rules: pureRules([SIBLING, COORDINATOR_LAYER, NO_TESTING_IMPORTS, ...IO_IMPORTS, NO_APP_IMPORTS]),
  },
  {
    name: 'guards/top-coordinators',
    files: TOP_COORDINATORS,
    ignores: TESTS,
    rules: pureRules([NO_TESTING_IMPORTS, ...IO_IMPORTS, NO_APP_IMPORTS]),
  },
  {
    name: 'guards/coordinator-functions',
    files: ['packages/*/src/coordinators/**/*.{ts,tsx}'],
    ignores: TESTS,
    rules: { 'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }] },
  },
  {
    name: 'guards/gateways',
    files: ['packages/*/src/gateways/**/*.{ts,tsx}'],
    ignores: TESTS,
    rules: {
      ...importRule([GATEWAY_LAYER, OTHER_GATEWAY, NO_TESTING_IMPORTS, NO_APP_IMPORTS]),
      // a gateway is where a native call can throw, so it is where the failure is caught and converted
      'no-restricted-syntax': ['error', ...NO_THROW],
    },
  },
  {
    name: 'guards/memory-gateways',
    files: ['packages/*/src/gateways/memory/**/*.{ts,tsx}'],
    ignores: TESTS,
    rules: importRule([
      GATEWAY_LAYER,
      OTHER_GATEWAY,
      { regex: '^\\./', message: 'A gateway never imports another gateway.' },
      NO_TESTING_IMPORTS,
      NO_APP_IMPORTS,
    ]),
  },
  ...appRules,
];
