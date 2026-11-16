import type { DomainError, ErrorFamily } from '@freshrescue/contract-errors';
import type { DateISO, Empty, Id } from '@freshrescue/contract-primitives';
import type {
  CatalogDto,
  CookReportDto,
  FoodTypeDetailDto,
  InventoryListDto,
  RecommendationDto,
  ReferenceDataDto,
  WarningPanelDto,
} from '@freshrescue/contract-views';
import type { Command, CommandType } from './commands';
import type { Query, QueryType } from './queries';

/** Any of the 19 messages: what the frontend sends and the backend parses. */
export type Envelope = Command | Query;

/** The name of any of the 19 messages. */
export type MessageType = CommandType | QueryType;

/**
 * What a successful reply to each message carries in `data`. A command answers with its own
 * payload, such as the id it created, and never with refreshed views: the frontend asks for those
 * with queries. A command with nothing to answer with sends `{}`.
 */
export type MessageData = {
  SaveCategory: { readonly categoryId: Id };
  DeleteCategory: Empty;
  SetCategoryThreshold: Empty;
  SaveFoodType: { readonly foodTypeId: Id };
  ChangeFoodTypeUnit: Empty;
  DeleteFoodType: Empty;
  InboundBatch: Empty;
  EditBatchQuantity: Empty;
  RemoveBatch: Empty;
  SaveRecipe: { readonly recipeId: Id };
  DeleteRecipe: Empty;
  CookRecipes: CookReportDto;
  SetSimulatedToday: Empty;
  GetReferenceData: ReferenceDataDto;
  GetInventoryList: InventoryListDto;
  GetFoodTypeDetail: FoodTypeDetailDto;
  GetWarningPanel: WarningPanelDto;
  GetRecommendations: RecommendationDto;
  GetCatalog: CatalogDto;
};

/** A failure on the wire: its family, its code and an optional detail. */
export type ApiError = DomainError & { readonly family: ErrorFamily };

export type ApiSuccess<D = unknown> = {
  readonly ok: true;
  readonly data: D;
  readonly meta: { readonly today: DateISO };
};

/** `meta.today` is null on every failure, because `ApiResponseBuilder` receives `today` only together with a successful result. */
export type ApiFailure = {
  readonly ok: false;
  readonly error: ApiError;
  readonly meta: { readonly today: DateISO | null };
};

/** Every reply has this one shape: `{ ok, data or error, meta: { today } }`. */
export type ApiResponse<D = unknown> = ApiSuccess<D> | ApiFailure;

/** What the browser's gateway gets back before anything is parsed: the HTTP status and the body text. */
export type RawHttpResult = {
  readonly status: number;
  readonly bodyText: string;
};
