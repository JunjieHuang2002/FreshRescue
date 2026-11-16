#!/usr/bin/env node
// Checks tools/manifest.txt, the list of every module, gateway and coordinator of the blueprint.
//
//   node tools/verify-manifest.mjs N        (N is a phase number from 0 to 11)
//
// Each of the 94 lines holds four fields: the blueprint ID, the file, the phase that builds it, and
// the error codes its test must mention (`-` for none). The check has two parts:
//   1. The list itself is complete and consistent: 94 well-formed entries, 75 modules, 8 gateways and
//      11 coordinators, each in the phase and the folder that the plan's appendix gives it.
//   2. Everything due by phase N (its phase is N or earlier) is built (the file exists), exported (the
//      file exports its one function) and tested (a test beside it mentions every listed error code).
//      A module exports one function named like its file. A gateway or a coordinator exports
//      `create<UpperCamelName>`. A code that appears only in a comment is not a mention.
//
// Prints `manifest OK: ...` and exits 0, or one line per problem and `manifest FAILED: N problem(s)`
// and exits 1.
import ts from 'typescript';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAST_PHASE = 11;

// The plan's appendix, "which phase builds what": the IDs built by each phase.
const PHASE_IDS = {
  3: ['BP-01..04', 'BS-01', 'BC-01..08'],
  4: ['BC-09..19', 'BC-36..44'],
  5: ['BC-20..35'],
  6: ['BX-01..05'],
  7: ['BG-01..05'],
  8: ['FP-01..02', 'FC-01..02', 'FS-01..06', 'FU-01..16'],
  9: ['FX-06..11', 'FG-01..03'],
};

const KIND_OF_PREFIX = {
  BP: 'module', BS: 'module', BC: 'module', FP: 'module', FC: 'module', FS: 'module', FU: 'module',
  BG: 'gateway', FG: 'gateway',
  BX: 'coordinator', FX: 'coordinator',
};
const SIDE_OF_LETTER = { B: 'backend', F: 'frontend' };
const MODULE_GROUPS = {
  backend: ['decide', 'derive', 'engine', 'foundation', 'parsing', 'state'],
  frontend: ['computation', 'parsing', 'slices', 'views'],
};
// The phase that builds each folder, which must agree with the phase written on each line.
const FOLDER_PHASE = {
  'backend/modules/parsing': 3, 'backend/modules/state': 3, 'backend/modules/foundation': 3,
  'backend/modules/derive': 4, 'backend/modules/engine': 4, 'backend/modules/decide': 5,
  'backend/coordinators': 6, 'backend/gateways': 7,
  'frontend/modules': 8, 'frontend/coordinators': 9, 'frontend/gateways': 9,
};

const problems = [];
const problem = (where, message) => problems.push(`${where}: ${message}`);

function expandRange(text) {
  const range = /^([A-Z]{2})-(\d{2})\.\.(\d{2})$/.exec(text);
  if (!range) return [text];
  const [, prefix, from, to] = range;
  const ids = [];
  for (let n = Number(from); n <= Number(to); n += 1) ids.push(`${prefix}-${String(n).padStart(2, '0')}`);
  return ids;
}

// ---- the list --------------------------------------------------------------------------------

function parseManifest() {
  const entries = [];
  const lines = readFileSync(join(root, 'tools/manifest.txt'), 'utf8').split('\n');
  for (const [index, raw] of lines.entries()) {
    const text = raw.trim();
    if (text === '' || text.startsWith('#')) continue;
    const where = `tools/manifest.txt:${index + 1}`;
    const fields = text.split(/\s+/);
    if (fields.length !== 4) {
      problem(where, `expected 4 fields (ID, file, phase, codes), found ${fields.length}`);
      continue;
    }
    const [id, file, phaseText, codeText] = fields;
    const prefix = id.slice(0, 2);
    const kind = KIND_OF_PREFIX[prefix];
    if (!kind || !/^[A-Z]{2}-\d{2}$/.test(id)) {
      problem(where, `${id} is not a blueprint ID`);
      continue;
    }
    const side = SIDE_OF_LETTER[id[0]];
    const base = basename(file, '.ts');
    const entry = {
      id,
      file,
      kind,
      side,
      base,
      name: base.charAt(0).toUpperCase() + base.slice(1),
      phase: Number(phaseText),
      codes: codeText === '-' ? [] : codeText.split(','),
    };
    checkEntry(entry, where);
    entries.push(entry);
  }
  return entries;
}

