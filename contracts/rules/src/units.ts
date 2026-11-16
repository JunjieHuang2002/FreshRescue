/**
 * The fixed list of units (spec section 3). A Food Type has one of them. They match by exact
 * equality and there is no conversion: `kg` is not `grams`.
 */
export const UNIT_LIST = ['grams', 'kg', 'ml', 'liters', 'pieces', 'cartons'] as const;

export type Unit = (typeof UNIT_LIST)[number];
