/**
 * A quantity in whole thousandths: 1.5 kg is 1500 (spec section 3). Quantities are thousandths in
 * the entities, the messages, the seed file and the store. Decimal text exists only in the browser.
 */
export type QtyMilli = number;
