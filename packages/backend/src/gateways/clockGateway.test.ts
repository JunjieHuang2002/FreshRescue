import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClockGateway } from './clockGateway';

// The clock gives the date on the local calendar, not in UTC (plan, phase 7, row 6). The node project pins
// the time zone to America/New_York, so each instant below is written in UTC and means the same local
// time on every machine.

/** The date the clock gives at one instant. */
function todayAt(instant: string): string {
  vi.setSystemTime(new Date(instant));
  return createClockGateway().today();
}

describe('createClockGateway', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs where the time zone is pinned to New York, which every case below assumes', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/New_York');
    expect(new Date('2026-11-13T04:30:00Z').getTimezoneOffset()).toBe(300);
    expect(new Date('2026-07-01T12:00:00Z').getTimezoneOffset()).toBe(240);
  });

  it('gives Nov 12 at 23:30 on Nov 12 in New York, when it is already Nov 13 in UTC', () => {
    expect(new Date('2026-11-13T04:30:00Z').toISOString().slice(0, 10)).toBe('2026-11-13');
    expect(todayAt('2026-11-13T04:30:00Z')).toBe('2026-11-12');
  });

  it('turns to the next date at local midnight, not before', () => {
    expect(todayAt('2026-11-13T04:59:59.999Z')).toBe('2026-11-12');
    expect(todayAt('2026-11-13T05:00:00Z')).toBe('2026-11-13');
  });

  it('gives the local date on the day daylight saving ends (Nov 1, 2026), also in the hour that happens twice and at 23:30', () => {
    expect(todayAt('2026-11-01T05:30:00Z')).toBe('2026-11-01'); // 01:30 EDT
    expect(todayAt('2026-11-01T06:30:00Z')).toBe('2026-11-01'); // 01:30 EST, one hour later
    expect(todayAt('2026-11-02T04:30:00Z')).toBe('2026-11-01'); // 23:30 EST, Nov 2 in UTC
    expect(todayAt('2026-11-02T05:00:00Z')).toBe('2026-11-02'); // midnight
  });

  it('gives the local date on the day daylight saving starts (Mar 8, 2026), on both sides of the skipped hour and at 23:30', () => {
    expect(todayAt('2026-03-08T06:59:00Z')).toBe('2026-03-08'); // 01:59 EST
    expect(todayAt('2026-03-08T07:00:00Z')).toBe('2026-03-08'); // 03:00 EDT: 02:00 to 03:00 does not exist
    expect(todayAt('2026-03-09T03:30:00Z')).toBe('2026-03-08'); // 23:30 EDT, Mar 9 in UTC
    expect(todayAt('2026-03-09T04:00:00Z')).toBe('2026-03-09'); // midnight
  });

  it('writes the date as YYYY-MM-DD, with leading zeros, also across the end of a year and on Feb 29', () => {
    expect(todayAt('2026-01-05T17:00:00Z')).toBe('2026-01-05');
    expect(todayAt('2027-01-01T04:59:00Z')).toBe('2026-12-31');
    expect(todayAt('2028-02-29T12:00:00Z')).toBe('2028-02-29');
  });

  it('reads the clock at every call, so a running server sees the next day without a restart', () => {
    const clock = createClockGateway();
    vi.setSystemTime(new Date('2026-11-13T04:59:00Z'));
    expect(clock.today()).toBe('2026-11-12');
    vi.setSystemTime(new Date('2026-11-13T05:01:00Z'));
    expect(clock.today()).toBe('2026-11-13');
  });
});
