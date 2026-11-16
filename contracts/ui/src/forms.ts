import type { ErrorCodeOf } from '@freshrescue/contract-errors';
import type { CommandType } from '@freshrescue/contract-messages';
import { CATEGORY_SCOPES, UNIT_LIST } from '@freshrescue/contract-rules';

// A form holds text. Decimal text becomes thousandths only here, in the form parser, driven by the
// schemas below (plan, phase 2, "Quantities"). The parser turns the texts of one form into the
// payload of its command (for a confirmation, into the target of a deletion), or into errors for
// the fields that cannot be read.

/**
 * The forms that a FormSlice can show. One slice can show several: the `batch` slice shows
 * `batchAdd` and `batchQty`. The last four are confirmations: they have no field to type into.
 */
export const FORM_KINDS = [
  'settingsForm',
  'batchAdd',
  'batchQty',
  'batchRemove',
  'foodTypeCreate',
  'foodTypeEdit',
  'unitChange',
  'foodTypeDelete',
  'categoryCreate',
  'categoryRename',
  'thresholdSet',
  'categoryDelete',
  'recipeCreate',
  'recipeEdit',
  'recipeDelete',
] as const;

export type FormKind = (typeof FORM_KINDS)[number];

/**
 * The text in each field of a form, by field key. A plain field has the key of its name. The
 * branches of an `either` field are `name.mode` (which branch) and `name.<branch>`. A field of a
 * `group` is `group.<field>`. A row of a `rows` field is `name.<index>.<field>`. The rows of the
 * recipe form, which sit inside the `draft` group, are therefore `draft.rows.0.quantity`.
 */
export type FormValues = Readonly<Record<string, string>>;

/** The hint to show beside a field, by field key. */
export type FieldHints = Readonly<Record<string, string>>;

/** One entry of a drop-down. */
export type FormOption = {
  readonly value: string;
  readonly label: string;
};

/** The entries of each drop-down of a form, by field name (or by the name of its rows). */
export type OptionLists = Readonly<Record<string, readonly FormOption[]>>;

/** What FormPrefillBuilder makes: the initial texts of a form, and its drop-down entries. */
export type FormPrefill = {
  readonly values: FormValues;
  readonly options: OptionLists;
};

/**
 * How to read one field of a form. An empty text is an error when `required`, and `null` when not.
 *   text    any text, kept as typed
 *   qty     decimal text to thousandths: QTY_FORMAT, QTY_DECIMALS
 *   int     a whole number: INT_FORMAT
 *   date    `YYYY-MM-DD`: DATE_FORMAT
 *   id      the id of a record chosen from a list: CHOICE_UNKNOWN
 *   choice  one of a fixed list of texts: CHOICE_UNKNOWN
 *   either  exactly one of several fields, named by `name.mode`: the payload is `{ <branch>: value }`
 *   group   fields that form one object of the payload
 *   rows    a repeated group of fields, with at least `min` rows: the payload is an array
 */
export type FieldSpec =
  | { readonly kind: 'text'; readonly required: boolean }
  | { readonly kind: 'qty'; readonly required: boolean }
  | { readonly kind: 'int'; readonly required: boolean }
  | { readonly kind: 'date'; readonly required: boolean }
  | { readonly kind: 'id'; readonly required: boolean }
  | { readonly kind: 'choice'; readonly required: boolean; readonly options: readonly string[] }
  | { readonly kind: 'either'; readonly branches: SchemaFields }
  | { readonly kind: 'group'; readonly fields: SchemaFields }
  | { readonly kind: 'rows'; readonly min: number; readonly fields: SchemaFields };

/** The fields of a form by name. A name is the key of the field in the command payload. */
export type SchemaFields = { readonly [name: string]: FieldSpec };

/** An edit form and the command it writes. The keys of `fields` are exactly the keys of that command's payload. */
export type EditFormSchema = {
  readonly command: CommandType;
  readonly fields: SchemaFields;
};

