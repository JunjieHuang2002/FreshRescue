import type { StoreRows, StoreTable } from '@freshrescue/contract-changeset';

// The table and column map (plan, phase 7). WriteOps and the RawStore speak in the logical table
// names and the field names of the entities; this file is the only one that knows the real names
// of the schema in migrations/0001_init.sql, so the two MySQL gateways build every statement from
// it. It holds no business rule: it says where a field is stored, and how it is stored.

/**
 * How a column holds the value of its field, which is what the gateways need to write a value and
 * to read the same value back: a whole number, a text, a `YYYY-MM-DD` date, or a boolean, which
 * MySQL stores as 0 or 1.
 */
export type ColumnKind = 'integer' | 'text' | 'date' | 'boolean';

/** The column of one field. A field that may be null in its entity is stored in a nullable column. */
export type Column = {
  readonly name: string;
  readonly kind: ColumnKind;
  readonly nullable: boolean;
};

/** A real table: its name, the column of every field of its entity, and how its rows are ordered and named. */
export type Table<T extends StoreTable> = {
  readonly name: string;
  /** One column for each field of the entity, no more and no less: the compiler checks it against the contract. */
  readonly columns: { readonly [F in keyof StoreRows[T]]-?: Column };
  /** The column that gives the rows back in the order they were created. */
  readonly orderBy: string;
  /**
   * A table that holds one row (`settings`, `counters`, whose rows have no key field) has a key
   * column of its own that always holds the same value, so that a put replaces that one row.
   */
  readonly singleRow: { readonly column: string; readonly value: number } | null;
};

export const TABLES: { readonly [T in StoreTable]: Table<T> } = {
  foodCategories: {
    name: 'food_category',
    columns: {
      id: { name: 'id', kind: 'integer', nullable: false },
      name: { name: 'name', kind: 'text', nullable: false },
      parentId: { name: 'parent_id', kind: 'integer', nullable: true },
      isSystem: { name: 'is_system', kind: 'boolean', nullable: false },
      customThresholdDays: { name: 'custom_threshold_days', kind: 'integer', nullable: true },
    },
    orderBy: 'id',
    singleRow: null,
  },
  foodTypes: {
    name: 'food_type',
    columns: {
      id: { name: 'id', kind: 'integer', nullable: false },
      name: { name: 'name', kind: 'text', nullable: false },
      categoryId: { name: 'category_id', kind: 'integer', nullable: false },
      unit: { name: 'unit', kind: 'text', nullable: false },
      customThresholdDays: { name: 'custom_threshold_days', kind: 'integer', nullable: true },
    },
    orderBy: 'id',
    singleRow: null,
  },
  batches: {
    name: 'batch',
    columns: {
      id: { name: 'id', kind: 'integer', nullable: false },
      foodTypeId: { name: 'food_type_id', kind: 'integer', nullable: false },
      quantity: { name: 'quantity', kind: 'integer', nullable: false },
      inboundDate: { name: 'inbound_date', kind: 'date', nullable: false },
      expirationDate: { name: 'expiration_date', kind: 'date', nullable: false },
      createdSeq: { name: 'created_seq', kind: 'integer', nullable: false },
    },
    orderBy: 'id',
    singleRow: null,
  },
  recipeCategories: {
    name: 'recipe_category',
    columns: {
      id: { name: 'id', kind: 'integer', nullable: false },
      name: { name: 'name', kind: 'text', nullable: false },
      isSystem: { name: 'is_system', kind: 'boolean', nullable: false },
    },
    orderBy: 'id',
    singleRow: null,
  },
  recipes: {
    name: 'recipe',
    columns: {
      id: { name: 'id', kind: 'integer', nullable: false },
      name: { name: 'name', kind: 'text', nullable: false },
      recipeCategoryId: { name: 'recipe_category_id', kind: 'integer', nullable: false },
    },
    orderBy: 'id',
    singleRow: null,
  },
  recipeIngredients: {
    name: 'recipe_ingredient',
    columns: {
      recipeId: { name: 'recipe_id', kind: 'integer', nullable: false },
      foodTypeId: { name: 'food_type_id', kind: 'integer', nullable: false },
      requiredQuantity: { name: 'required_quantity', kind: 'integer', nullable: false },
      requiredUnit: { name: 'required_unit', kind: 'text', nullable: false },
      deletedFoodTypeName: { name: 'deleted_food_type_name', kind: 'text', nullable: true },
    },
    // the auto-increment column: a row keeps it when a put replaces the row, and a new row comes last
    orderBy: 'seq',
    singleRow: null,
  },
  settings: {
    name: 'app_settings',
    columns: {
      simulatedToday: { name: 'simulated_today', kind: 'date', nullable: true },
      bootstrapped: { name: 'bootstrapped', kind: 'boolean', nullable: false },
    },
    orderBy: 'id',
    singleRow: { column: 'id', value: 1 },
  },
  counters: {
    name: 'app_counters',
    columns: {
      nextId: { name: 'next_id', kind: 'integer', nullable: false },
      nextSeq: { name: 'next_seq', kind: 'integer', nullable: false },
    },
    orderBy: 'id',
    singleRow: { column: 'id', value: 1 },
  },
};

/** Where the migration runner records each migration it has applied, by its file name without `.sql`. */
export const MIGRATIONS_TABLE = { name: 'schema_migrations', version: 'version' } as const;

/** The fields of a table with their columns, in the order of the entity. */
export function columnsOf(table: StoreTable): readonly (readonly [field: string, column: Column])[] {
  return Object.entries(TABLES[table].columns as Readonly<Record<string, Column>>);
}
