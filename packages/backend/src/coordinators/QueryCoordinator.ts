import type { Outcome } from '@freshrescue/contract-changeset';
import type { Snapshot } from '@freshrescue/contract-entities';
import type { DomainError } from '@freshrescue/contract-errors';
import type { Query, QueryParams } from '@freshrescue/contract-messages';
import type { DateISO, Result } from '@freshrescue/contract-primitives';
import type { BatchView, StockMap, ThresholdMap } from '@freshrescue/contract-views';
import { catalogBuilder } from '../modules/derive/catalogBuilder';
import { categoryPathResolver } from '../modules/derive/categoryPathResolver';
import { foodTypeDetailProjector } from '../modules/derive/foodTypeDetailProjector';
import { inventoryListProjector } from '../modules/derive/inventoryListProjector';
import { nameSorter } from '../modules/derive/nameSorter';
import { recipeErrorEvaluator } from '../modules/derive/recipeErrorEvaluator';
import { recipeMatchEvaluator } from '../modules/derive/recipeMatchEvaluator';
import { recommendationBuilder } from '../modules/derive/recommendationBuilder';
import { referenceDataProjector } from '../modules/derive/referenceDataProjector';
import { stockAggregator } from '../modules/derive/stockAggregator';
import { warningPanelProjector } from '../modules/derive/warningPanelProjector';
import { batchStatusClassifier } from '../modules/foundation/batchStatusClassifier';
import { thresholdResolver } from '../modules/foundation/thresholdResolver';

type Handled = Result<Outcome, DomainError>;

/** What the `derive` step hands to four of the six reads: the thresholds, the batches with their status, and the stock. */
type Derived = {
  readonly thresholds: ThresholdMap;
  readonly views: readonly BatchView[];
  readonly stock: StockMap;
};

/** A read has a payload and no ChangeSet, so it never reaches the persist step. */
const answer = (payload: unknown): Handled => ({ ok: true, value: { payload } });

/** Shared step of blueprint 4.2: the derive chain `ThresholdResolver`, `BatchStatusClassifier`, `StockAggregator`. */
function derive(snapshot: Snapshot, today: DateISO): Derived {
  const thresholds = thresholdResolver(snapshot);
  const views = batchStatusClassifier(snapshot.batches, thresholds, today);
  return { thresholds, views, stock: stockAggregator(snapshot, views) };
}

function getReferenceData(snapshot: Snapshot, today: DateISO): Handled {
  return answer(referenceDataProjector(snapshot, today));
}

function getInventoryList(snapshot: Snapshot, today: DateISO): Handled {
  const derived = derive(snapshot, today);
  const paths = categoryPathResolver(snapshot);
  const order = nameSorter(snapshot.foodTypes);
  return answer(inventoryListProjector(snapshot, derived.stock, paths, order));
}

function getFoodTypeDetail(params: QueryParams['GetFoodTypeDetail'], snapshot: Snapshot, today: DateISO): Handled {
  const derived = derive(snapshot, today);
  const paths = categoryPathResolver(snapshot);
  const detail = foodTypeDetailProjector(params.foodTypeId, snapshot, derived.views, derived.thresholds, derived.stock, paths);
  if (!detail.ok) return detail;
  return answer(detail.value);
}

// the Warning Panel needs the batches with their status and nothing else of the derive chain
function getWarningPanel(snapshot: Snapshot, today: DateISO): Handled {
  const views = batchStatusClassifier(snapshot.batches, thresholdResolver(snapshot), today);
  return answer(warningPanelProjector(views, snapshot, nameSorter(snapshot.foodTypes)));
}

function getRecommendations(snapshot: Snapshot, today: DateISO): Handled {
  const derived = derive(snapshot, today);
  const errors = recipeErrorEvaluator(snapshot);
  const matches = recipeMatchEvaluator(snapshot, derived.stock, errors, null);
  if (!matches.ok) return matches;
  return answer(recommendationBuilder(matches.value, derived.stock, snapshot, nameSorter(snapshot.recipes)));
}

function getCatalog(params: QueryParams['GetCatalog'], snapshot: Snapshot, today: DateISO): Handled {
  const derived = derive(snapshot, today);
  const errors = recipeErrorEvaluator(snapshot);
  const matches = recipeMatchEvaluator(snapshot, derived.stock, errors, null);
  if (!matches.ok) return matches;
  const catalog = catalogBuilder(matches.value, errors, snapshot, nameSorter(snapshot.recipes), params.cuisineId);
  if (!catalog.ok) return catalog;
  return answer(catalog.value);
}

/** Routes one of the six queries to the read that answers it. */
function handle(query: Query, snapshot: Snapshot, today: DateISO): Handled {
  switch (query.type) {
    case 'GetReferenceData':
      return getReferenceData(snapshot, today);
    case 'GetInventoryList':
      return getInventoryList(snapshot, today);
    case 'GetFoodTypeDetail':
      return getFoodTypeDetail(query.params, snapshot, today);
    case 'GetWarningPanel':
      return getWarningPanel(snapshot, today);
    case 'GetRecommendations':
      return getRecommendations(snapshot, today);
    case 'GetCatalog':
      return getCatalog(query.params, snapshot, today);
  }
}

/**
 * BX-05 QueryCoordinator. Serves every read: the reference data, the inventory screens and the recipe
 * screens (blueprint 3.2). It has six workflows, one for each of the six queries that `handle` routes.
 *
 * It changes nothing, so it returns a payload and no ChangeSet. Everything it answers is worked out from
 * the one snapshot that it was handed and the one `today` of the request, so a request never mixes two
 * moments. Four of the six reads share the `derive` step, written once above; the Warning Panel needs only
 * the first two modules of it, and the reference data none.
 */
export function createQueryCoordinator() {
  return { handle };
}
