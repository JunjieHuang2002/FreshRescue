import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Result, ValidQty, ValidThreshold, ValidUnit } from '@freshrescue/contract-primitives';
import { LIMITS, UNIT_LIST } from '@freshrescue/contract-rules';

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

/** The value in a message: a number as it is, a text in quotes, anything else as its type, so that a message never prints a stray object. */
const shown = (raw: unknown): string => {
  if (typeof raw === 'number') return String(raw);
  return typeof raw === 'string' ? `"${raw}"` : typeof raw;
};

function checkQty(raw: unknown): Result<ValidQty, DomainError> {
  // The quantity is a count of thousandths, so "more than 3 decimals" arrives as a fraction
  // (spec section 3: never round silently).
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    return fail('QTY_NOT_INTEGER', `a quantity is a whole number of thousandths, and this is ${shown(raw)}`);
  }
  if (raw < LIMITS.QTY_MIN_MILLI) {
    return fail('QTY_NOT_POSITIVE', `a quantity is at least ${LIMITS.QTY_MIN_MILLI} thousandth (0.001), and this is ${raw}`);
  }
  if (raw > LIMITS.QTY_MAX_MILLI) {
    return fail('QTY_TOO_LARGE', `a quantity is at most ${LIMITS.QTY_MAX_MILLI} thousandths (500,000), and this is ${raw}`);
  }
  return { ok: true, value: raw as ValidQty };
}

function checkUnit(raw: unknown): Result<ValidUnit, DomainError> {
  // Units match by exact equality (spec section 3), so `KG` and ` kg` are not units.
  if (typeof raw === 'string' && (UNIT_LIST as readonly string[]).includes(raw)) {
    return { ok: true, value: raw as ValidUnit };
  }
  return fail('UNIT_UNKNOWN', `a unit is one of ${UNIT_LIST.join(', ')}, and this is ${shown(raw)}`);
}

function checkThreshold(raw: unknown): Result<ValidThreshold, DomainError> {
  // A whole number of days of at least 1. A number beyond the safe integers cannot be held exactly,
  // so it is not one.
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= LIMITS.THRESHOLD_MIN_DAYS) {
    return { ok: true, value: raw as ValidThreshold };
  }
  const minimum = LIMITS.THRESHOLD_MIN_DAYS;
  return fail('THRESHOLD_INVALID', `a threshold is a whole number of days, at least ${minimum}, and this is ${shown(raw)}`);
}

/**
 * BC-04 ScalarValidator. Checks one scalar against its rule in `rules` and returns it as the
 * validated type that a decider accepts. `kind` picks the rule, and the type of the result follows it.
 *
 * - `qty`: an integer number of thousandths from 1 to 500,000,000. The checks run in this order:
 *   whole number (QTY_NOT_INTEGER), positive (QTY_NOT_POSITIVE), not above the maximum (QTY_TOO_LARGE).
 * - `unit`: one of the six units, spelled exactly (UNIT_UNKNOWN). The unit of a new Food Type that
 *   was not given is `null`, which is not a unit.
 * - `thresholdDays`: a whole number of days of at least 1 (THRESHOLD_INVALID).
 *
 * The raw value is `unknown`, because a coordinator hands in a field exactly as the command carried it.
 */
export function scalarValidator(kind: 'qty', raw: unknown): Result<ValidQty, DomainError>;
export function scalarValidator(kind: 'unit', raw: unknown): Result<ValidUnit, DomainError>;
export function scalarValidator(kind: 'thresholdDays', raw: unknown): Result<ValidThreshold, DomainError>;
export function scalarValidator(
  kind: 'qty' | 'unit' | 'thresholdDays',
  raw: unknown,
): Result<ValidQty, DomainError> | Result<ValidUnit, DomainError> | Result<ValidThreshold, DomainError> {
  switch (kind) {
    case 'qty':
      return checkQty(raw);
    case 'unit':
      return checkUnit(raw);
    case 'thresholdDays':
      return checkThreshold(raw);
  }
}
