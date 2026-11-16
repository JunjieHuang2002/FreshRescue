/**
 * The id of any record. One counter serves every kind of record, so an id names one record in the
 * whole system. Ids are positive integers and are never reused (plan, phase 2, "Ids").
 */
export type Id = number;

/** A record with an id and a name: a Food Type, a recipe or a category. NameSorter orders these. */
export type Named = { readonly id: Id; readonly name: string };
