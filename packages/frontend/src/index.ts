// Public surface of the frontend package, used by apps/web: what its composition root wires together
// (the app coordinator and the three gateways) and the ports they meet at, plus the 16 slot ids and
// the attribute that names a slot, which the page renders as empty elements for the DOM host to paint
// into. An app imports its own package only, so the slot ids of the `ui` contract are passed on here.
// Modules and the sub-coordinators stay inside the package.
export { SLOT_IDS } from '@freshrescue/contract-ui';
export type { SlotId } from '@freshrescue/contract-ui';
export { createAppCoordinator } from './coordinators/AppCoordinator';
export { createApiGateway } from './gateways/apiGateway';
export type { ApiGatewayOptions, ApiPort } from './gateways/apiGateway';
export { createDomHostGateway, SLOT_ATTRIBUTE } from './gateways/domHostGateway';
export type { DomHostPort } from './gateways/domHostGateway';
export { createMidnightTimerGateway } from './gateways/midnightTimerGateway';
export type { MidnightTimerPort } from './gateways/midnightTimerGateway';
