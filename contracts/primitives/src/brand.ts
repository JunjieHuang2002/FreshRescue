declare const brand: unique symbol;

/**
 * A value of type `T` that only a validator may produce. The brand `B` makes it a different type
 * from a plain `T`, so unvalidated data cannot be passed where a validated value is required.
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
