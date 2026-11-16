#!/usr/bin/env node
// Checks the repository against the dependency graph in tools/architecture.mjs.
//
//   node tools/verify-layout.mjs
//
// It compares four things with the graph:
//   1. the workspaces: the 13 packages exist, are named and set up as expected, and nothing else
//      sits beside them
//   2. the folders: every folder of the finished tree exists
//   3. the declared dependencies: a package.json declares no @freshrescue package that its
//      workspace may not use, and no server-side library in a workspace that reaches the browser
//   4. the real imports: every import in the source of a workspace is one that the graph allows
//
// Declared dependencies alone prove nothing: npm links every workspace into the root node_modules,
// so a file can import a package that it never declared. That is why the source is read as well.
// ESLint checks what happens inside a package (eslint.guards.mjs); this checks between packages.
//
// Prints `layout OK: ...` and exits 0, or one line per problem and `layout FAILED: N problem(s)`
// and exits 1.
import ts from 'typescript';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACTS, FOLDERS, SCOPE, SERVER_ONLY_LIBRARIES, WORKSPACES, allowedImports } from './architecture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const SOURCE_FOLDERS = ['src', 'test'];
const NOT_SOURCE = new Set(['node_modules', '.next', 'dist', 'coverage']);
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
// Test support code may use the development tools that the root package.json declares for everyone.
const TEST_SUPPORT_FOLDER = /(?:^|\/)(?:testing|conformance)\//;

const problems = [];
const problem = (where, message) => problems.push(`${where}: ${message}`);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(root, path), 'utf8'));
  } catch (error) {
    problem(path, `cannot be read as JSON (${error.message})`);
    return null;
  }
}

const isDirectory = (path) => existsSync(path) && statSync(path).isDirectory();
const declaredNames = (manifest) => new Set(DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})));
const sorted = (values) => [...values].sort();

// ---- 1. the workspaces -----------------------------------------------------------------------

const rootManifest = readJson('package.json') ?? {};

function checkRoot() {
  const globs = ['contracts/*', 'packages/*', 'apps/*'];
  if (JSON.stringify(rootManifest.workspaces) !== JSON.stringify(globs)) {
    problem('package.json', `workspaces must be ${JSON.stringify(globs)}`);
  }
  if (rootManifest.private !== true) problem('package.json', 'must be private');

  for (const parent of ['contracts', 'packages', 'apps']) {
    const expected = new Set(WORKSPACES.filter((w) => w.dir.startsWith(`${parent}/`)).map((w) => w.dir.split('/')[1]));
    if (!isDirectory(join(root, parent))) continue;
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !expected.has(entry.name)) {
        problem(`${parent}/${entry.name}`, `is not a workspace of the graph (expected: ${sorted(expected).join(', ')})`);
      }
    }
  }
}

function checkWorkspace(workspace) {
  const { dir, name, kind } = workspace;
  if (!isDirectory(join(root, dir))) {
    problem(dir, 'missing workspace folder');
    return null;
  }
  const manifest = readJson(`${dir}/package.json`);
  if (!manifest) return null;

  if (manifest.name !== name) problem(`${dir}/package.json`, `name is ${manifest.name}, expected ${name}`);
  if (manifest.private !== true) problem(`${dir}/package.json`, 'must be private');
  if (manifest.type !== 'module') problem(`${dir}/package.json`, 'type must be module');
  if (kind !== 'app' && manifest.exports?.['.'] !== './src/index.ts') {
    problem(`${dir}/package.json`, 'exports "." must point at ./src/index.ts');
  }
  if (!manifest.scripts?.typecheck) problem(`${dir}/package.json`, 'has no typecheck script, so `npm run typecheck` skips it');

  const tsconfig = readJson(`${dir}/tsconfig.json`);
  if (tsconfig && tsconfig.extends !== '../../tsconfig.base.json') {
    problem(`${dir}/tsconfig.json`, 'must extend ../../tsconfig.base.json');
  }
  if (kind === 'contract' && !existsSync(join(root, dir, 'src/index.ts'))) problem(dir, 'missing src/index.ts');
  return manifest;
}

// ---- 2. the folders --------------------------------------------------------------------------

function checkFolders() {
  let count = 0;
  for (const [workspaceDir, folders] of Object.entries(FOLDERS)) {
    for (const folder of folders) {
      count += 1;
      if (!isDirectory(join(root, workspaceDir, folder))) problem(workspaceDir, `missing folder ${folder}`);
    }
  }
  return count;
}

// ---- 3. the declared dependencies ------------------------------------------------------------

const reachesBrowser = (workspace) =>
  (workspace.kind === 'contract' ? CONTRACTS[workspace.contract].side : workspace.side) !== 'backend';

