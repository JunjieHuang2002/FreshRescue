import { describe, expect, it } from 'vitest';
import { createFixedClock } from './fixedClock';

describe('createFixedClock', () => {
  it('says the date it was given', () => {
    expect(createFixedClock('2026-10-01').today()).toBe('2026-10-01');
  });

  it('says it every time: it is fixed, and time does not pass in it', () => {
    const clock = createFixedClock('2026-10-01');

    expect([clock.today(), clock.today(), clock.today()]).toEqual(['2026-10-01', '2026-10-01', '2026-10-01']);
  });

  it('is a clock of its own: a second clock does not change the first, which is how a test lets a day go by', () => {
    const first = createFixedClock('2026-10-01');
    const second = createFixedClock('2026-10-05');

    expect([first.today(), second.today()]).toEqual(['2026-10-01', '2026-10-05']);
  });

  it('reads no real clock: it says what it was told even for a date long past or far off', () => {
    expect(createFixedClock('1999-12-31').today()).toBe('1999-12-31');
    expect(createFixedClock('2999-01-01').today()).toBe('2999-01-01');
  });
});
