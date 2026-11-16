import type { Empty, Id } from '@freshrescue/contract-primitives';

/** The 6 queries (blueprint 3.4), one name per line. */
export const QUERY_TYPES = [
  'GetReferenceData',
  'GetInventoryList',
  'GetFoodTypeDetail',
  'GetWarningPanel',
  'GetRecommendations',
  'GetCatalog',
] as const;

export type QueryType = (typeof QUERY_TYPES)[number];

/** What each query carries. A query changes nothing. */
export type QueryParams = {
  GetReferenceData: Empty;
  GetInventoryList: Empty;
  GetFoodTypeDetail: { readonly foodTypeId: Id };
  GetWarningPanel: Empty;
  GetRecommendations: Empty;
  /** A null cuisine lists every recipe. */
  GetCatalog: { readonly cuisineId: Id | null };
};

/** A query as it travels: its name and its params. QueryParser turns request text into one. */
export type Query = {
  [T in QueryType]: { readonly type: T; readonly params: QueryParams[T] };
}[QueryType];
