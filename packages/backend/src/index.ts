// Public surface of the backend package, used by apps/api: what its composition root wires together
// (the backend coordinator, the five gateways, the MySQL pool and the migration runner) and the ports
// they meet at. Modules stay inside the package.
export { createBackendCoordinator } from './coordinators/BackendCoordinator';
export { createClockGateway } from './gateways/clockGateway';
export { createHttpServerGateway } from './gateways/httpServerGateway';
export type { HttpServer, HttpServerOptions } from './gateways/httpServerGateway';
export { migrate } from './gateways/mysql/migrate';
export { closeMysqlPool, createMysqlPool } from './gateways/mysql/pool';
export type { ClockPort, SeedSourcePort, StoreReadPort, StoreWritePort } from './gateways/ports';
export { createSeedSourceGateway } from './gateways/seedSourceGateway';
export { createStoreReadGateway } from './gateways/storeReadGateway';
export { createStoreWriteGateway } from './gateways/storeWriteGateway';
