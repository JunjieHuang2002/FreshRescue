import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import type { Expiry } from '@freshrescue/contract-messages';
import type { DateISO, Result } from '@freshrescue/contract-primitives';

const fail = (code: ErrorCode, detail: string): Result<never, DomainError> => ({ ok: false, err: { code, detail } });

// Calendar arithmetic on whole days, in integers, so that no clock and no time zone is involved. A
// date counts as the number of days since 1970-01-01 in the proleptic Gregorian calendar. Each
// module that needs a date keeps its own copy of these few lines: a module imports no other module.
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Days since 1970-01-01 of a year, a month (1 to 12) and a day. */
function dayNumber(year: number, month: number, day: number): number {
  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The day number of a `YYYY-MM-DD` text, or null when it is not a real calendar date. */
function readDay(text: string): number | null {
  const match = DATE_TEXT.exec(text);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const length = month === 2 && isLeap(year) ? 29 : (MONTH_LENGTHS[month - 1] ?? 0);
  return day >= 1 && day <= length ? dayNumber(year, month, day) : null;
}

/** The `YYYY-MM-DD` text of a day number: the inverse of `dayNumber`. */
function writeDay(days: number): DateISO {
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * BC-05 ExpiryResolver. Turns a shelf life or an expiration date into the pair `D_in` and `D_exp`
 * (spec section 3, "Inbound Shelf Life / Expiration Date"). Its errors are the two that the blueprint
 * lists for it, DAYS_INVALID and PAST_EXPIRY, and no others.
 *
 * - `D_in` is always `today` and cannot be chosen.
 * - `{ days: S }`: `S` is a whole number of days, 0 or more (DAYS_INVALID), and `D_exp = D_in + S`,
 *   so `S = 0` expires today. The spec sets no upper limit, and neither does this module: a date that
 *   no store can hold is refused further on, by the invariant check and by the database.
 * - `{ date: D }`: `D_exp = D`, and a date before today is refused (PAST_EXPIRY, the Past-Expiry
 *   Block). Today itself is allowed.
 *
 * The command parser has already checked that `D` is a real date (DATE_INVALID), and `today` comes from
 * TodayResolver, so both are real dates when they get here. If one were not, this module still never
 * hands back a date that means nothing, and it does so without a code of its own: a `D` that is not a
 * real date is not a date on or after today (PAST_EXPIRY), and a shelf life cannot be counted from a
 * `today` that is not a date (DAYS_INVALID).
 */
export function expiryResolver(
  expiry: Expiry,
  today: DateISO,
): Result<{ readonly inboundDate: DateISO; readonly expirationDate: DateISO }, DomainError> {
  const now = readDay(today);

  if ('days' in expiry) {
    const { days } = expiry;
    if (!Number.isSafeInteger(days) || days < 0) {
      return fail('DAYS_INVALID', `a shelf life is a whole number of days, 0 or more, and this is ${days}`);
    }
    if (now === null) {
      return fail('DAYS_INVALID', `a shelf life of ${days} days cannot be counted from "${today}", which is not a calendar date`);
    }
    return { ok: true, value: { inboundDate: today, expirationDate: writeDay(now + days) } };
  }

  const last = readDay(expiry.date);
  if (last === null || now === null || last < now) {
    const advice = 'enter a shelf life of 0 or more days, or a date on or after today';
    return fail('PAST_EXPIRY', `the expiration date ${expiry.date} is not a date on or after today, ${today}: ${advice}`);
  }
  return { ok: true, value: { inboundDate: today, expirationDate: expiry.date } };
}
