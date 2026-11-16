import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { STORE_TABLES } from '@freshrescue/contract-changeset';
import type { StoreTable } from '@freshrescue/contract-changeset';
import { SNAPSHOT_LISTS } from '@freshrescue/contract-entities';
import type { RawStore } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { TABLES, columnsOf } from './mysql/tables';
import type { StoreReadPort } from './ports';

/** A row as the gateway hands it on: each value under the name of its field. */
type Row = Record<string, unknown>;

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
const unavailable = (detail: string): Result<never, DomainError> => ({ ok: false, err: { code: 'STORE_UNAVAILABLE', detail } });

/** The `SELECT` of one table: every column under the name of its field, in the order the rows were created. */
function selectOf(table: StoreTable): string {
  const { name, orderBy } = TABLES[table];
  const list = columnsOf(table).map(([field, column]) => `${mysql.escapeId(column.name)} AS ${mysql.escapeId(field)}`);
  return `SELECT ${list.join(', ')} FROM ${mysql.escapeId(name)} ORDER BY ${mysql.escapeId(orderBy)}`;
}

const SELECTS = Object.fromEntries(STORE_TABLES.map((table) => [table, selectOf(table)])) as Record<StoreTable, string>;

/**
 * A stored row as its entity has it. MySQL keeps a boolean as 0 or 1, and SnapshotParser accepts only
 * real booleans, so a boolean column turns 0 and 1 into false and true. Any other value is handed on as
 * it is, so that a value no entity can have (a boolean column holding 2, say) reaches the parser, which
 * refuses it, instead of being quietly made into a boolean here.
 */
function rowOf(table: StoreTable, stored: RowDataPacket): Row {
  const row: Row = {};
  for (const [field, column] of columnsOf(table)) {
    const value: unknown = stored[field];
    row[field] = column.kind === 'boolean' && (value === 0 || value === 1) ? value === 1 : value;
  }
  return row;
}

/**
 * The document, as the memory store builds it too: the six lists, and the `settings` and `counters`
 * rows once they have been written. A store in which no table holds a row reads as `null`, which is
 * how a fresh store reads.
 */
function documentOf(rows: Readonly<Record<StoreTable, readonly Row[]>>): RawStore | null {
  if (STORE_TABLES.every((table) => rows[table].length === 0)) return null;
  const document: Row = {};
  for (const list of SNAPSHOT_LISTS) document[list] = rows[list];
  const [settings] = rows.settings;
  const [counters] = rows.counters;
  if (settings !== undefined) document.settings = settings;
  if (counters !== undefined) document.counters = counters;
  return document;
}

/** Every table, read inside one read-only transaction, so that the document shows the store at one moment. */
async function readTables(connection: PoolConnection): Promise<RawStore | null> {
  await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  const rows = {} as Record<StoreTable, readonly Row[]>;
  for (const table of STORE_TABLES) {
    const [stored] = await connection.query<RowDataPacket[]>(SELECTS[table]);
    rows[table] = stored.map((row) => rowOf(table, row));
  }
  await connection.query('COMMIT');
  return documentOf(rows);
}

/** Ends a read that failed. The connection is not handed back to the pool: it is closed, whatever state it was left in. */
async function abandon(connection: PoolConnection): Promise<void> {
  try {
    await connection.query('ROLLBACK');
  } catch {
    // a connection that cannot even roll back is about to be closed anyway
  }
  connection.destroy();
}

/**
 * BG-02 StoreReadGateway. Reads the persisted document out of MySQL: all eight tables into one
 * `RawStore`, or `null` when the store holds nothing (plan, phase 7). The rows come back under the
 * field names of the entities, in creation order (ids ascending, and the rows of `recipe_ingredient` in
 * the order they were first written), with dates as `YYYY-MM-DD` text and booleans as booleans, so the
 * document is the one the memory store would give, and SnapshotParser checks it the same way.
 *
 * STORE_UNAVAILABLE when the store cannot be read: no connection, a lost connection, a missing table.
 * The failure of every native call is caught and returned; nothing is thrown.
 */
export function createStoreReadGateway(pool: Pool): StoreReadPort {
  return {
    read: async () => {
      let connection: PoolConnection;
      try {
        connection = await pool.getConnection();
      } catch (cause) {
        return unavailable(`the store cannot be reached: ${reasonOf(cause)}`);
      }
      try {
        const document = await readTables(connection);
        connection.release();
        return { ok: true, value: document };
      } catch (cause) {
        await abandon(connection);
        return unavailable(`the store cannot be read: ${reasonOf(cause)}`);
      }
    },
  };
}
