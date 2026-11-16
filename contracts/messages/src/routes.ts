/**
 * The two routes (blueprint 3.4). Both are `POST`, and each carries one kind of message: a command
 * envelope has `type` and `payload`, a query envelope has `type` and `params`. A URL that is not
 * one of these answers 404.
 */
export const ROUTES = {
  command: '/api/command',
  query: '/api/query',
} as const;

export type RouteName = keyof typeof ROUTES;

export const ROUTE_METHOD = 'POST';
