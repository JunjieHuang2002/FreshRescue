import { startApi } from './compose';

// The API process (plan, phase 7). It reads DATABASE_URL and API_PORT from the environment (the npm
// scripts load the repository's .env when there is one, and a variable already set wins), starts the
// server through the composition root, and stops it cleanly on SIGINT and SIGTERM. A start that fails
// prints its error and exits with code 1: nothing is listening then, and no ApiResponse is built.

function stopHere(message: string): never {
  console.error(`API could not start: ${message}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL ?? '';
const portText = process.env.API_PORT ?? '4000';
const port = Number(portText);

if (databaseUrl === '') stopHere('DATABASE_URL is not set. Copy .env.example to .env (cp .env.example .env).');
if (!Number.isInteger(port) || port < 0 || port > 65535) stopHere(`API_PORT must be a port number, and it is "${portText}".`);

const started = await startApi({ databaseUrl, port });
if (!started.ok) stopHere(`${started.err.code}${started.err.detail === undefined ? '' : `: ${started.err.detail}`}`);

const api = started.value;
if (api.migrated.length > 0) console.log(`Applied migration ${api.migrated.join(', ')}`);
console.log(`API listening on http://localhost:${api.port}`);

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  void api.stop().then(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
