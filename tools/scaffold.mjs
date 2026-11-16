#!/usr/bin/env node
// Builds the repository layout that tools/architecture.mjs describes.
//
//   node tools/scaffold.mjs
//
// It never overwrites a file, so running it twice is safe:
//   1. each contract package that does not exist yet, with a package.json, a tsconfig.json
//      and an empty src/index.ts (phase 2 writes the real barrel)
//   2. in every package.json, the @freshrescue packages that workspace may import, so that
//      the declared dependencies match the graph. Existing fields are left as they are.
//   3. every folder of the finished tree, each held by a .gitkeep until its first real file
//
// A new workspace or dependency needs `npm install` afterwards, so that npm links it.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOLDERS, WORKSPACES, allowedImports } from './architecture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const createdFiles = [];
const createdFolders = [];
const updatedFiles = [];

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeIfMissing(path, content) {
  const absolute = join(root, path);
  if (existsSync(absolute)) return false;
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  createdFiles.push(path);
  return true;
}

function sortedObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
}

// 1. a new contract package
function scaffoldContract(workspace) {
  const dependencies = Object.fromEntries(allowedImports(workspace).map((name) => [name, '*']));
  const manifest = {
    name: workspace.name,
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: { '.': './src/index.ts' },
    scripts: { typecheck: 'tsc --noEmit -p tsconfig.json' },
    ...(Object.keys(dependencies).length > 0 ? { dependencies: sortedObject(dependencies) } : {}),
  };
  writeIfMissing(`${workspace.dir}/package.json`, json(manifest));
  writeIfMissing(
    `${workspace.dir}/tsconfig.json`,
    json({ extends: '../../tsconfig.base.json', include: ['src'] }),
  );
  writeIfMissing(
    `${workspace.dir}/src/index.ts`,
    `// Barrel of ${workspace.name}. Phase 2 replaces this line with one \`export * from './<file>'\`\n// line per source file, in alphabetical order.\nexport {};\n`,
  );
}

// 2. the declared dependencies of an existing package.json
function declareDependencies(workspace) {
  const path = `${workspace.dir}/package.json`;
  const absolute = join(root, path);
  const manifest = JSON.parse(readFileSync(absolute, 'utf8'));
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
  const missing = allowedImports(workspace).filter((name) => !declared.has(name));
  if (missing.length === 0) return;

  const dependencies = { ...(manifest.dependencies ?? {}) };
  for (const name of missing) dependencies[name] = '*';
  manifest.dependencies = sortedObject(dependencies);
  writeFileSync(absolute, json(manifest));
  updatedFiles.push(`${path} (+${missing.length} dependencies)`);
}

// 3. a folder of the finished tree
function scaffoldFolder(path) {
  const absolute = join(root, path);
  const existed = existsSync(absolute);
  if (!existed) {
    mkdirSync(absolute, { recursive: true });
    createdFolders.push(path);
  }
  if (readdirSync(absolute).length === 0) writeIfMissing(`${path}/.gitkeep`, '');
}

for (const workspace of WORKSPACES) {
  if (workspace.kind === 'contract' && !existsSync(join(root, workspace.dir, 'package.json'))) {
    scaffoldContract(workspace);
  }
}
for (const workspace of WORKSPACES) declareDependencies(workspace);
for (const [workspaceDir, folders] of Object.entries(FOLDERS)) {
  for (const folder of folders) scaffoldFolder(`${workspaceDir}/${folder}`);
}

for (const path of createdFiles) console.log(`  created  ${path}`);
for (const path of updatedFiles) console.log(`  updated  ${path}`);

if (createdFiles.length + createdFolders.length + updatedFiles.length === 0) {
  console.log('scaffold: nothing to do');
} else {
  console.log(
    `scaffold: ${createdFiles.length} files and ${createdFolders.length} folders created, ` +
      `${updatedFiles.length} package.json files updated`,
  );
  console.log('Run `npm install` so that npm links the new workspaces.');
}
