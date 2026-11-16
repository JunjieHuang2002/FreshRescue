/**
 * What AppCoordinator needs of the clock (blueprint 1.7, FG-02): a call at every local midnight. The
 * frontend works out no date itself; the call only says that the backend's `today` may have moved on.
 */
export type MidnightTimerPort = {
  /** Calls `callback` once at every local 00:00 from now on. The function it returns stops it. */
  subscribe(callback: () => void): () => void;
};

/** The local calendar day of a moment, as a text that tells two days apart. */
const dayOf = (moment: Date): string => `${moment.getFullYear()}-${moment.getMonth() + 1}-${moment.getDate()}`;

/**
 * The milliseconds from `moment` to the next local 00:00. The local calendar finds that midnight, so a
 * day on which daylight saving time starts (23 hours) or ends (25 hours) is counted right.
 */
const untilMidnight = (moment: Date): number =>
  new Date(moment.getFullYear(), moment.getMonth(), moment.getDate() + 1).getTime() - moment.getTime();

/**
 * FG-02 MidnightTimerGateway. Each subscription arms a timer for the next local midnight. When it
 * fires, the callback is called once if the local date has really changed, and the timer is armed again
 * for the midnight after. A timer that fires a moment early (the clock was moved back) waits for the real
 * midnight instead, and one that fires late (the device slept through midnight) calls back once.
 * Unsubscribing clears the timer, also from inside the callback. Nothing is touched until `subscribe`.
 */
export function createMidnightTimerGateway(): MidnightTimerPort {
  return {
    subscribe(callback) {
      let active = true;
      let day = dayOf(new Date());
      let timer: ReturnType<typeof setTimeout> | undefined;
      const arm = (): void => {
        timer = setTimeout(() => {
          const now = new Date();
          if (dayOf(now) !== day) {
            day = dayOf(now);
            callback();
          }
          if (active) arm();
        }, untilMidnight(new Date()));
      };
      arm();
      return () => {
        active = false;
        clearTimeout(timer);
      };
    },
  };
}
