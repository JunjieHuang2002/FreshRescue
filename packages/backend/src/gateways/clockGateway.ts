import type { DateISO } from '@freshrescue/contract-primitives';
import type { ClockPort } from './ports';

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/**
 * BG-04 ClockGateway. Reads the device's calendar date, which is what spec 4.3.4 calls `D_now` when no
 * Simulated Today is set. The backend runs on the user's own machine, so its clock is the device's
 * (blueprint 1.1, "Time").
 *
 * The date is the one on the local calendar, from `getFullYear`, `getMonth` and `getDate`, never from
 * `toISOString()`: that one gives the date in UTC, which on a New York evening is already tomorrow and
 * would put every status a day ahead (plan, "Risks and watch-outs"). The clock is read at each call,
 * so a date that changes at midnight is seen by the next request.
 */
export function createClockGateway(): ClockPort {
  return {
    today: (): DateISO => {
      const now = new Date();
      return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
    },
  };
}
