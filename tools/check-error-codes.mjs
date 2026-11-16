#!/usr/bin/env node
// Every error code is seen end to end, or explained (plan, phase 10, row 4).
//
//   node tools/check-error-codes.mjs
//
// Reads the codes of the `errors` contract: the keys of ERROR_FAMILY_OF in contracts/errors/src/codes.ts,
// the one table that the 58-code catalog is written in. Each code passes in one of two ways:
//   seen       some end-to-end test expects it. Inside a test (the function that an `it` or `test` call
//              is given) of a `*.e2e.test.ts` file, the code is written in a string or as an identifier.
//              A comment is not a mention, and neither is a title, a helper or a table outside the tests,
//              so deleting the only test that expects a code takes the code out of the seen ones. This is
//              how verify-manifest.mjs reads a test, limited to the tests themselves.
//   explained  EXPLAINED below gives it a one-line reason why no end-to-end test can expect it.
// The check fails on a code that is neither, on an explained code that a test does expect (the
// explanation has gone stale), and on an explanation of a code that the catalog does not have.
//
// Prints `error codes OK: 58 codes (N seen end to end, M explained)` and exits 0, or one line per
// problem and `error codes FAILED: N problem(s)` and exits 1.
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CATALOG_FILE = 'contracts/errors/src/codes.ts';
const CATALOG_TABLE = 'ERROR_FAMILY_OF';
const E2E_TEST_FILE = /\.e2e\.test\.[cm]?[jt]sx?$/;
const NOT_SOURCE = new Set(['node_modules', 'dist', 'coverage']);
const TEST_CALLS = new Set(['it', 'test']);

// Why no end-to-end test can expect these codes: each one is produced by the test beside the module or
// gateway that raises it (tools/manifest.txt lists them, and verify-manifest.mjs checks it).
const SEED_FAULT = 'the seed is the fixed file packages/backend/seed/freshrescue.seed.json, and a fault in it stops the first start before any request is served (blueprint 2.3); SeedBundleParser tests it';
const EXPLAINED = {
  // shape
  CORRUPT_STORE: 'the MySQL read gateway builds the store document itself and hands over an object or null, so SnapshotParser never meets a document that is not an object; SnapshotParser tests it',
  BAD_SEED: SEED_FAULT,
  DUP_SEED_KEY: SEED_FAULT,
  SEED_BAD_CATEGORY: SEED_FAULT,
  SEED_BAD_FOODTYPE: SEED_FAULT,
  // rules: the guards of the write path, which only an inconsistent snapshot or a faulty decider can fire
  CONFLICTING_OPS: 'a guard: no decider puts two operations on one record, and the schema keeps a recipe from naming a Food Type twice, so a cook never takes from one batch twice; ChangeSetApplier tests it',
  UNKNOWN_TARGET: 'a guard: every decider finds its record first (the *_NOT_FOUND codes), so nothing deletes a record that is not there; ChangeSetApplier tests it',
  INSUFFICIENT_STOCK: 'a guard: FEFO and the recipe match read the same batch views, so a row that the match finds fulfilled always has its stock; FefoAllocator tests it',
  // io
  STORE_UNAVAILABLE: 'needs MySQL to fail under a running API, and the end-to-end tests share the one MySQL server with everything else; StoreReadGateway tests it',
  STORE_WRITE_FAILED: 'every value is validated and the new snapshot passes the invariant checker before it is written, so only a failing MySQL refuses a write; StoreWriteGateway tests it',
  SEED_UNREADABLE: 'the seed file is read only by the first start of an empty store, which stops if it cannot be read, before any request is served; SeedSourceGateway tests it',
  TIMEOUT: 'needs a server that takes a request and never answers, and the API answers every request; ApiGateway tests it with a fetch that never settles',
  BAD_JSON: 'the API answers every request with JSON, so a success status with a body that is not JSON can only come from something between the page and the API; ApiResponseParser tests it',
  HTTP_STATUS: 'the journeys talk to the API itself, which answers both routes with an ApiResponse, so only a proxy error page or a URL that is not a route gives one; ApiResponseParser tests it',
  BAD_RESPONSE: 'the API sends only the envelopes of the messages contract, so a reply of another shape cannot come from it; ApiResponseParser tests it',
  SLOT_NOT_FOUND: 'the page always renders all 16 slots (tools/smoke-dev.mjs checks them), so only a broken page lacks one; DomHostGateway tests it',
  // form
  DATE_FORMAT: 'both date fields are date inputs, which hand over a real YYYY-MM-DD date or nothing, so no person can enter a malformed date; FormSchemaParser tests it',
  CHOICE_UNKNOWN: 'a drop-down offers only its own entries, so no person can choose one that is not in its list; FormSchemaParser tests it',
};

