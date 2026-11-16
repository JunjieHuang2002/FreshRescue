/**
 * The ids of the two system categories named `Other`, one in each tree. They are reserved: ids 1
 * and 2 are never allocated to anything else (plan, phase 2, "Ids").
 */
export const SYSTEM_IDS = {
  FOOD_OTHER: 1,
  CUISINE_OTHER: 2,
} as const;

/** The first id that the counter hands out. */
export const FIRST_FREE_ID = 3;
