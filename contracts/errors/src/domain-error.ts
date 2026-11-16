import type { ErrorCode } from './codes';

/**
 * A failure as a value (blueprint 1.2): the catalog code and an optional detail for people, for
 * example the field a parser rejected or every rule an invariant check found broken. The family
 * is not stored: it is `ERROR_FAMILY_OF[code]`.
 */
export type DomainError = { readonly code: ErrorCode; readonly detail?: string };
