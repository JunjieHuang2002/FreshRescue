import mysql from 'mysql2/promise';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { STORE_KEYS } from '@freshrescue/contract-changeset';
import type { StoreTable, WriteOp, WriteOps } from '@freshrescue/contract-changeset';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Empty, Result } from '@freshrescue/contract-primitives';
import { TABLES, columnsOf } from './mysql/tables';
import type { Column } from './mysql/tables';
import type { StoreWritePort } from './ports';

/** One SQL statement with the values of its placeholders. */
type Statement = { readonly sql: string; readonly values: readonly unknown[] };

const DONE: Result<Empty, DomainError> = { ok: true, value: {} };
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
const failed = (detail: string): Result<never, DomainError> => ({ ok: false, err: { code: 'STORE_WRITE_FAILED', detail } });
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null;

/** A value as a failure detail names it: `the number 1.5`, `the text "2026-1-5"`, `no value`. */
function shown(value: unknown): string {
  if (value === undefined) return 'no value';
  if (value === null) return 'null';
  if (typeof value === 'string') return `the text ${JSON.stringify(value)}`;
  return `the ${typeof value} ${String(value)}`;
}

/**
 * Whether a column holds the value so that it reads back as the same value. MySQL itself refuses a
 * date that does not exist, a text that is too long and a quantity outside the CHECK, but it rounds
 * 1.5 to 2 in an integer column and turns `2026-1-5` into `2026-01-05` in a date column, so the
 * gateway refuses those before MySQL sees them. A value that fits its column is written as it is.
 */
function fits(column: Column, value: unknown): boolean {
  if (value === null) return column.nullable;
  switch (column.kind) {
    case 'integer':
      return Number.isSafeInteger(value);
    case 'text':
      return typeof value === 'string';
    case 'date':
      return typeof value === 'string' && DATE_TEXT.test(value);
    case 'boolean':
      return typeof value === 'boolean';
  }
}

/**
 * A put as an upsert: insert the row, or update the row that has its key. The update uses the row
 * alias (`AS new`), which MySQL has had since 8.0.19, instead of `VALUES()`, which is deprecated.
 * A table of one row writes its fixed key value too, so a second put replaces the first row.
 */
function putOf(table: StoreTable, row: Readonly<Record<string, unknown>>): Result<Statement, string> {
  const { name, singleRow } = TABLES[table];
  const keyFields: readonly string[] = STORE_KEYS[table];
  const columns: string[] = singleRow === null ? [] : [mysql.escapeId(singleRow.column)];
  const values: unknown[] = singleRow === null ? [] : [singleRow.value];
  const updates: string[] = [];
  for (const [field, column] of columnsOf(table)) {
    const value = row[field];
    if (!fits(column, value)) return { ok: false, err: `${table}.${field} cannot hold ${shown(value)}` };
    columns.push(mysql.escapeId(column.name));
    values.push(value);
    if (!keyFields.includes(field)) updates.push(`${mysql.escapeId(column.name)} = new.${mysql.escapeId(column.name)}`);
  }
  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT INTO ${mysql.escapeId(name)} (${columns.join(', ')}) VALUES (${placeholders}) AS new ON DUPLICATE KEY UPDATE ${updates.join(', ')}`;
  return { ok: true, value: { sql, values } };
}

/**
 * A delete of every row that matches the key, which may be partial: it names only the fields it lists,
 * and a key with no field matches every row of the table, which is how the one row of `settings` or
 * `counters` is deleted. `<=>` compares as the memory store does, so a key value of null matches null.
 */
function deleteOf(table: StoreTable, key: Readonly<Record<string, unknown>>): Result<Statement, string> {
  const columns = new Map(columnsOf(table));
  const conditions: string[] = [];
  const values: unknown[] = [];
  for (const [field, value] of Object.entries(key)) {
    const column = columns.get(field);
    if (column === undefined) return { ok: false, err: `${table} has no field ${field} to delete by` };
    if (!fits(column, value)) return { ok: false, err: `${table}.${field} cannot hold ${shown(value)}` };
    conditions.push(`${mysql.escapeId(column.name)} <=> ?`);
    values.push(value);
  }
  const where = conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`;
  return { ok: true, value: { sql: `DELETE FROM ${mysql.escapeId(TABLES[table].name)}${where}`, values } };
}

/** The statement of one operation, or why there can be none. Operations come from code, but they are checked as if they did not. */
function statementOf(op: WriteOp): Result<Statement, string> {
  if (!isRecord(op)) return { ok: false, err: `the operation is ${shown(op)}` };
  if (typeof op.table !== 'string' || !Object.hasOwn(TABLES, op.table)) return { ok: false, err: `${shown(op.table)} is not a table of the store` };
  if (op.op === 'put') return isRecord(op.row) ? putOf(op.table, op.row) : { ok: false, err: `the row is ${shown(op.row)}` };
  if (op.op === 'delete') return isRecord(op.key) ? deleteOf(op.table, op.key) : { ok: false, err: `the key is ${shown(op.key)}` };
  return { ok: false, err: `${String((op as { readonly op: unknown }).op)} is neither a put nor a delete` };
}

/** Every statement of a batch, in order. One operation that cannot be written stops the batch before anything is written. */
function statementsOf(ops: WriteOps): Result<readonly Statement[], DomainError> {
  const statements: Statement[] = [];
  for (const [index, op] of ops.entries()) {
    const statement = statementOf(op);
    if (!statement.ok) return failed(`operation ${index + 1} of ${ops.length} cannot be written, so nothing was: ${statement.err}`);
    statements.push(statement.value);
  }
  return { ok: true, value: statements };
}

/**
 * Runs the statements in one transaction and commits them, or rolls all of them back. A connection on
 * which a write failed is closed rather than handed back to the pool, whatever state it was left in.
 */
async function commitAll(connection: PoolConnection, statements: readonly Statement[]): Promise<Result<Empty, DomainError>> {
  let step = 'the start of the transaction';
  try {
    await connection.beginTransaction();
    for (const [index, statement] of statements.entries()) {
      step = `operation ${index + 1} of ${statements.length}`;
      await connection.query(statement.sql, [...statement.values]);
    }
    step = 'the commit';
    await connection.commit();
  } catch (cause) {
    try {
      await connection.rollback();
    } catch {
      // the connection is closed below, which ends the transaction on the server as well
    }
    connection.destroy();
    return failed(`${step} failed, and the write was rolled back: ${reasonOf(cause)}`);
  }
  connection.release();
  return DONE;
}

/**
 * BG-03 StoreWriteGateway. Applies one `WriteOps` batch to MySQL, all or nothing (plan, phase 7): every
 * operation, in order, inside one transaction, a put as an upsert and a delete by a whole or partial
 * key. When any operation fails (a quantity outside the CHECK, a lost connection, a value its column
 * cannot hold unchanged) the transaction is rolled back, the store is as it was before the call, and
 * the answer is STORE_WRITE_FAILED. The failure of every native call is caught and returned; nothing is
 * thrown. An empty batch writes nothing and needs no connection.
 */
export function createStoreWriteGateway(pool: Pool): StoreWritePort {
  return {
    apply: async (ops) => {
      const statements = statementsOf(ops);
      if (!statements.ok) return statements;
      if (statements.value.length === 0) return DONE;
      let connection: PoolConnection;
      try {
        connection = await pool.getConnection();
      } catch (cause) {
        return failed(`the store cannot be reached, so nothing was written: ${reasonOf(cause)}`);
      }
      return commitAll(connection, statements.value);
    },
  };
}
