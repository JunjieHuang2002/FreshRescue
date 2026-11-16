import type { Brand } from './brand';
import type { QtyMilli } from './quantity';

// Validators return these types and deciders accept only these types, so unvalidated data
// cannot reach a state change (blueprint 1.1, "Validated types").

/** A name that passed NameValidator: trimmed, 1 to 200 characters, unique in its scope. */
export type ValidName = Brand<string, 'ValidName'>;

/** A quantity that passed ScalarValidator: an integer between 1 and 500,000,000 thousandths. */
export type ValidQty = Brand<QtyMilli, 'ValidQty'>;

/** A unit that passed ScalarValidator: one of the six units of the unit list. */
export type ValidUnit = Brand<string, 'ValidUnit'>;

/** A near-expiry threshold that passed ScalarValidator: a whole number of days, at least 1. */
export type ValidThreshold = Brand<number, 'ValidThreshold'>;