function checkDeclared(workspace, manifest) {
  const allowed = new Set(allowedImports(workspace));
  for (const name of declaredNames(manifest)) {
    if (name.startsWith(`${SCOPE}/`) && !allowed.has(name)) {
      problem(`${workspace.dir}/package.json`, `declares ${name}, which ${workspace.name} may not use`);
    }
    if (reachesBrowser(workspace) && SERVER_ONLY_LIBRARIES.includes(name)) {
      problem(`${workspace.dir}/package.json`, `declares ${name}, a server-side library that must not reach the browser`);
    }
  }
}

// ---- 4. the real imports ---------------------------------------------------------------------

function sourceFiles(directory) {
  if (!isDirectory(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return NOT_SOURCE.has(entry.name) ? [] : sourceFiles(path);
    return SOURCE_FILE.test(entry.name) && !DECLARATION_FILE.test(entry.name) ? [path] : [];
  });
}

/** Every module specifier a file imports, re-exports or requires, read with TypeScript's parser. */
function importsOf(file) {
  const specifiers = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) {
        specifiers.push(node.arguments[0].text);
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      specifiers.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true));
  return specifiers;
}

const packageOf = (specifier) => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
const isBuiltin = (specifier) => specifier.startsWith('node:') || builtinModules.includes(specifier);

function checkImports(workspace, manifest) {
  const allowed = new Set(allowedImports(workspace));
  const declared = declaredNames(manifest);
  const sharedTools = new Set(Object.keys(rootManifest.devDependencies ?? {}));
  const files = SOURCE_FOLDERS.flatMap((folder) => sourceFiles(join(root, workspace.dir, folder)));

  for (const file of files) {
    const path = relative(root, file);
    const testSupport = TEST_FILE.test(file) || TEST_SUPPORT_FOLDER.test(path);

    for (const specifier of importsOf(file)) {
      if (specifier.startsWith('.')) {
        if (relative(join(root, workspace.dir), resolve(dirname(file), specifier)).startsWith('..')) {
          problem(path, `imports ${specifier}, which leaves ${workspace.dir}`);
        }
        continue;
      }
      if (isBuiltin(specifier)) continue;

      const name = packageOf(specifier);
      if (name.startsWith(`${SCOPE}/`)) {
        if (!WORKSPACES.some((other) => other.name === name)) problem(path, `imports ${name}, which is not a workspace`);
        else if (specifier !== name) problem(path, `imports ${specifier} by a deep path: import ${name} only`);
        else if (name === workspace.name) problem(path, `imports ${name}, which is the workspace itself`);
        else if (!allowed.has(name)) problem(path, `imports ${name}, which ${workspace.name} may not use`);
        else if (!declared.has(name)) problem(path, `imports ${name} without declaring it in ${workspace.dir}/package.json`);
      } else if (reachesBrowser(workspace) && SERVER_ONLY_LIBRARIES.includes(name)) {
        problem(path, `imports ${name}, a server-side library that must not reach the browser`);
      } else if (!declared.has(name) && !(testSupport && sharedTools.has(name))) {
        problem(path, `imports ${name}, which ${workspace.dir}/package.json does not declare`);
      }
    }
  }
  return files.length;
}

// ---- the web app's transpile list ------------------------------------------------------------

function checkTranspileList() {
  const path = 'apps/web/next.config.ts';
  if (!existsSync(join(root, path))) {
    problem(path, 'missing');
    return;
  }
  const list = /transpilePackages\s*:\s*\[([^\]]*)\]/.exec(readFileSync(join(root, path), 'utf8'));
  if (!list) {
    problem(path, 'has no transpilePackages list');
    return;
  }
  const listed = new Set([...list[1].matchAll(/(['"])(.+?)\1/g)].map((match) => match[2]));
  const frontend = WORKSPACES.find((workspace) => workspace.dir === 'packages/frontend');
  const wanted = new Set([frontend.name, ...allowedImports(frontend)]);
  for (const name of sorted(wanted)) if (!listed.has(name)) problem(path, `transpilePackages lacks ${name}, which the browser bundle uses`);
  for (const name of sorted(listed)) {
    if (!wanted.has(name)) problem(path, `transpilePackages lists ${name}, which the browser bundle does not use`);
  }
}

// ---- main ------------------------------------------------------------------------------------

checkRoot();
let sourceCount = 0;
for (const workspace of WORKSPACES) {
  const manifest = checkWorkspace(workspace);
  if (!manifest) continue;
  checkDeclared(workspace, manifest);
  sourceCount += checkImports(workspace, manifest);
}
const folderCount = checkFolders();
checkTranspileList();

if (problems.length > 0) {
  for (const line of problems) console.error(line);
  console.error(`layout FAILED: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(
  `layout OK: ${WORKSPACES.length} workspaces, ${folderCount} folders, ` +
    `${sourceCount} source files import only what the graph allows`,
);
