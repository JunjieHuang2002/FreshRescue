import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DateISO } from '@freshrescue/contract-primitives';
import type { BatchView, ThresholdMap } from '@freshrescue/contract-views';
import { buildBatch } from '../../testing/fixtures';
import { batchStatusClassifier } from './batchStatusClassifier';

const THREE_DAYS: ThresholdMap = { 10: { days: 3, source: 'global' } };

/** The status of one batch of Food Type 10 that expires on `expirationDate`, looked at on `today`. */
const statusOn = (today: DateISO, expirationDate: DateISO, thresholds: ThresholdMap = THREE_DAYS): BatchView | undefined =>
  batchStatusClassifier([buildBatch({ id: 1, foodTypeId: 10, expirationDate })], thresholds, today)[0];

/** Whole days between two dates by the JavaScript calendar in UTC, which has no daylight saving. */
const reference = (from: string, to: string): number => {
  const utc = (date: string) => {
    const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
};

describe('BC-08 BatchStatusClassifier', () => {
  describe('the spec example (spec 4.3.4)', () => {
    // added on Oct 1, 2026 with a shelf life of 3 days: D_exp = Oct 4, and the default T_eff is 3
    const days = [
      ['2026-10-01', 3, 'nearExpiry'],
      ['2026-10-02', 2, 'nearExpiry'],
      ['2026-10-03', 1, 'nearExpiry'],
      ['2026-10-04', 0, 'nearExpiry'],
      ['2026-10-05', -1, 'expired'],
      ['2026-10-06', -2, 'expired'],
    ] as const;

    it.each(days)('on %s the item has %i days left and is %s', (today, daysLeft, status) => {
      expect(statusOn(today, '2026-10-04')).toMatchObject({ daysLeft, status });
    });

    it('is Near-Expiry from the moment it is added, stays so through Oct 4 (usable all day), and is Expired on Oct 5', () => {
      expect(statusOn('2026-10-01', '2026-10-04')?.status).toBe('nearExpiry');
      expect(statusOn('2026-10-04', '2026-10-04')?.status).toBe('nearExpiry');
      expect(statusOn('2026-10-05', '2026-10-04')?.status).toBe('expired');
    });

    it('makes any batch with a shelf life of at most T_eff Near-Expiry at inbound, and any with more Fresh', () => {
      for (const shelfLife of [0, 1, 2, 3]) {
        expect(statusOn('2026-10-01', `2026-10-0${1 + shelfLife}`)?.status).toBe('nearExpiry');
      }
      expect(statusOn('2026-10-01', '2026-10-05')?.status).toBe('fresh');
      expect(statusOn('2026-10-01', '2026-10-31')?.status).toBe('fresh');
    });
  });

  describe('the three states (spec 4.3.2)', () => {
    it('is Fresh while days left is more than T_eff, and Near-Expiry from the day days left equals T_eff', () => {
      expect(statusOn('2026-10-01', '2026-10-05')).toMatchObject({ daysLeft: 4, status: 'fresh' });
      expect(statusOn('2026-10-02', '2026-10-05')).toMatchObject({ daysLeft: 3, status: 'nearExpiry' });
    });

    it('is Expired when days left is below 0, and not before: expiring today is still Near-Expiry', () => {
      expect(statusOn('2026-10-04', '2026-10-04')).toMatchObject({ daysLeft: 0, status: 'nearExpiry' });
      expect(statusOn('2026-10-05', '2026-10-04')).toMatchObject({ daysLeft: -1, status: 'expired' });
    });

    it('lets a batch pass through the three states as the days go by', () => {
      const states = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']
        .map((today) => statusOn(today, '2026-10-06')?.status);

      expect(states).toEqual(['fresh', 'fresh', 'nearExpiry', 'nearExpiry', 'nearExpiry', 'nearExpiry', 'expired', 'expired', 'expired']);
    });
  });

  describe('the threshold of the Food Type', () => {
    it('uses the T_eff of the batch\'s own Food Type, so two batches of different Food Types differ', () => {
      const thresholds: ThresholdMap = { 10: { days: 7, source: 'foodType' }, 11: { days: 1, source: 'parent' } };
      const views = batchStatusClassifier(
        [buildBatch({ id: 1, foodTypeId: 10, expirationDate: '2026-10-08' }), buildBatch({ id: 2, foodTypeId: 11, expirationDate: '2026-10-08' })],
        thresholds,
        '2026-10-01',
      );

      expect(views.map((view) => view.status)).toEqual(['nearExpiry', 'fresh']);
    });

    it('gives every batch of a Food Type the same T_eff', () => {
      const thresholds: ThresholdMap = { 10: { days: 2, source: 'child' } };
      const views = batchStatusClassifier(
        [2, 3, 4].map((day) => buildBatch({ id: day, foodTypeId: 10, expirationDate: `2026-10-0${day}` })),
        thresholds,
        '2026-10-01',
      );

      expect(views.map((view) => view.status)).toEqual(['nearExpiry', 'nearExpiry', 'fresh']);
    });

    it('uses the global 3 days for a batch whose Food Type is not in the map', () => {
      expect(statusOn('2026-10-01', '2026-10-04', {})?.status).toBe('nearExpiry');
      expect(statusOn('2026-10-01', '2026-10-05', {})?.status).toBe('fresh');
    });
  });

  describe('the view of a batch', () => {
    it('carries every field of the batch, plus daysLeft and status, in the order given', () => {
      const batches = [
        buildBatch({ id: 7, foodTypeId: 10, quantity: 1500, inboundDate: '2026-09-30', expirationDate: '2026-10-09', createdSeq: 4 }),
        buildBatch({ id: 3, foodTypeId: 10, quantity: 250, inboundDate: '2026-10-01', expirationDate: '2026-10-02', createdSeq: 9 }),
      ];

      expect(batchStatusClassifier(batches, THREE_DAYS, '2026-10-01')).toEqual([
        { id: 7, foodTypeId: 10, quantity: 1500, inboundDate: '2026-09-30', expirationDate: '2026-10-09', createdSeq: 4, daysLeft: 8, status: 'fresh' },
        { id: 3, foodTypeId: 10, quantity: 250, inboundDate: '2026-10-01', expirationDate: '2026-10-02', createdSeq: 9, daysLeft: 1, status: 'nearExpiry' },
      ]);
      expectTypeOf(batchStatusClassifier).returns.toEqualTypeOf<BatchView[]>();
    });

    it('gives an Expired batch a negative daysLeft, which the text "expired N days ago" is built from (spec 4.2.1)', () => {
      expect(statusOn('2026-10-10', '2026-10-04')).toMatchObject({ daysLeft: -6, status: 'expired' });
    });

    it('returns nothing for no batch', () => {
      expect(batchStatusClassifier([], THREE_DAYS, '2026-10-01')).toEqual([]);
    });
  });

  describe('the calendar', () => {
    it('counts days left across month ends, year ends and leap days', () => {
      expect(statusOn('2026-10-30', '2026-11-02')?.daysLeft).toBe(3);
      expect(statusOn('2026-12-30', '2027-01-02')?.daysLeft).toBe(3);
      expect(statusOn('2028-02-28', '2028-03-01')?.daysLeft).toBe(2);
      expect(statusOn('2027-02-28', '2027-03-01')?.daysLeft).toBe(1);
      expect(statusOn('2026-01-01', '2027-01-01')?.daysLeft).toBe(365);
      expect(statusOn('2028-01-01', '2029-01-01')?.daysLeft).toBe(366);
    });

    it('agrees with the JavaScript calendar for dates from 1999 to 2101', () => {
      let checked = 0;
      for (let day = Date.UTC(1999, 0, 1); day <= Date.UTC(2101, 11, 31); day += 86_400_000 * 7) {
        const today = new Date(day).toISOString().slice(0, 10);
        for (const offset of [-400, -31, -1, 0, 1, 3, 4, 28, 29, 30, 365, 1000]) {
          const expirationDate = new Date(day + offset * 86_400_000).toISOString().slice(0, 10);
          expect(statusOn(today, expirationDate)?.daysLeft).toBe(reference(today, expirationDate));
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(5000);
    });

    it('does not depend on the time zone: a day on which daylight saving changes is still 1 day', () => {
      // the test runner pins America/New_York, where 2026-03-08 has 23 hours and 2026-11-01 has 25
      expect(statusOn('2026-03-08', '2026-03-09')?.daysLeft).toBe(1);
      expect(statusOn('2026-11-01', '2026-11-02')?.daysLeft).toBe(1);
      expect(statusOn('2026-11-01', '2026-11-08')?.daysLeft).toBe(7);
    });

    it('follows Simulated Today: the same batch is Expired when today is set three days ahead (spec 4.3.4)', () => {
      // a batch with a 2-day shelf life, added on Oct 1
      expect(statusOn('2026-10-01', '2026-10-03')?.status).toBe('nearExpiry');
      expect(statusOn('2026-10-04', '2026-10-03')?.status).toBe('expired');
    });
  });

  it('counts a batch as Expired when a date cannot be read, and does not throw', () => {
    expect(() => statusOn('2026-10-01', 'not a date')).not.toThrow();
    expect(statusOn('2026-10-01', 'not a date')?.status).toBe('expired');
    expect(statusOn('today', '2026-10-04')?.status).toBe('expired');
  });

  it('gives the same answer twice and leaves its input alone', () => {
    const batches = [buildBatch({ id: 1, foodTypeId: 10 })];
    const before = JSON.stringify(batches);

    expect(batchStatusClassifier(batches, THREE_DAYS, '2026-10-02')).toEqual(batchStatusClassifier(batches, THREE_DAYS, '2026-10-02'));
    expect(JSON.stringify(batches)).toBe(before);
  });
});
