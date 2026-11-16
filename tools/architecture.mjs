// The dependency graph of the monorepo, written once as data (plan, phase 1).
//
// Every later tool reads this file: scaffold.mjs builds the layout from it, verify-layout.mjs
// checks the repository against it, and eslint.guards.mjs takes its package names from it.
// The same graph is drawn in docs/FreshRescue_Implementation_Plan.md, "The dependency graph".

export const SCOPE = '@freshrescue';

/**
 * The nine read-only contracts, in layer order.
 *   layer    a contract may import only contracts of a lower layer, which rules out cycles
 *   side     who may see it: both sides, the backend only or the frontend only
 *   imports  the contracts it may import
 */
export const CONTRACTS = {
  errors: { layer: 0, side: 'shared', imports: [] },
  primitives: { layer: 0, side: 'shared', imports: [] },
  rules: { layer: 1, side: 'shared', imports: ['primitives'] },
  entities: { layer: 2, side: 'backend', imports: ['primitives', 'rules'] },
  seed: { layer: 2, side: 'backend', imports: ['primitives', 'rules'] },
  views: { layer: 2, side: 'shared', imports: ['primitives', 'errors', 'rules'] },
  changeset: { layer: 3, side: 'backend', imports: ['primitives', 'rules', 'entities'] },
  messages: { layer: 3, side: 'shared', imports: ['primitives', 'errors', 'rules', 'views'] },
  ui: { layer: 4, side: 'frontend', imports: ['primitives', 'errors', 'rules', 'views', 'messages'] },
};

export function contractPackage(name) {
  return `${SCOPE}/contract-${name}`;
}

/**
 * The source files of each contract (phase 2), without the barrel `index.ts` and the test file
 * `<contract>.test.ts` that every package also has. Kebab-case, in alphabetical order, which is the
 * order of the `export * from './<file>'` lines in the barrel. 46 files in all.
 */
export const CONTRACT_FILES = {
  errors: ['codes', 'domain-error', 'http-status'],
  primitives: ['brand', 'date', 'id', 'quantity', 'result', 'valid'],
  rules: ['limits', 'name-scope', 'status', 'system-ids', 'units'],
  entities: ['food', 'raw-store', 'recipe', 'settings', 'snapshot'],
  seed: ['bundle', 'order', 'parsed'],
  views: [
    'catalog',
    'cook-report',
    'derived',
    'food-type-detail',
    'inventory',
    'recommendations',
    'reference-data',
    'warnings',
  ],
  changeset: ['changeset', 'write-ops'],
  messages: ['commands', 'envelope', 'port', 'queries', 'routes'],
  ui: ['actions', 'ctx', 'events', 'forms', 'intents', 'notice', 'render-tree', 'states', 'tokens'],
};

/**
 * The 13 workspaces: 9 contracts, 2 logic packages and 2 apps.
 *   kind  contract | package | app
 *   side  backend | frontend (a contract has its side in CONTRACTS)
 *   uses  the one package an app may import
 */
export const WORKSPACES = [
  ...Object.keys(CONTRACTS).map((name) => ({
    dir: `contracts/${name}`,
    name: contractPackage(name),
    kind: 'contract',
    contract: name,
  })),
  { dir: 'packages/backend', name: `${SCOPE}/backend`, kind: 'package', side: 'backend' },
  { dir: 'packages/frontend', name: `${SCOPE}/frontend`, kind: 'package', side: 'frontend' },
  { dir: 'apps/api', name: `${SCOPE}/api`, kind: 'app', side: 'backend', uses: `${SCOPE}/backend` },
  { dir: 'apps/web', name: `${SCOPE}/web`, kind: 'app', side: 'frontend', uses: `${SCOPE}/frontend` },
];

/**
 * The @freshrescue packages that a workspace may import.
 *   a contract   the contracts named in CONTRACTS
 *   a package    every contract its side may see: the shared ones and its own
 *   an app       its own package only, never a contract and never the other app
 */
export function allowedImports(workspace) {
  if (workspace.kind === 'contract') return CONTRACTS[workspace.contract].imports.map(contractPackage);
  if (workspace.kind === 'app') return [workspace.uses];
  return Object.entries(CONTRACTS)
    .filter(([, contract]) => contract.side === 'shared' || contract.side === workspace.side)
    .map(([name]) => contractPackage(name));
}

/**
 * The folders that each workspace must contain, from the tree in the plan. A contract needs
 * only its `src`, which verify-layout.mjs checks on its own. Folders that hold no file yet
 * are held by a .gitkeep until the phase that writes the first file.
 */
export const FOLDERS = {
  'apps/api': ['src', 'test'],
  'apps/web': ['src/app', 'src/components'],
  'packages/backend': [
    'seed',
    'src/coordinators',
    'src/gateways',
    'src/gateways/conformance',
    'src/gateways/memory',
    'src/gateways/mysql',
    'src/gateways/mysql/migrations',
    'src/modules/decide',
    'src/modules/derive',
    'src/modules/engine',
    'src/modules/foundation',
    'src/modules/parsing',
    'src/modules/state',
    'src/testing',
  ],
  'packages/frontend': [
    'src/coordinators',
    'src/gateways',
    'src/modules/computation',
    'src/modules/parsing',
    'src/modules/slices',
    'src/modules/views',
    'src/testing',
  ],
};

/**
 * Libraries that exist only on the server. The frontend bundle is built for the browser, so
 * neither workspace of the browser side may declare or import them.
 */
export const SERVER_ONLY_LIBRARIES = ['express', 'mysql2', 'joi'];