function checkEntry(entry, where) {
  const { id, file, kind, side, base, phase, codes } = entry;
  if (!Number.isInteger(phase) || phase < 3 || phase > 9) {
    problem(where, `${id} has phase ${phase}: only phases 3 to 9 build entries`);
  }
  for (const code of codes) {
    if (!/^[A-Z][A-Z_]*[A-Z]$/.test(code)) problem(where, `${id} lists ${code}, which is not an error code`);
  }
  if (new Set(codes).size !== codes.length) problem(where, `${id} lists an error code twice`);

  const place = /^packages\/(backend|frontend)\/src\/(modules\/[a-z]+|gateways|coordinators)\/[A-Za-z]+\.ts$/.exec(file);
  if (!place) {
    problem(where, `${id}: ${file} is not packages/<side>/src/<modules/group|gateways|coordinators>/<Name>.ts`);
    return;
  }
  const folder = place[2];
  if (place[1] !== side) problem(where, `${id} belongs to the ${side}, but ${file} is in packages/${place[1]}`);
  const expectedFolder = kind === 'module' ? 'modules/' : kind === 'gateway' ? 'gateways' : 'coordinators';
  if (!folder.startsWith(expectedFolder)) problem(where, `${id} is a ${kind}, but ${file} is in ${folder}`);
  if (kind === 'module' && folder.startsWith('modules/') && !MODULE_GROUPS[side].includes(folder.slice('modules/'.length))) {
    problem(where, `${id}: ${folder} is not a module group of the ${side}`);
  }
  const lowerFirst = base.charAt(0) === base.charAt(0).toLowerCase();
  if (kind === 'coordinator' ? lowerFirst : !lowerFirst) {
    problem(where, `${id}: ${base} must be ${kind === 'coordinator' ? 'UpperCamelCase' : 'lowerCamelCase'}`);
  }
  const folderPhase = FOLDER_PHASE[`${side}/${folder}`] ?? FOLDER_PHASE[`${side}/modules`];
  if (folderPhase !== undefined && folderPhase !== phase) {
    problem(where, `${id} is in ${folder}, which phase ${folderPhase} builds, but its line says phase ${phase}`);
  }
}

function checkList(entries) {
  const seen = { id: new Set(), file: new Set() };
  for (const { id, file } of entries) {
    if (seen.id.has(id)) problem('tools/manifest.txt', `${id} appears twice`);
    if (seen.file.has(file)) problem('tools/manifest.txt', `${file} appears twice`);
    seen.id.add(id);
    seen.file.add(file);
  }
  const phaseOf = new Map(entries.map((entry) => [entry.id, entry.phase]));
  for (const [phase, ranges] of Object.entries(PHASE_IDS)) {
    for (const id of ranges.flatMap(expandRange)) {
      if (!phaseOf.has(id)) problem('tools/manifest.txt', `${id} is missing: the plan builds it in phase ${phase}`);
      else if (phaseOf.get(id) !== Number(phase)) {
        problem('tools/manifest.txt', `${id} is in phase ${phaseOf.get(id)}, but the plan builds it in phase ${phase}`);
      }
    }
  }
  const expected = new Set(Object.values(PHASE_IDS).flat().flatMap(expandRange));
  for (const { id } of entries) {
    if (!expected.has(id)) problem('tools/manifest.txt', `${id} is not an entry of the plan's appendix`);
  }
  const count = (kind) => entries.filter((entry) => entry.kind === kind).length;
  const wanted = { module: 75, gateway: 8, coordinator: 11 };
  if (entries.length !== 94) problem('tools/manifest.txt', `${entries.length} entries, expected 94`);
  for (const [kind, n] of Object.entries(wanted)) {
    if (count(kind) !== n) problem('tools/manifest.txt', `${count(kind)} ${kind}s, expected ${n}`);
  }
  return { modules: count('module'), gateways: count('gateway'), coordinators: count('coordinator') };
}

