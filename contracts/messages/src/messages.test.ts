import type { DomainError } from '@freshrescue/contract-errors';
import type { DateISO, Id } from '@freshrescue/contract-primitives';
import type { CookReportDto } from '@freshrescue/contract-views';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { COMMAND_TYPES, QUERY_TYPES, ROUTE_METHOD, ROUTES } from './index';
import type {
  ApiFailure,
  ApiResponse,
  ApiSuccess,
  Command,
  CommandPayloads,
  CommandType,
  CoordinatorPort,
  Envelope,
  Expiry,
  MessageData,
  MessageType,
  Query,
  QueryParams,
  QueryType,
  RawRequest,
  RouteName,
} from './index';

describe('messages', () => {
  it('lists 13 commands and 6 queries, and every table covers exactly those names', () => {
    expect(COMMAND_TYPES).toHaveLength(13);
    expect(QUERY_TYPES).toHaveLength(6);
    expect(new Set([...COMMAND_TYPES, ...QUERY_TYPES]).size).toBe(19);

    // these two assertions fail the build when a name is added to or removed from one side only
    expectTypeOf<keyof CommandPayloads>().toEqualTypeOf<CommandType>();
    expectTypeOf<keyof QueryParams>().toEqualTypeOf<QueryType>();
  });

  it('says what each of the 19 messages answers with', () => {
    expectTypeOf<keyof MessageData>().toEqualTypeOf<MessageType>();
    expectTypeOf<MessageType>().toEqualTypeOf<CommandType | QueryType>();
    // a command answers with its own payload and never with refreshed views
    expectTypeOf<MessageData['SaveCategory']>().toEqualTypeOf<{ readonly categoryId: Id }>();
    expectTypeOf<MessageData['SaveFoodType']>().toEqualTypeOf<{ readonly foodTypeId: Id }>();
    expectTypeOf<MessageData['SaveRecipe']>().toEqualTypeOf<{ readonly recipeId: Id }>();
    expectTypeOf<MessageData['CookRecipes']>().toEqualTypeOf<CookReportDto>();
    expectTypeOf<MessageData['RemoveBatch']>().toEqualTypeOf<Readonly<Record<string, never>>>();
  });

  it('gives every message one envelope shape, and every reply one response shape', () => {
    const inbound: Command = {
      type: 'InboundBatch',
      payload: { foodTypeId: null, foodName: 'Milk', categoryId: null, unit: 'ml', quantity: 500_000, expiry: { days: 5 } },
    };
    const catalog: Query = { type: 'GetCatalog', params: { cuisineId: null } };
    const anything: Envelope[] = [inbound, catalog];
    expect(anything.map((message) => message.type)).toEqual(['InboundBatch', 'GetCatalog']);
    expectTypeOf<Extract<Command, { type: 'RemoveBatch' }>['payload']>().toEqualTypeOf<{ readonly batchId: Id }>();
    expectTypeOf<Extract<Query, { type: 'GetFoodTypeDetail' }>['params']>().toEqualTypeOf<{ readonly foodTypeId: Id }>();

    // one complete example of every message: the compiler checks every field of every payload
    const commandExamples: { [T in CommandType]: CommandPayloads[T] } = {
      SaveCategory: { scope: 'foodCategory', categoryId: null, parentId: 3, name: 'Poultry' },
      DeleteCategory: { scope: 'cuisine', categoryId: 14 },
      SetCategoryThreshold: { categoryId: 4, thresholdDays: null },
      SaveFoodType: { foodTypeId: null, name: 'Chicken', categoryId: 4, unit: 'grams', thresholdDays: 2 },
      ChangeFoodTypeUnit: { foodTypeId: 5, unit: 'pieces', batches: [{ batchId: 20, quantity: 500 }, { batchId: 21, quantity: 1_000 }] },
      DeleteFoodType: { foodTypeId: 5 },
      InboundBatch: { foodTypeId: null, foodName: 'Milk', categoryId: null, unit: 'ml', quantity: 500_000, expiry: { days: 5 } },
      EditBatchQuantity: { batchId: 20, quantity: 750_000 },
      RemoveBatch: { batchId: 20 },
      SaveRecipe: { recipeId: null, name: 'Spinach Omelette', draft: { cuisineId: 14, rows: [{ foodTypeId: 6, quantity: 3_000, unit: 'pieces' }] } },
      DeleteRecipe: { recipeId: 12 },
      CookRecipes: { recipeIds: [12, 12, 13] },
      SetSimulatedToday: { date: '2026-10-05' },
    };
    const queryExamples: { [T in QueryType]: QueryParams[T] } = {
      GetReferenceData: {},
      GetInventoryList: {},
      GetFoodTypeDetail: { foodTypeId: 5 },
      GetWarningPanel: {},
      GetRecommendations: {},
      GetCatalog: { cuisineId: 14 },
    };
    expect(Object.keys(commandExamples)).toEqual([...COMMAND_TYPES]);
    expect(Object.keys(queryExamples)).toEqual([...QUERY_TYPES]);
    // the expiry of an inbound is a shelf life or a date, and the same recipe may be queued twice
    expect(commandExamples.CookRecipes.recipeIds.filter((id) => id === 12)).toHaveLength(2);
    // an inbound names its expiry as a shelf life in days or as a date, and as nothing else (spec section 3)
    expectTypeOf<Expiry>().toEqualTypeOf<{ readonly days: number } | { readonly date: DateISO }>();
    const byDate: Expiry = { date: '2026-10-06' };
    expect(Object.keys(byDate)).toEqual(['date']);

    const created: ApiResponse<MessageData['SaveCategory']> = { ok: true, data: { categoryId: 9 }, meta: { today: '2026-10-01' } };
    const refused: ApiFailure = { ok: false, error: { family: 'rules', code: 'HAS_BATCHES', detail: '3' }, meta: { today: '2026-10-01' } };
    const beforeToday: ApiFailure = { ok: false, error: { family: 'shape', code: 'BAD_ENVELOPE' }, meta: { today: null } };
    expect([created.ok, refused.ok, beforeToday.ok]).toEqual([true, false, false]);
    expectTypeOf(refused.error).toExtend<DomainError>();

    // a success always knows today, and only a failure may not
    // @ts-expect-error a successful reply carries a date
    const _undated: ApiSuccess = { ok: true, data: {}, meta: { today: null } };
    void _undated;
  });

  it('fixes the two routes and the port that the HTTP gateway talks to', async () => {
    expect(ROUTES).toEqual({ command: '/api/command', query: '/api/query' });
    expect(ROUTE_METHOD).toBe('POST');
    expectTypeOf<RouteName>().toEqualTypeOf<'command' | 'query'>();
    expectTypeOf<RawRequest['route']>().toEqualTypeOf<RouteName>();
    expectTypeOf<RawRequest['body']>().toEqualTypeOf<
      { readonly ok: true; readonly value: string } | { readonly ok: false; readonly err: DomainError }
    >();

    // a coordinator answers a body that was too large like any other failure
    const port: CoordinatorPort = {
      handle: async () => ({
        status: 413,
        response: { ok: false, error: { family: 'io', code: 'PAYLOAD_TOO_LARGE' }, meta: { today: null } },
      }),
    };
    const reply = await port.handle({ route: 'command', body: { ok: false, err: { code: 'PAYLOAD_TOO_LARGE' } } });
    expect(reply.status).toBe(413);
    expect(reply.response.ok).toBe(false);
  });
});
