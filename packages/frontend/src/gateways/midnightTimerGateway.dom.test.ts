import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMidnightTimerGateway } from './midnightTimerGateway';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** The local time of the fake clock as `YYYY-MM-DD hh:mm`. */
const localNow = (): string => {
  const now = new Date();
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`;
};

/** Subscribes, and records the local time of every call. */
function subscribeAt(start: Date) {
  vi.setSystemTime(start);
  const calls: string[] = [];
  const unsubscribe = createMidnightTimerGateway().subscribe(() => calls.push(localNow()));
  return { calls, unsubscribe };
}

describe('midnightTimerGateway', () => {
  it('runs in the time zone of New York, which the dom project pins, so the midnights below are the same on every machine', () => {
    expect(new Date(2026, 9, 1).getTimezoneOffset()).toBe(240);
    expect(new Date(2026, 11, 1).getTimezoneOffset()).toBe(300);
  });

  it('calls back once at the next local midnight, and not before', () => {
    const { calls } = subscribeAt(new Date(2026, 9, 1, 23, 59, 59));
    vi.advanceTimersByTime(999);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['2026-10-02 00:00']);
  });

  it('calls back once at every midnight after that, and never in between', () => {
    const { calls } = subscribeAt(new Date(2026, 9, 1, 12, 0));
    vi.advanceTimersByTime(12 * HOUR - 1);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1 + 24 * HOUR - 1);
    expect(calls).toEqual(['2026-10-02 00:00']);
    vi.advanceTimersByTime(1 + 24 * HOUR);
    expect(calls).toEqual(['2026-10-02 00:00', '2026-10-03 00:00', '2026-10-04 00:00']);
  });

  it('follows the local calendar, not UTC: at UTC midnight it is 19:00 in New York and nothing happens', () => {
    const { calls } = subscribeAt(new Date(2026, 10, 12, 18, 0));
    vi.advanceTimersByTime(HOUR);
    expect(new Date().toISOString()).toBe('2026-11-13T00:00:00.000Z');
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(5 * HOUR);
    expect(calls).toEqual(['2026-11-13 00:00']);
  });

  it('counts a day of 23 hours right, when daylight saving time starts (Mar 8, 2026)', () => {
    const { calls } = subscribeAt(new Date(2026, 2, 7, 23, 0));
    vi.advanceTimersByTime(HOUR);
    expect(calls).toEqual(['2026-03-08 00:00']);
    vi.advanceTimersByTime(23 * HOUR - 1);
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['2026-03-08 00:00', '2026-03-09 00:00']);
  });

  it('counts a day of 25 hours right, when daylight saving time ends (Nov 1, 2026)', () => {
    const { calls } = subscribeAt(new Date(2026, 9, 31, 23, 0));
    vi.advanceTimersByTime(HOUR);
    expect(calls).toEqual(['2026-11-01 00:00']);
    vi.advanceTimersByTime(25 * HOUR - 1);
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['2026-11-01 00:00', '2026-11-02 00:00']);
  });

  it('waits for the real midnight when its timer fires early, because the clock was set back', () => {
    const { calls } = subscribeAt(new Date(2026, 9, 1, 23, 0));
    vi.setSystemTime(new Date(2026, 9, 1, 22, 0));
    vi.advanceTimersByTime(HOUR);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(HOUR);
    expect(calls).toEqual(['2026-10-02 00:00']);
  });

  it('waits for the real midnight when its timer fires early after a midnight has already passed', () => {
    const { calls } = subscribeAt(new Date(2026, 9, 1, 23, 0));
    vi.advanceTimersByTime(HOUR);
    expect(calls).toEqual(['2026-10-02 00:00']);
    vi.setSystemTime(new Date(2026, 9, 1, 22, 0));
    vi.advanceTimersByTime(24 * HOUR);
    expect(calls).toEqual(['2026-10-02 00:00']);
    vi.advanceTimersByTime(2 * HOUR);
    expect(calls).toEqual(['2026-10-02 00:00', '2026-10-03 00:00']);
  });

  it('calls back once, not once per missed midnight, when the device slept through several', () => {
    const { calls } = subscribeAt(new Date(2026, 9, 1, 23, 0));
    vi.setSystemTime(new Date(2026, 9, 3, 10, 0));
    vi.advanceTimersByTime(HOUR);
    expect(calls).toEqual(['2026-10-03 11:00']);
    vi.advanceTimersByTime(13 * HOUR);
    expect(calls).toEqual(['2026-10-03 11:00', '2026-10-04 00:00']);
  });

  it('stops when it is unsubscribed, and leaves no timer behind', () => {
    const { calls, unsubscribe } = subscribeAt(new Date(2026, 9, 1, 23, 0));
    expect(vi.getTimerCount()).toBe(1);
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(48 * HOUR);
    expect(calls).toEqual([]);
  });

  it('arms no new timer when the callback itself unsubscribes', () => {
    vi.setSystemTime(new Date(2026, 9, 1, 23, 0));
    let calls = 0;
    const unsubscribe = createMidnightTimerGateway().subscribe(() => {
      calls += 1;
      unsubscribe();
    });
    vi.advanceTimersByTime(HOUR);
    expect(calls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps each subscription on its own timer', () => {
    vi.setSystemTime(new Date(2026, 9, 1, 23, 0));
    const timer = createMidnightTimerGateway();
    let first = 0;
    let second = 0;
    const stopFirst = timer.subscribe(() => (first += 1));
    timer.subscribe(() => (second += 1));
    expect(vi.getTimerCount()).toBe(2);
    stopFirst();
    vi.advanceTimersByTime(HOUR);
    expect([first, second]).toEqual([0, 1]);
  });

  it('touches no timer until it is subscribed to', () => {
    createMidnightTimerGateway();
    expect(vi.getTimerCount()).toBe(0);
  });
});