// ---- what is due -----------------------------------------------------------------------------

function parse(file) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

const isFunctionValue = (node) => node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
const hasExport = (node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** The exported values of a file, and which of them are functions. */
function exportsOf(file) {
  const exported = new Set();
  const functions = new Set();
  const localFunctions = new Set();
  const lists = [];
  for (const node of parse(file).statements) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      localFunctions.add(node.name.text);
      if (hasExport(node)) {
        exported.add(node.name.text);
        functions.add(node.name.text);
      }
    } else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const name = declaration.name.text;
        if (isFunctionValue(declaration.initializer)) localFunctions.add(name);
        if (!hasExport(node)) continue;
        exported.add(name);
        if (isFunctionValue(declaration.initializer)) functions.add(name);
      }
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        if (!element.isTypeOnly) lists.push({ name: element.name.text, local: (element.propertyName ?? element.name).text });
      }
    } else if (ts.isExportAssignment(node)) {
      exported.add('default');
    }
  }
  for (const { name, local } of lists) {
    exported.add(name);
    if (localFunctions.has(local)) functions.add(name);
  }
  return { exported, functions };
}

/** Everything a test writes as code: identifiers and string contents, never a comment. */
function codeTextOf(file) {
  const parts = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      parts.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return parts.join('\n');
}

function checkDue(entry) {
  const { id, name, file, kind, base, codes } = entry;
  const label = `${id} ${name}`;
  const absolute = join(root, file);
  if (!existsSync(absolute)) {
    problem(label, `missing ${file}`);
    return;
  }

  const wanted = kind === 'module' ? base : `create${name}`;
  const { exported, functions } = exportsOf(absolute);
  if (!exported.has(wanted)) problem(label, `${file} does not export ${wanted}`);
  const extra = [...functions].filter((fn) => fn !== wanted);
  if (kind === 'module' && extra.length > 0) {
    problem(label, `${file} exports ${extra.join(', ')} besides ${wanted}: a module is one function`);
  }

  const folder = dirname(absolute);
  const testName = new RegExp(`^${base}\\.(?:dom\\.|db\\.|e2e\\.)?test\\.tsx?$`);
  const tests = readdirSync(folder).filter((entryName) => testName.test(entryName));
  if (tests.length === 0) {
    problem(label, `no test beside ${file} (expected ${base}.test.ts)`);
    return;
  }
  const written = tests.map((test) => codeTextOf(join(folder, test)));
  for (const code of codes) {
    const mention = new RegExp(`\\b${code}\\b`);
    if (!written.some((text) => mention.test(text))) problem(label, `no test mentions ${code}`);
  }
}

// ---- main ------------------------------------------------------------------------------------

const argument = process.argv[2];
if (argument === undefined || !/^\d+$/.test(argument) || Number(argument) > LAST_PHASE) {
  console.error(`usage: node tools/verify-manifest.mjs N    (N is a phase number from 0 to ${LAST_PHASE})`);
  process.exit(2);
}
const phase = Number(argument);

const entries = parseManifest();
const counts = checkList(entries);
const due = entries.filter((entry) => entry.phase <= phase);
for (const entry of due) checkDue(entry);

if (problems.length > 0) {
  for (const line of problems) console.error(line);
  console.error(`manifest FAILED: ${problems.length} problem(s)`);
  process.exit(1);
}

const suffix = due.length > 0 ? ', each built, exported and tested for every listed error code' : '';
console.log(
  `manifest OK: ${entries.length} entries (${counts.modules} modules, ${counts.gateways} gateways, ` +
    `${counts.coordinators} coordinators); ${due.length} due by phase ${phase}${suffix}`,
);
