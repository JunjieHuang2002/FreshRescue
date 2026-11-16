import { createApiGateway, createAppCoordinator, createDomHostGateway, createMidnightTimerGateway } from '@freshrescue/frontend';

/** What the page does with the app: start it when it mounts, stop it when it unmounts. */
export type ComposedApp = {
  readonly start: () => void;
  readonly stop: () => void;
};

/**
 * The web app's composition root (plan, phase 9). It is the only place where the real gateways (the
 * browser's `fetch`, the `document` and its timers) meet the coordinators: it creates the three
 * gateways and the app coordinator, which creates its five sub-coordinators, and wires them together.
 * It holds no logic.
 *
 * The gateways touch the browser only when they are used, never when they are created, so creating the
 * app is safe anywhere. `start` paints the frame, loads the reference data and the first screen, and
 * starts the midnight timer; `stop` detaches the page listeners and cancels the timer. The API is
 * reached through the page's own `/api/*`, which Next forwards to Express.
 */
export function composeApp(): ComposedApp {
  const app = createAppCoordinator({
    api: createApiGateway(),
    dom: createDomHostGateway(),
    timer: createMidnightTimerGateway(),
  });
  return {
    start: () => {
      void app.start();
    },
    stop: () => app.stop(),
  };
}
