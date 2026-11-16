/**
 * The result of a step that can fail. Errors are values (blueprint 1.1): `Ok` carries `value`,
 * `Err` carries `err`. No helper builds one: a module writes `{ ok: true, value }` itself.
 */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly err: E };

/** The payload of a message that carries nothing: `{}`. */
export type Empty = Readonly<Record<string, never>>;
