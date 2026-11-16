import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DateISO } from '@freshrescue/contract-primitives';
import { todayResolver } from './todayResolver';

describe('BC-01 TodayResolver', () => {
  it('uses the device date when Simulated Today is not set', () => {
    expect(todayResolver('2026-11-13', null)).toBe('2026-11-13');
  });

  it('lets Simulated Today replace the device date, in the past or in the future (spec section 3)', () => {
    expect(todayResolver('2026-11-13', '2026-10-01')).toBe('2026-10-01');
    expect(todayResolver('2026-11-13', '2027-01-31')).toBe('2027-01-31');
    expect(todayResolver('2026-11-13', '2026-11-13')).toBe('2026-11-13');
  });

  it('returns a date and nothing can fail: there is no error to return', () => {
    expectTypeOf(todayResolver).returns.toEqualTypeOf<DateISO>();
    expect(todayResolver('2026-11-13', null)).not.toHaveProperty('ok');
  });

  it('gives the same answer for the same input', () => {
    expect(todayResolver('2026-11-13', '2026-12-01')).toBe(todayResolver('2026-11-13', '2026-12-01'));
  });
});
