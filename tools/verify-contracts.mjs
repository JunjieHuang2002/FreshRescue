#!/usr/bin/env node
// Checks the nine contract packages (plan, phase 2):
//
//   node tools/verify-contracts.mjs
//
// For each package in CONTRACT_FILES (tools/architecture.mjs) it checks that
//   1. src/ holds exactly the expected files: the source files, the barrel index.ts and the test
//      file <package>.test.ts, with nothing missing and nothing extra
//   2. each source file exports something, so a placeholder is not mistaken for a finished file
//   3. the barrel index.ts re-exports every source file, in alphabetical order, with one
//      `export * from './<file>'` line each and nothing else
//
// Prints `contracts OK: ...` and exits 0, or one line per problem and `contracts FAILED: N
// problem(s)` and exits 1.
import ts from 'typescript';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_FILES } from './architecture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const problems = [];
const problem = (where, message) => problems.push(`${where}: ${message}`);

function parse(path) {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}

/** True when the file exports at least one declaration, re-export or export list. */
function exportsSomething(path) {
  return parse(path).statements.some((node) => {
    if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) return !(ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length === 0);
    return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  });
}

/** The files that the barrel re-exports, in order, and a problem for every line that is anything else. */
function reexportsOf(path, where) {
  const files = [];
  for (const node of parse(path).statements) {
    const isStar =
      ts.isExportDeclaration(node) &&
      !node.exportClause &&
      !node.isTypeOnly &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      /^\.\/[a-z0-9-]+$/.test(node.moduleSpecifier.text);
    if (isStar) files.push(node.moduleSpecifier.text.slice(2));
    else problem(where, `has a statement that is not an \`export * from './<file>'\` line: ${node.getText().split('\n')[0]}`);
  }
  return files;
}

let sourceCount = 0;
for (const [name, files] of Object.entries(CONTRACT_FILES)) {
  const folder = `contracts/${name}/src`;
  const directory = join(root, folder);
  const expected = [...files.map((file) => `${file}.ts`), 'index.ts', `${name}.test.ts`];
  const found = existsSync(directory) ? readdirSync(directory).filter((entry) => !entry.startsWith('.')) : [];

  for (const file of expected) if (!found.includes(file)) problem(folder, `missing ${file}`);
  for (const file of found) if (!expected.includes(file)) problem(folder, `unexpected ${file}`);

  for (const file of files) {
    sourceCount += 1;
    const path = join(directory, `${file}.ts`);
    if (existsSync(path) && !exportsSomething(path)) problem(folder, `${file}.ts exports nothing`);
  }

  const barrel = join(directory, 'index.ts');
  if (!existsSync(barrel)) continue;
  const reexported = reexportsOf(barrel, `${folder}/index.ts`);
  for (const file of files) if (!reexported.includes(file)) problem(`${folder}/index.ts`, `does not re-export ./${file}`);
  for (const file of reexported) if (!files.includes(file)) problem(`${folder}/index.ts`, `re-exports ./${file}, which is not a source file of ${name}`);
  if (new Set(reexported).size !== reexported.length) problem(`${folder}/index.ts`, 're-exports a file twice');
  if (reexported.join() !== [...reexported].sort().join()) problem(`${folder}/index.ts`, 'does not list its files in alphabetical order');
}

if (problems.length > 0) {
  for (const line of problems) console.error(line);
  console.error(`contracts FAILED: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(
  `contracts OK: ${Object.keys(CONTRACT_FILES).length} packages, ${sourceCount} source files, ` +
    'each re-exported by its barrel and covered by a test file',
);
