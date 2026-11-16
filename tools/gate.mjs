#!/usr/bin/env node
// The exit gate:  npm run gate -- N
//
// Runs every check of phases 0 to N, in the order of tools/gates.json, and stops at the
// first one that fails. Because the gate is cumulative, later work cannot quietly break
// earlier work. On success it prints `Gate N: passed (M checks).`
//
// tools/gates.json is an array. Each entry is one check:
//   phase           the phase that introduced the check (0 to 11)
//   name            what the check proves
//   command         a shell command, run from the repository root; exit code 0 means pass
//   expect          optional list of texts that the command's output must also contain
//   timeoutSeconds  optional, default 900
// Entries stay in the order of their phase, so the file reads as the plan does.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAST_PHASE = 11;
const TAIL_LINES = 60;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function stop(message) {
  console.error(message);
  process.exit(1);
}

const argument = process.argv[2];
if (argument === undefined || !/^\d+$/.test(argument) || Number(argument) > LAST_PHASE) {
  stop(`usage: npm run gate -- N    (N is a phase number from 0 to ${LAST_PHASE})`);
}
const phase = Number(argument);

let entries;
try {
  entries = JSON.parse(readFileSync(resolve(root, 'tools/gates.json'), 'utf8'));
} catch (error) {
  stop(`cannot read tools/gates.json: ${error.message}`);
}
if (!Array.isArray(entries)) stop('tools/gates.json must be an array of checks');
for (const [index, entry] of entries.entries()) {
  const valid =
    Number.isInteger(entry?.phase) && typeof entry.name === 'string' && typeof entry.command === 'string';
  if (!valid) stop(`tools/gates.json entry ${index} needs a numeric phase, a name and a command`);
}

const due = entries.filter((entry) => entry.phase <= phase);
if (due.length === 0) stop(`tools/gates.json has no check for phase ${phase} or earlier`);

// Plain text, so that `expect` can match the output.
const env = { ...process.env, NO_COLOR: '1' };
delete env.FORCE_COLOR;

for (const [index, check] of due.entries()) {
  const position = `${index + 1}/${due.length}`;
  console.log(`[${position}] phase ${check.phase}: ${check.name}`);
  console.log(`      $ ${check.command}`);

  const started = Date.now();
  const run = spawnSync(check.command, {
    cwd: root,
    env,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: (check.timeoutSeconds ?? 900) * 1000,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const missing = (check.expect ?? []).filter((text) => !output.includes(text));
  if (run.status === 0 && missing.length === 0) {
    console.log(`      ok (${seconds}s)`);
    continue;
  }

  let reason;
  if (run.error?.code === 'ETIMEDOUT') reason = `timed out after ${check.timeoutSeconds ?? 900}s`;
  else if (run.status !== 0) reason = `exit code ${run.status ?? run.signal}`;
  else reason = `output lacks ${missing.map((text) => JSON.stringify(text)).join(', ')}`;

  const lines = output.trimEnd().split('\n');
  const shown = lines.slice(-TAIL_LINES);
  console.error(`      FAILED (${seconds}s): ${reason}`);
  console.error(lines.length > shown.length ? `      ... last ${shown.length} of ${lines.length} lines:` : '      output:');
  for (const line of shown) console.error(`      | ${line}`);
  stop(`Gate ${phase}: FAILED at check ${position}, "${check.name}".`);
}

console.log(`Gate ${phase}: passed (${due.length} checks).`);
