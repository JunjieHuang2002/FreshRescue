import type { DateISO } from '@freshrescue/contract-primitives';

/**
 * BC-01 TodayResolver. Picks `D_now` (spec 4.3.4): Simulated Today replaces the device date
 * everywhere when it is set, and the device date is used otherwise. The backend coordinator calls
 * it once per request and passes the answer on, so every figure of a request is derived for the same
 * date. The device date arrives as an argument because a pure module reads no clock.
 */
export function todayResolver(deviceToday: DateISO, simulatedToday: DateISO | null): DateISO {
  return simulatedToday ?? deviceToday;
}
