import mysql from 'mysql2/promise';
import type { ConnectionOptions, Pool } from 'mysql2/promise';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';

// The MySQL connection (plan, phase 7): the settings that every connection to the store uses, and the
// pool that the two store gateways share. It holds no business rule.

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/**
 * The settings of every connection to the store, from a `mysql://user:password@host:port/database`
 * URL. `dateStrings` makes a DATE column arrive as its `YYYY-MM-DD` text: without it mysql2 turns a
 * DATE into a JavaScript Date at local midnight, which can shift by a day when it is printed.
 */
export function connectionOptionsOf(databaseUrl: string): ConnectionOptions {
  return { uri: databaseUrl, dateStrings: true };
}

/**
 * The pool behind StoreReadGateway and StoreWriteGateway. Making it opens no connection yet, so a
 * database that is down is noticed by the first read. A URL that cannot be parsed is STORE_UNAVAILABLE
 * at once: mysql2 throws on it, and the throw is caught here.
 */
export function createMysqlPool(databaseUrl: string): Result<Pool, DomainError> {
  try {
    return { ok: true, value: mysql.createPool(connectionOptionsOf(databaseUrl)) };
  } catch (cause) {
    return { ok: false, err: { code: 'STORE_UNAVAILABLE', detail: `the database URL cannot be used: ${reasonOf(cause)}` } };
  }
}

/** Closes every connection of the pool. It never rejects: a pool that is closed already stays closed. */
export async function closeMysqlPool(pool: Pool): Promise<void> {
  try {
    await pool.end();
  } catch {
    // mysql2 refuses to end a pool twice; there is nothing left to close
  }
}
