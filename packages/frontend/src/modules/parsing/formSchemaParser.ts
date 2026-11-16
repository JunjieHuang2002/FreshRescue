import type { CommandPayloads } from '@freshrescue/contract-messages';
import type { Id, Result } from '@freshrescue/contract-primitives';
import type { CategoryScope } from '@freshrescue/contract-rules';
import type {
  EditFormSchema,
  FieldError,
  FieldSpec,
  FormErrorCode,
  FormSchema,
  FormValues,
  SchemaFields,
  TargetFormSchema,
} from '@freshrescue/contract-ui';

/**
 * What the confirmation schema (`FORM_SCHEMAS.target`) reads: the id of the record to delete and, for
 * a category, the tree it is in. The coordinator builds whichever of the four deletions it is for.
 */
export type Target = { readonly id: Id; readonly scope: CategoryScope | null };

type Scalar = Exclude<FieldSpec, { kind: 'either' } | { kind: 'group' } | { kind: 'rows' }>;
type Read = Result<string | number | null, FormErrorCode>;

const ok = (value: string | number | null): Read => ({ ok: true, value });
const fail = (code: FormErrorCode): Read => ({ ok: false, err: code });

/** A text with nothing in it, or only spaces. */
const isBlank = (text: string): boolean => text.trim() === '';

/**
 * Decimal text to whole thousandths (spec section 3): digits and at most one `.`, no sign, no
 * exponent, no separator, and at most 3 digits after the point, which are never rounded. A number
 * beyond what a JavaScript integer holds is returned as the largest one, which is far above the
 * 500,000 limit, so the backend refuses it as too large instead of the form misreading it.
 */
function readQty(text: string): Read {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
  const whole = match?.[1] ?? '';
  const decimals = match?.[2] ?? '';
  if (match === null || (whole === '' && decimals === '')) return fail('QTY_FORMAT');
  if (decimals.length > 3) return fail('QTY_DECIMALS');
  const milli = Number(`${whole}${decimals.padEnd(3, '0')}`);
  return ok(Number.isSafeInteger(milli) ? milli : Number.MAX_SAFE_INTEGER);
}

function readScalar(spec: Scalar, raw: string): Read {
  if (isBlank(raw)) return spec.required ? fail('FIELD_REQUIRED') : ok(null);
  const text = raw.trim();
  switch (spec.kind) {
    case 'text':
      return ok(raw);
    case 'qty':
      return readQty(text);
    case 'int':
      return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? ok(Number(text)) : fail('INT_FORMAT');
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? ok(text) : fail('DATE_FORMAT');
    case 'id':
      return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) >= 1 ? ok(Number(text)) : fail('CHOICE_UNKNOWN');
    case 'choice':
      return spec.options.includes(raw) ? ok(raw) : fail('CHOICE_UNKNOWN');
  }
}

// A row of a `rows` field has the keys `<key>.<index>.<field>`, so the rows are counted from the keys.
function rowCount(values: FormValues, key: string): number {
  const prefix = `${key}.`;
  let count = 0;
  for (const name of Object.keys(values)) {
    if (!name.startsWith(prefix)) continue;
    const index = Number.parseInt(name.slice(prefix.length), 10);
    if (Number.isInteger(index)) count = Math.max(count, index + 1);
  }
  return count;
}

function readField(spec: FieldSpec, key: string, values: FormValues, errors: FieldError[]): unknown {
  switch (spec.kind) {
    case 'group':
      return readFields(spec.fields, `${key}.`, values, errors);
    case 'either': {
      // `name.mode` names the branch that is filled in, and the payload holds that branch only
      const modeKey = `${key}.mode`;
      const mode = (values[modeKey] ?? '').trim();
      const branch = Object.hasOwn(spec.branches, mode) ? spec.branches[mode] : undefined;
      if (mode === '' || branch === undefined) {
        errors.push({ field: modeKey, code: mode === '' ? 'FIELD_REQUIRED' : 'CHOICE_UNKNOWN' });
        return null;
      }
      return { [mode]: readField(branch, `${key}.${mode}`, values, errors) };
    }
    case 'rows': {
      const count = rowCount(values, key);
      if (count < spec.min) errors.push({ field: key, code: 'FIELD_REQUIRED' });
      return Array.from({ length: count }, (_row, index) => readFields(spec.fields, `${key}.${index}.`, values, errors));
    }
    default: {
      const read = readScalar(spec, values[key] ?? '');
      if (read.ok) return read.value;
      errors.push({ field: key, code: read.err });
      return null;
    }
  }
}

function readFields(fields: SchemaFields, prefix: string, values: FormValues, errors: FieldError[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(fields)) payload[name] = readField(spec, `${prefix}${name}`, values, errors);
  return payload;
}

/**
 * FP-01 FormSchemaParser. Turns the texts of one form into the payload of its command, driven by a
 * `FormSchema` of the `ui` contract (blueprint 1.7). It is the one place where decimal text becomes
 * thousandths. Each field is read by its kind:
 *
 * - `text` is kept exactly as typed. `qty` is decimal text to thousandths: QTY_FORMAT for anything
 *   but digits and one point, QTY_DECIMALS for more than 3 digits after the point.
 * - `int` is a whole number without sign: INT_FORMAT. `date` is `YYYY-MM-DD`: DATE_FORMAT; whether
 *   that day exists is for the backend (DATE_INVALID).
 * - `id` is the id of a record that was picked, and `choice` is one of a fixed list: CHOICE_UNKNOWN.
 * - An empty field (or one with only spaces) is FIELD_REQUIRED when the schema says `required`, and
 *   `null` when not. That is how a form that leaves both inbound name fields blank sends two nulls.
 * - `either` reads `name.mode` and then only the branch that it names, so the payload is `{ days }`
 *   or `{ date }`. `group` reads its fields under `name.`. `rows` reads `name.<index>.<field>` for
 *   every row there is, and wants at least `min` of them (FIELD_REQUIRED on the rows key).
 *
 * Every field is read, so a form with three bad fields reports all three, in the order of the
 * schema, each under its key in `FormValues`. The parser looks at one field at a time: it does not
 * choose between two fields that exclude each other, because the backend answers that (BAD_COMBINATION).
 */
export function formSchemaParser<S extends EditFormSchema>(
  schema: S,
  values: FormValues,
): Result<CommandPayloads[S['command']], readonly FieldError[]>;
export function formSchemaParser(schema: TargetFormSchema, values: FormValues): Result<Target, readonly FieldError[]>;
export function formSchemaParser(schema: FormSchema, values: FormValues): Result<unknown, readonly FieldError[]> {
  const errors: FieldError[] = [];
  const payload = readFields(schema.fields, '', values, errors);
  return errors.length > 0 ? { ok: false, err: errors } : { ok: true, value: payload };
}