const problems = [];
const problem = (where, message) => problems.push(`${where}: ${message}`);

const parse = (file) => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);

/** The keys of the catalog table, in the order they are written, or null when the table cannot be found. */
function catalogCodes() {
  for (const statement of parse(join(root, CATALOG_FILE)).statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== CATALOG_TABLE) continue;
      // `{ ... } as const satisfies Record<string, ErrorFamily>`
      let table = declaration.initializer;
      while (table !== undefined && (ts.isAsExpression(table) || ts.isSatisfiesExpression(table) || ts.isParenthesizedExpression(table))) {
        table = table.expression;
      }
      if (table === undefined || !ts.isObjectLiteralExpression(table)) return null;
      const names = table.properties.map((property) =>
        ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : null,
      );
      return names.includes(null) ? null : names;
    }
  }
  return null;
}

/** Every `*.e2e.test.ts` file of the repository, outside dependencies, build output and hidden folders. */
function e2eTestFiles(directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return NOT_SOURCE.has(entry.name) || entry.name.startsWith('.') ? [] : e2eTestFiles(path);
    return E2E_TEST_FILE.test(entry.name) ? [path] : [];
  });
}

/** The codes that the tests of a file write: in strings and identifiers inside the function of each `it` or `test` call, not in its title. */
function codesExpectedIn(file, mentions) {
  const found = new Set();
  const collect = (node) => {
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      for (const [code, mention] of mentions) if (mention.test(node.text)) found.add(code);
    }
    ts.forEachChild(node, collect);
  };
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TEST_CALLS.has(node.expression.text)) {
      for (const argument of node.arguments.slice(1)) collect(argument);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return found;
}

// ---- main ------------------------------------------------------------------------------------

const codes = catalogCodes();
if (codes === null) {
  console.error(`${CATALOG_FILE}: cannot read the codes of ${CATALOG_TABLE}, an object literal with one plain key per code`);
  console.error('error codes FAILED: 1 problem(s)');
  process.exit(1);
}

const mentions = new Map(codes.map((code) => [code, new RegExp(`\\b${code}\\b`)]));
const files = e2eTestFiles();
/** code -> the e2e test files whose tests expect it */
const seenIn = new Map();
for (const file of files) {
  for (const code of codesExpectedIn(file, mentions)) seenIn.set(code, [...(seenIn.get(code) ?? []), relative(root, file)]);
}

if (files.length === 0) problem('*.e2e.test.ts', 'no end-to-end test file was found');
for (const code of codes) {
  const seen = seenIn.has(code);
  const explained = Object.hasOwn(EXPLAINED, code);
  if (!seen && !explained) problem(code, 'no end-to-end test expects it, and it is not explained');
  if (seen && explained) problem(code, `explained, but ${seenIn.get(code).join(', ')} expects it: the explanation has gone stale`);
}
for (const code of Object.keys(EXPLAINED)) {
  if (!codes.includes(code)) problem(code, `explained, but ${CATALOG_FILE} has no such code`);
}

if (problems.length > 0) {
  for (const line of problems) console.error(line);
  console.error(`error codes FAILED: ${problems.length} problem(s)`);
  process.exit(1);
}

const seenCount = codes.filter((code) => seenIn.has(code)).length;
console.log(`error codes OK: ${codes.length} codes (${seenCount} seen end to end, ${codes.length - seenCount} explained)`);
