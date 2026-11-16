import { STORE_KEYS, STORE_TABLES } from '@freshrescue/contract-changeset';
import type { StoreTable, WriteOp } from '@freshrescue/contract-changeset';
import { SNAPSHOT_LISTS } from '@freshrescue/contract-entities';
import type { RawStore } from '@freshrescue/contract-entities';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import { LIMITS } from '@freshrescue/contract-rules';
import type { StoreReadPort, StoreWritePort } from '../ports';

/** A stored row, seen by field name: the store reads the key fields of a row by name and keeps nothing else about it. */
type Row = Readonly<Record<string, unknown>>;

/** The rows of every logical table, each list in the order its rows were first written. */
type Tables = Record<StoreTable, Row[]>;

const emptyTables = (): Tables => ({
  foodCategories: [],
  foodTypes: [],
  batches: [],
  recipeCategories: [],
  recipes: [],
  recipeIngredients: [],
  settings: [],
  counters: [],
});

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });
const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** The column that the CHECK of the real schema covers in each table that has one (plan, phase 7). */
const QUANTITY_FIELD = { batches: 'quantity', recipeIngredients: 'requiredQuantity' } as const;

/**
 * The one constraint that the real schema has: a CHECK that keeps a quantity a whole number between 1 and
 * 500,000,000 thousandths. The memory store refuses the same rows, so that a write that MySQL would refuse
 * is refused here too, and the one conformance suite can use it as its failing write.
 */
function violation(op: WriteOp): string | null {
  if (op.op !== 'put' || (op.table !== 'batches' && op.table !== 'recipeIngredients')) return null;
  const field = QUANTITY_FIELD[op.table];
  const value = (op.row as Row)[field];
  const fits =
    typeof value === 'number' && Number.isInteger(value) && value >= LIMITS.QTY_MIN_MILLI && value <= LIMITS.QTY_MAX_MILLI;
  return fits ? null : `${op.table}.${field} is ${String(value)}, and the check allows ${LIMITS.QTY_MIN_MILLI} to ${LIMITS.QTY_MAX_MILLI}`;
}

/**
 * Applies one operation to the tables, as the ChangeSetApplier would to a snapshot. A put inserts the row
 * at the end of its table, or replaces the row with the same key where it stands, so the lists stay in
 * creation order. A delete removes every row that matches the key, and the key may be partial: it names
 * only the fields it lists. A delete that matches nothing is not an error.
 */
function applyOp(tables: Tables, op: WriteOp): void {
  if (op.op === 'delete') {
    const key = Object.entries(op.key);
    tables[op.table] = tables[op.table].filter((row) => !key.every(([field, value]) => row[field] === value));
    return;
  }
  const keyFields: readonly string[] = STORE_KEYS[op.table];
  const row = structuredClone(op.row) as Row;
  const rows = tables[op.table];
  const at = rows.findIndex((existing) => keyFields.every((field) => existing[field] === row[field]));
  if (at < 0) rows.push(row);
  else rows[at] = row;
}

/**
 * The persisted document: one list for each of the six record tables, and the `settings` and `counters`
 * rows once they have been written. It is `null` when no table holds a row, which is how a fresh store
 * reads. The rows are copies, so a caller cannot change the store through what it was handed.
 */
function documentOf(tables: Tables): RawStore | null {
  if (STORE_TABLES.every((table) => tables[table].length === 0)) return null;
  const document: Record<string, unknown> = {};
  for (const list of SNAPSHOT_LISTS) document[list] = structuredClone(tables[list]);
  const [settings] = tables.settings;
  const [counters] = tables.counters;
  if (settings !== undefined) document.settings = structuredClone(settings);
  if (counters !== undefined) document.counters = structuredClone(counters);
  return document;
}

/**
 * The in-memory stand-in for StoreReadGateway (BG-02) and StoreWriteGateway (BG-03) of phase 7: one store
 * that implements both ports, so that the five backend coordinators can run end to end with no database.
 * It passes the same conformance suite as MySQL does.
 *
 * A write is all or nothing. The operations run, in order, on a working copy of every table, and the copy
 * replaces the store only after the last one has passed. An operation that fails (the CHECK above, or a
 * row that cannot be copied) leaves the store as it was and answers STORE_WRITE_FAILED. Nothing here
 * throws: the one native call that can, copying a row that a caller passed in, is caught and converted.
 * A read cannot fail, because the store holds only copies that it made itself, so it never answers
 * STORE_UNAVAILABLE: that is for a store that has a connection to lose.
 */
export function createMemoryStore(): StoreReadPort & StoreWritePort {
  let tables = emptyTables();

  return {
    read: async () => ({ ok: true, value: documentOf(tables) }),
    apply: async (ops) => {
      try {
        const working = structuredClone(tables);
        for (const op of ops) {
          const broken = violation(op);
          if (broken !== null) return fail('STORE_WRITE_FAILED', broken);
          applyOp(working, op);
        }
        tables = working;
        return { ok: true, value: {} };
      } catch (cause) {
        return fail('STORE_WRITE_FAILED', `the write failed: ${reasonOf(cause)}`);
      }
    },
  };
}