/**
 * The confirmation of a deletion, shared by the four deletions. It reads the target, and the
 * coordinator builds whichever of `commands` the confirmation is for from what it reads.
 */
export type TargetFormSchema = {
  readonly commands: readonly CommandType[];
  readonly fields: SchemaFields;
};

export type FormSchema = EditFormSchema | TargetFormSchema;

/**
 * How the form parser reads every form: the 8 edit forms, and `target`, the confirmation schema
 * that the 4 deletions share. Together they cover the payloads of 12 commands. The 13th,
 * CookRecipes, takes its `recipeIds` directly from the cook queue and has no form.
 */
export const FORM_SCHEMAS = {
  settings: {
    command: 'SetSimulatedToday',
    fields: {
      date: { kind: 'date', required: false },
    },
  },
  batchAdd: {
    command: 'InboundBatch',
    fields: {
      foodTypeId: { kind: 'id', required: false },
      foodName: { kind: 'text', required: false },
      categoryId: { kind: 'id', required: false },
      unit: { kind: 'choice', required: false, options: UNIT_LIST },
      quantity: { kind: 'qty', required: true },
      expiry: {
        kind: 'either',
        branches: {
          days: { kind: 'int', required: true },
          date: { kind: 'date', required: true },
        },
      },
    },
  },
  batchQty: {
    command: 'EditBatchQuantity',
    fields: {
      batchId: { kind: 'id', required: true },
      quantity: { kind: 'qty', required: true },
    },
  },
  foodType: {
    command: 'SaveFoodType',
    fields: {
      foodTypeId: { kind: 'id', required: false },
      name: { kind: 'text', required: true },
      categoryId: { kind: 'id', required: false },
      unit: { kind: 'choice', required: false, options: UNIT_LIST },
      thresholdDays: { kind: 'int', required: false },
    },
  },
  unitChange: {
    command: 'ChangeFoodTypeUnit',
    fields: {
      foodTypeId: { kind: 'id', required: true },
      unit: { kind: 'choice', required: true, options: UNIT_LIST },
      batches: {
        kind: 'rows',
        min: 0,
        fields: {
          batchId: { kind: 'id', required: true },
          quantity: { kind: 'qty', required: true },
        },
      },
    },
  },
  category: {
    command: 'SaveCategory',
    fields: {
      scope: { kind: 'choice', required: true, options: CATEGORY_SCOPES },
      categoryId: { kind: 'id', required: false },
      parentId: { kind: 'id', required: false },
      name: { kind: 'text', required: true },
    },
  },
  threshold: {
    command: 'SetCategoryThreshold',
    fields: {
      categoryId: { kind: 'id', required: true },
      thresholdDays: { kind: 'int', required: false },
    },
  },
  recipe: {
    command: 'SaveRecipe',
    fields: {
      recipeId: { kind: 'id', required: false },
      name: { kind: 'text', required: true },
      draft: {
        kind: 'group',
        fields: {
          cuisineId: { kind: 'id', required: false },
          rows: {
            kind: 'rows',
            min: 1,
            fields: {
              foodTypeId: { kind: 'id', required: true },
              quantity: { kind: 'qty', required: true },
              unit: { kind: 'choice', required: true, options: UNIT_LIST },
            },
          },
        },
      },
    },
  },
  // A confirmation has no field to type into. Its values are the `id` of the record to delete and,
  // for a category, the `scope` (the tree it is in).
  target: {
    commands: ['DeleteCategory', 'DeleteFoodType', 'RemoveBatch', 'DeleteRecipe'],
    fields: {
      id: { kind: 'id', required: true },
      scope: { kind: 'choice', required: false, options: CATEGORY_SCOPES },
    },
  },
} as const satisfies Record<string, FormSchema>;

export type SchemaName = keyof typeof FORM_SCHEMAS;

/** The six codes that a form can raise: the codes of the `form` family. */
export type FormErrorCode = ErrorCodeOf<'form'>;

/** A field that could not be read, and why. The field is its key in `FormValues`. */
export type FieldError = {
  readonly field: string;
  readonly code: FormErrorCode;
};
