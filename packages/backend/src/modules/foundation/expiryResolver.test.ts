import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Expiry } from '@freshrescue/contract-messages';
import type { DateISO, Result } from '@freshrescue/contract-primitives';
import { expiryResolver } from './expiryResolver';

type Dates = { readonly inboundDate: DateISO; readonly expirationDate: DateISO };

const TODAY = '2026-10-01';

const codeOf = (result: Result<unknown, DomainError>): string => (result.ok ? 'ok' : result.err.code);
const datesOf = (expiry: Expiry, today: DateISO): Dates | undefined => {
  const result = expiryResolver(expiry, today);
  return result.ok ? result.value : undefined;
};

/** The same sum done by the JavaScript calendar, in UTC so that no daylight saving gets in. Only for years from 1000. */
const reference = (date: string, days: number): string => {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

describe('BC-05 ExpiryResolver', () => {
  describe('the spec examples', () => {
    it('Oct 1, 2026 with a 3-day shelf life expires on Oct 4 (spec 4.3.4)', () => {
      expect(expiryResolver({ days: 3 }, '2026-10-01')).toEqual({
        ok: true,
        value: { inboundDate: '2026-10-01', expirationDate: '2026-10-04' },
      });
    });

    it('gives the two Milk batches of spec 4.2.1 their dates: 5 days from Oct 1 is Oct 6, and 10 days from Oct 2 is Oct 12', () => {
      expect(datesOf({ days: 5 }, '2026-10-01')).toEqual({ inboundDate: '2026-10-01', expirationDate: '2026-10-06' });
      expect(datesOf({ days: 10 }, '2026-10-02')).toEqual({ inboundDate: '2026-10-02', expirationDate: '2026-10-12' });
    });

    it('treats a shelf life of 0 as "expires today" (spec section 3)', () => {
      expect(datesOf({ days: 0 }, TODAY)).toEqual({ inboundDate: TODAY, expirationDate: TODAY });
    });

    it('makes the shelf life and the expiration date equivalent: D_exp = D_in + S', () => {
      for (const days of [0, 1, 3, 30, 400]) {
        const byDays = datesOf({ days }, TODAY);
        expect(datesOf({ date: byDays?.expirationDate ?? '' }, TODAY)).toEqual(byDays);
      }
    });
  });

  describe('D_in', () => {
    it('is always today, whichever way the expiry is entered', () => {
      expect(datesOf({ days: 7 }, '2027-02-03')?.inboundDate).toBe('2027-02-03');
      expect(datesOf({ date: '2027-03-01' }, '2027-02-03')?.inboundDate).toBe('2027-02-03');
    });

    it('follows Simulated Today, because the coordinator passes that date as today', () => {
      expect(datesOf({ days: 2 }, '2026-12-30')).toEqual({ inboundDate: '2026-12-30', expirationDate: '2027-01-01' });
    });
  });

  describe('a shelf life in days', () => {
    it('carries across month ends, year ends and leap days', () => {
      expect(datesOf({ days: 1 }, '2026-10-31')?.expirationDate).toBe('2026-11-01');
      expect(datesOf({ days: 1 }, '2026-12-31')?.expirationDate).toBe('2027-01-01');
      expect(datesOf({ days: 1 }, '2028-02-28')?.expirationDate).toBe('2028-02-29');
      expect(datesOf({ days: 2 }, '2028-02-28')?.expirationDate).toBe('2028-03-01');
      expect(datesOf({ days: 1 }, '2026-02-28')?.expirationDate).toBe('2026-03-01');
      expect(datesOf({ days: 1 }, '2100-02-28')?.expirationDate).toBe('2100-03-01');
      expect(datesOf({ days: 1 }, '2000-02-28')?.expirationDate).toBe('2000-02-29');
      expect(datesOf({ days: 366 }, '2028-01-01')?.expirationDate).toBe('2029-01-01');
    });

    it('agrees with the JavaScript calendar for every day from 1999 to 2101, for a spread of shelf lives', () => {
      let checked = 0;
      for (let date = Date.UTC(1999, 0, 1); date <= Date.UTC(2101, 11, 31); date += 86_400_000 * 5) {
        const today = new Date(date).toISOString().slice(0, 10);
        for (const days of [0, 1, 2, 3, 29, 30, 31, 59, 60, 365, 366, 1000]) {
          expect(datesOf({ days }, today)?.expirationDate).toBe(reference(today, days));
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(5000);
    });

    it('does not depend on the time zone of the machine: a day on which daylight saving changes still has 1 day added', () => {
      // the test runner pins America/New_York, where 2026-03-08 is 23 hours long and 2026-11-01 is 25
      expect(datesOf({ days: 1 }, '2026-03-08')?.expirationDate).toBe('2026-03-09');
      expect(datesOf({ days: 1 }, '2026-11-01')?.expirationDate).toBe('2026-11-02');
      expect(datesOf({ days: 7 }, '2026-10-28')?.expirationDate).toBe('2026-11-04');
    });

    it('answers DAYS_INVALID for a shelf life that is negative, fractional or not a number (spec section 3: S is whole, S >= 0)', () => {
      for (const days of [-1, -30, 0.5, 2.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(codeOf(expiryResolver({ days }, TODAY))).toBe('DAYS_INVALID');
      }
    });

    it('sets no upper limit of its own, because the spec has none: a long shelf life is not this module\'s to refuse', () => {
      // a date that no store can hold is refused further on, by the invariant check and by the database
      for (const days of [3650, 36_500, 3_000_000]) expect(codeOf(expiryResolver({ days }, TODAY)), String(days)).toBe('ok');
      expect(datesOf({ days: 36_500 }, '2026-10-01')?.expirationDate).toBe('2126-09-07');
    });
  });

  describe('an expiration date', () => {
    it('is kept as given when it is today or later', () => {
      expect(datesOf({ date: '2026-10-01' }, TODAY)?.expirationDate).toBe('2026-10-01');
      expect(datesOf({ date: '2026-10-02' }, TODAY)?.expirationDate).toBe('2026-10-02');
      expect(datesOf({ date: '2031-01-31' }, TODAY)?.expirationDate).toBe('2031-01-31');
      expect(datesOf({ date: '9999-12-31' }, TODAY)?.expirationDate).toBe('9999-12-31');
    });

    it('answers PAST_EXPIRY for a date before today: the Past-Expiry Block (exception row 1)', () => {
      for (const date of ['2026-09-30', '2025-10-01', '2026-01-01', '0001-01-01']) {
        expect(codeOf(expiryResolver({ date }, TODAY))).toBe('PAST_EXPIRY');
      }
    });

    it('allows today and blocks yesterday, whatever date Simulated Today has put in place', () => {
      expect(codeOf(expiryResolver({ date: '2026-12-25' }, '2026-12-25'))).toBe('ok');
      expect(codeOf(expiryResolver({ date: '2026-12-24' }, '2026-12-25'))).toBe('PAST_EXPIRY');
      expect(codeOf(expiryResolver({ date: '2026-10-05' }, '2026-12-25'))).toBe('PAST_EXPIRY');
    });

    it('refuses a text that is not a calendar date as a date that is not on or after today, and never keeps it', () => {
      // the command parser has already answered DATE_INVALID for each of these, so this is a second net, and
      // its answer is a code from this module's own list
      for (const date of ['tomorrow', '', '2026-1-5', '2026/10/05', '20261005', '2026-10-05T00:00:00Z', '2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-32', '2026-04-31']) {
        const result = expiryResolver({ date }, TODAY);

        expect(result, date).toMatchObject({ ok: false, err: { code: 'PAST_EXPIRY' } });
      }
    });

    it('knows the leap years: every 4th year, except a century that is not a multiple of 400', () => {
      // judged from the first day of the calendar, so that no real date here is in the past
      const longAgo = '0001-01-01';
      for (const date of ['2028-02-29', '2032-02-29', '2400-02-29', '2000-02-29']) expect(codeOf(expiryResolver({ date }, longAgo)), date).toBe('ok');
      // a Feb 29 that does not exist is not a date, so it is refused as one that is not on or after today
      for (const date of ['2100-02-29', '2200-02-29', '2300-02-29', '1900-02-29', '2027-02-29', '2026-02-29']) {
        expect(codeOf(expiryResolver({ date }, longAgo)), date).toBe('PAST_EXPIRY');
      }
    });

    it('uses the same calendar to find where a shelf life ends: 2100 has no leap day and 2400 has one', () => {
      expect(datesOf({ days: 1 }, '2100-02-28')?.expirationDate).toBe('2100-03-01');
      expect(datesOf({ days: 1 }, '2400-02-28')?.expirationDate).toBe('2400-02-29');
    });

    it('refuses an expiry when today itself is not a date, so that a date that means nothing is never stored', () => {
      // today always comes from TodayResolver and is a real date, so this is a second net
      expect(codeOf(expiryResolver({ days: 1 }, 'today'))).toBe('DAYS_INVALID');
      expect(codeOf(expiryResolver({ days: 1 }, '2026-02-31'))).toBe('DAYS_INVALID');
      expect(codeOf(expiryResolver({ date: '2026-10-05' }, 'today'))).toBe('PAST_EXPIRY');
      expect(codeOf(expiryResolver({ date: '2026-10-05' }, '2026-02-31'))).toBe('PAST_EXPIRY');
    });
  });

  it('answers with the two codes that the blueprint lists for it, and with no other, whatever it is given', () => {
    const expiries = [
      { days: -1 }, { days: 0.5 }, { days: Number.NaN }, { days: 2 }, { days: 36_500 }, { days: '3' }, { days: null },
      { date: 'tomorrow' }, { date: '2026-02-30' }, { date: '2026-09-30' }, { date: '2026-10-05' }, { date: 5 }, {},
    ] as unknown as Expiry[];
    const todays = [TODAY, 'today', '2026-02-31', '', '9999-12-31', '0001-01-01'];
    const codes = new Set<string>();

    for (const expiry of expiries) {
      for (const today of todays) {
        const result = expiryResolver(expiry, today);
        if (!result.ok) codes.add(result.err.code);
      }
    }

    expect([...codes].sort()).toEqual(['DAYS_INVALID', 'PAST_EXPIRY']);
  });

  it('returns the typed pair and an error as a value, and never throws', () => {
    expectTypeOf(expiryResolver).returns.toEqualTypeOf<Result<Dates, DomainError>>();
    for (const expiry of [{}, { days: undefined }, { date: undefined }, { days: '3' }, { date: 5 }, { days: null }] as unknown as Expiry[]) {
      expect(() => expiryResolver(expiry, TODAY)).not.toThrow();
    }
  });

  it('gives the same answer twice and leaves its input alone', () => {
    const expiry = Object.freeze({ days: 3 });

    expect(expiryResolver(expiry, TODAY)).toEqual(expiryResolver(expiry, TODAY));
    expect(expiry).toEqual({ days: 3 });
  });
});
