import {
  closeMysqlPool,
  createBackendCoordinator,
  createClockGateway,
  createHttpServerGateway,
  createMysqlPool,
  createSeedSourceGateway,
  createStoreReadGateway,
  createStoreWriteGateway,
  migrate,
} from '@freshrescue/backend';

/** What the API needs from its surroundings. main.ts reads it from the environment; a test passes its own. */
export type ApiSettings = {
  /** The MySQL database that holds the store, as a `mysql://user:password@host:port/database` URL. */
  readonly databaseUrl: string;
  /** The port the HTTP server listens on. 0 picks a free one. */
  readonly port: number;
};

/**
 * The API's composition root (plan, phase 7). It creates the five gateways and the backend coordinator
 * and wires them together, and it holds no logic: each step below is one call, and the first Err stops
 * the start and is returned, after whatever was opened has been closed again.
 *
 * The order is the startup of blueprint 2.3. The schema is brought up to date, the coordinator loads the
 * store and seeds it if it is fresh, and only then does the HTTP server open its port, so no request
 * arrives before the store is ready. The value holds the port that was opened, the migrations applied
 * by this start, and `stop`, which closes the server and then the pool.
 */
export async function startApi(settings: ApiSettings) {
  const migrated = await migrate(settings.databaseUrl);
  if (!migrated.ok) return migrated;
  const pool = createMysqlPool(settings.databaseUrl);
  if (!pool.ok) return pool;

  const backend = createBackendCoordinator({
    storeRead: createStoreReadGateway(pool.value),
    storeWrite: createStoreWriteGateway(pool.value),
    clock: createClockGateway(),
    seedSource: createSeedSourceGateway(),
  });
  const server = createHttpServerGateway(backend);

  const started = await backend.startup();
  const listening = started.ok ? await server.listen(settings.port) : started;
  if (!listening.ok) {
    await closeMysqlPool(pool.value);
    return listening;
  }

  const stop = async (): Promise<void> => {
    await server.close();
    await closeMysqlPool(pool.value);
  };
  return { ok: true, value: { port: listening.value, migrated: migrated.value, stop } } as const;
}
