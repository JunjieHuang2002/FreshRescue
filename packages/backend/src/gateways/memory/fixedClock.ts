import type { DateISO } from '@freshrescue/contract-primitives';
import type { ClockPort } from '../ports';

/**
 * The in-memory stand-in for ClockGateway (BG-04, phase 7): a clock that always says the same date, so a
 * test decides what "today" is. A test that needs time to pass builds a second clock with the later date
 * and a second coordinator over the same store.
 */
export function createFixedClock(date: DateISO): ClockPort {
  return { today: () => date };
}
