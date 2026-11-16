# FreshRescue MVP v1.3 — System Architecture Blueprint

## Part 1 — Atomic module responsibility matrix

The system splits into 83 atomic modules (54 backend, 29 frontend), none estimated above 420 lines, plus 11 thin coordinators that are the only code allowed to connect them.

### 1.1 Ground rules

- **Shape.** A browser SPA (frontend, FE) calls an HTTP/JSON service (backend, BE). The BE is stateless: each request loads the full snapshot, decides, writes once and answers. The same BE bundle can run in-process behind the same `ApiGateway` contract.
- **Time.** Assumption: the BE runs on the user's own machine, so its clock is the device clock that spec §4.3.4 requires. No pure module reads a clock; `TodayResolver` fixes `today` once per request and passes it in.
- **Ids.** No pure module generates ids; `IdAllocator` reserves ids and `createdSeq` values from `Counters`, so equal inputs give equal outputs.
- **Errors are values.** A fallible module returns `Result<T, DomainError>`; a coordinator writes `x = Module(args)?` to unwrap it or return the `Err` at once. Slices and puppet UIs cannot fail: an action that is illegal in the current state returns the state unchanged. Nothing throws: a native call that can throw, such as `JSON.parse` or a database call, is wrapped where it is called, and its failure comes back as an `Err`. 
- **Validated types.** Validators return branded types (`ValidName`, `ValidQty`, `ValidUnit`, `ValidThreshold`); deciders accept only those, so unvalidated data cannot reach a state change.
- **One write path.** Every mutation is a `ChangeSet`: `ChangeSetApplier` computes the next snapshot, `SnapshotInvariantChecker` gates it, `ChangeSetEncoder` plus `StoreWriteGateway` persist it atomically.
- **Read models.** The BE returns DTOs from `views`; the FE never recomputes freshness, thresholds, stock or recipe status.
- **Ids of modules.** `B` backend, `F` frontend; then `G` gateway, `P` parsing, `S` state machine, `C` computation, `U` puppet UI.
- **Lines.** 'Est. lines' counts code without comments or blanks. Each side has one composition root that instantiates gateways and coordinators and holds no logic; it is not a module.

The import edges below are the whole dependency graph.

| Importer | May import | Never imports |
| --- | --- | --- |
| Contract package | other contract packages (types and constants, no functions) | modules, coordinators |
| Module | `contracts` only | any other module, any coordinator |
| Sub-coordinator | modules, `contracts` | another sub-coordinator; gateways (FE sub-coordinators use `ctx` services instead) |
| Top coordinator | its sub-coordinators, modules, `contracts`, gateways | — |

### 1.2 Read-only contracts

Nine packages hold types and constants only. They are the sole thing modules share.

| Package | Holds |
| --- | --- |
| `primitives` | `Id`, `QtyMilli` (integer thousandths), `DateISO`, `Result<T,E>`, `Named`, branded `ValidName`, `ValidQty`, `ValidUnit`, `ValidThreshold` |
| `entities` | `FoodCategory`, `FoodType`, `Batch`, `RecipeCategory`, `Recipe`, `RecipeIngredient`, `ValidRecipeDraft`, `Settings{simulatedToday, bootstrapped}`, `Counters{nextId, nextSeq}`, `Snapshot` (arrays kept in creation order) |
| `rules` | `LIMITS` (name 1–200 chars, quantity 1–500,000,000 milli, cap 500,000,000 milli, global threshold 3 days), `UNIT_LIST` (grams, kg, ml, liters, pieces, cartons), `SYSTEM_IDS` (the two `Other` categories), status enum (Fresh, Near-Expiry, Expired), `NameScope` |
| `messages` | `Command` (13 variants) and `Query` (6) unions, envelopes, `ApiResponse{ok, data or error, meta:{today}}`, `ROUTES` (`POST /api/command`, `POST /api/query`), `CoordinatorPort` |
| `changeset` | `ChangeSet` (ordered `EntityOp`s plus counter and settings ops), `WriteOps` (storage-level puts and deletes) |
| `views` | Read-model DTOs: `InventoryListDto`, `FoodTypeDetailDto`, `WarningPanelDto`, `RecommendationDto`, `CatalogDto`, `CookReportDto`, `ReferenceDataDto` |
| `errors` | `DomainError{code, detail?}`, the 58-code `ErrorCode` catalog (families below), the code → HTTP status table |
| `seed` | `SeedBundle` schema (seed keys, no ids), `ParsedSeed`, `SEED_ID_ORDER` |
| `ui` | `UiEvent` catalog with the namespace → coordinator route table and the typed payload of every event (`UiPayloads`), `UiEventDescriptor` (the event that a node carries, without the `value` that the DOM host adds), slice action unions, `FormSchema`s, `NoticeModel`, `RenderTree`, CSS tokens |

The `ErrorCode` catalog has five families; every code named in the module tables comes from here.

| Family | Codes |
| --- | --- |
| Shape (13) | BAD\_ENVELOPE, UNKNOWN\_COMMAND, UNKNOWN\_QUERY, MISSING\_FIELD, WRONG\_TYPE, BAD\_COMBINATION, DATE\_INVALID, CORRUPT\_STORE, SCHEMA\_MISMATCH, BAD\_SEED, DUP\_SEED\_KEY, SEED\_BAD\_CATEGORY, SEED\_BAD\_FOODTYPE |
| Validation (12) | NAME\_EMPTY, NAME\_TOO\_LONG, NAME\_DUPLICATE, NAME\_RESERVED, QTY\_NOT\_POSITIVE, QTY\_TOO\_LARGE, QTY\_NOT\_INTEGER, UNIT\_UNKNOWN, THRESHOLD\_INVALID, DAYS\_INVALID, PAST\_EXPIRY, CAP\_EXCEEDED |
| Rules (17) | CATEGORY\_NOT\_FOUND, PARENT\_INVALID, SYSTEM\_PROTECTED, THRESHOLD\_FORBIDDEN, FOOD\_TYPE\_NOT\_FOUND, HAS\_BATCHES, BATCH\_NOT\_FOUND, RECIPE\_NOT\_FOUND, UNIT\_UNCHANGED, BATCH\_SET\_MISMATCH, NO\_INGREDIENTS, DUP\_INGREDIENT, UNKNOWN\_FOOD\_TYPE, CONFLICTING\_OPS, UNKNOWN\_TARGET, INVARIANT\_BROKEN, INSUFFICIENT\_STOCK |
| IO and transport (10) | STORE\_UNAVAILABLE, STORE\_WRITE\_FAILED, SEED\_UNREADABLE, NETWORK\_ERROR, TIMEOUT, BAD\_JSON, HTTP\_STATUS, PAYLOAD\_TOO\_LARGE, BAD\_RESPONSE, SLOT\_NOT\_FOUND |
| Form, FE only (6) | FIELD\_REQUIRED, QTY\_FORMAT, QTY\_DECIMALS, INT\_FORMAT, DATE\_FORMAT, CHOICE\_UNKNOWN |

### 1.3 Backend A — gateways, parsers, state machine, validators (16 modules)

Each group lists its modules twice with the same rows: first what the module is, then what passes through it.

**Responsibility**

| Module | Category | Unique responsibility | Est. lines |
| --- | --- | --- | --- |
| BG-01 HttpServerGateway | IO gateway | Binds HTTP to `CoordinatorPort`: forwards each request body, returns the serialized reply with its status. | 130 |
| BG-02 StoreReadGateway | IO gateway | Reads the persisted document out of the store. | 80 |
| BG-03 StoreWriteGateway | IO gateway | Applies one `WriteOps` batch to the store, all or nothing. | 140 |
| BG-04 ClockGateway | IO gateway | Reads the device calendar date. | 20 |
| BG-05 SeedSourceGateway | IO gateway | Reads the pre-load seed document from its source. | 40 |
| BP-01 CommandParser | parsing | Turns a raw request body into a typed `Command`. | 420 |
| BP-02 QueryParser | parsing | Turns a raw request body into a typed `Query`. | 150 |
| BP-03 SnapshotParser | parsing | Turns the raw store document into a typed `Snapshot` (shape checks only). | 320 |
| BP-04 SeedBundleParser | parsing | Turns the raw seed document into a key-checked `ParsedSeed`. | 180 |
| BS-01 ChangeSetApplier | state machine | Computes the next `Snapshot` from the current one plus one `ChangeSet`. | 220 |
| BC-01 TodayResolver | computation | Picks `D_now`: Simulated Today when set, otherwise the device date. | 20 |
| BC-02 IdAllocator | computation | Reserves the next ids plus `createdSeq` values from `Counters`. | 50 |
| BC-03 NameValidator | computation | Checks one name against the rules for length, scope uniqueness, reserved names. | 80 |
| BC-04 ScalarValidator | computation | Checks one scalar (quantity, unit or threshold) against its rule in `rules`. | 110 |
| BC-05 ExpiryResolver | computation | Turns a shelf life or an expiration date into the pair `D_in`, `D_exp`. | 110 |
| BC-06 CapChecker | computation | Tests whether a proposed change keeps a Food Type's total within the 500,000 cap. | 90 |

**Interface**

| Module | Input | Output | Errors |
| --- | --- | --- | --- |
| BG-01 HttpServerGateway | HTTP request: path, body text | `RawRequest{route, body}` for the port; HTTP reply: status, JSON text | PAYLOAD\_TOO\_LARGE |
| BG-02 StoreReadGateway | store key (constant) | `RawStore` (JSON document), or `null` when empty | STORE\_UNAVAILABLE |
| BG-03 StoreWriteGateway | `WriteOps` | `Ok` | STORE\_WRITE\_FAILED |
| BG-04 ClockGateway | none | `DateISO` | — |
| BG-05 SeedSourceGateway | seed location (constant) | `RawSeed` (JSON document) | SEED\_UNREADABLE |
| BP-01 CommandParser | body text | `Command` (13-variant union) | BAD\_ENVELOPE, UNKNOWN\_COMMAND, MISSING\_FIELD, WRONG\_TYPE, BAD\_COMBINATION, DATE\_INVALID |
| BP-02 QueryParser | body text | `Query` (6-variant union) | BAD\_ENVELOPE, UNKNOWN\_QUERY, MISSING\_FIELD, WRONG\_TYPE |
| BP-03 SnapshotParser | `RawStore` or `null` | `Snapshot` (an empty one for `null`) | CORRUPT\_STORE, SCHEMA\_MISMATCH |
| BP-04 SeedBundleParser | `RawSeed` | `ParsedSeed` (entities by seed key, plus `idDemand`) | BAD\_SEED, DUP\_SEED\_KEY, SEED\_BAD\_CATEGORY, SEED\_BAD\_FOODTYPE |
| BS-01 ChangeSetApplier | `Snapshot`, `ChangeSet` | next `Snapshot` | CONFLICTING\_OPS, UNKNOWN\_TARGET |
| BC-01 TodayResolver | `deviceToday`, `simulatedToday` or `null` | `today: DateISO` | — |
| BC-02 IdAllocator | `Counters`, demand `{ids, seqs}` | `{ids[], seqs[], counterCs}` (`counterCs` is the ChangeSet that bumps `Counters`) | — |
| BC-03 NameValidator | raw text, `NameScope`, `Snapshot`, `selfId?` | `ValidName` | NAME\_EMPTY, NAME\_TOO\_LONG, NAME\_DUPLICATE, NAME\_RESERVED |
| BC-04 ScalarValidator | kind (`qty`, `unit`, `thresholdDays`), raw value | `ValidQty`, `ValidUnit` or `ValidThreshold` | QTY\_NOT\_INTEGER, QTY\_NOT\_POSITIVE, QTY\_TOO\_LARGE, UNIT\_UNKNOWN, THRESHOLD\_INVALID |
| BC-05 ExpiryResolver | `{days}` or `{date}`, `today` | `{inboundDate, expirationDate}` | DAYS\_INVALID, PAST\_EXPIRY |
| BC-06 CapChecker | `Snapshot`, `CapChange` (add, edit, convert; each names its Food Type or batch) | post-change total (`QtyMilli`) | CAP\_EXCEEDED, BATCH\_NOT\_FOUND |

### 1.4 Backend B — derived-state calculators and view builders (13 modules)

Nothing here is stored: freshness, `T_eff`, stock, recipe status and every read model are recomputed from the snapshot on each request (spec §4.6).

**Responsibility**

| Module | Category | Unique responsibility | Est. lines |
| --- | --- | --- | --- |
| BC-07 ThresholdResolver | computation | Derives each Food Type's effective threshold `T_eff` with its source, by the four-level precedence. | 90 |
| BC-08 BatchStatusClassifier | computation | Labels every batch Fresh, Near-Expiry or Expired from `D_exp − D_now` against `T_eff`. | 80 |
| BC-09 StockAggregator | computation | Sums batch quantities per Food Type into total, `Q_avail`, `Q_near_expiry`, per-status split, overall status. | 110 |
| BC-10 CategoryPathResolver | computation | Resolves each Food Type's category into its name path (`Meat → Poultry`, `Other`). | 50 |
| BC-11 NameSorter | computation | Orders named items A–Z (trimmed, case-insensitive, locale-aware; ties keep creation order). | 50 |
| BC-12 RecipeErrorEvaluator | computation | Finds the error rows (Missing Food Type, Unit Conflict) of every recipe. | 100 |
| BC-13 RecipeMatchEvaluator | computation | Classifies recipes as Full, Partial, Nothing-available or Blocked, with per-ingredient `Q_avail`, Rescued flags. | 150 |
| BC-14 RecommendationBuilder | computation | Builds the Feature 3 read model: entry gate, Tier 1, Tier 2 fallback, empty-state key. | 170 |
| BC-15 CatalogBuilder | computation | Builds the Feature 4 read model: A–Z rows, cuisine filter, per-recipe status. | 150 |
| BC-16 InventoryListProjector | computation | Projects stock figures into the Feature 5 list rows. | 100 |
| BC-17 FoodTypeDetailProjector | computation | Projects one Food Type into its Feature 5 detail read model. | 160 |
| BC-18 WarningPanelProjector | computation | Projects batches into the two Warning Panel sections, sorted by days left. | 110 |
| BC-19 ReferenceDataProjector | computation | Projects a `Snapshot` into the picker lists, category trees, settings data the UI needs. | 80 |

**Interface**

| Module | Input | Output | Errors |
| --- | --- | --- | --- |
| BC-07 ThresholdResolver | `Snapshot` | `ThresholdMap`: FoodTypeId → `{days, source}` (source: foodType, child, parent, global) | — |
| BC-08 BatchStatusClassifier | batches, `ThresholdMap`, `today` | `BatchView[]`: id, foodTypeId, quantity, dates, `createdSeq`, `daysLeft`, status | — |
| BC-09 StockAggregator | `Snapshot`, `BatchView[]` | `StockMap`: FoodTypeId → `{total, avail, near, byStatus, overall}` | — |
| BC-10 CategoryPathResolver | `Snapshot` | `PathMap`: FoodTypeId → `{categoryId, names[]}` | — |
| BC-11 NameSorter | `Named[]` in creation order | `Id[]` in A–Z order | — |
| BC-12 RecipeErrorEvaluator | `Snapshot` | `RecipeErrors`: RecipeId → affected rows, each with its reason | — |
| BC-13 RecipeMatchEvaluator | `Snapshot`, `StockMap`, `RecipeErrors`, `onlyIds?` | `MatchMap`: RecipeId → `{status, rows[], availableCount, hasRescued}` | RECIPE\_NOT\_FOUND |
| BC-14 RecommendationBuilder | `MatchMap`, `StockMap`, `Snapshot`, recipe order | `RecommendationDto` | — |
| BC-15 CatalogBuilder | `MatchMap`, `RecipeErrors`, `Snapshot`, recipe order, `cuisineId?` | `CatalogDto` | CATEGORY\_NOT\_FOUND |
| BC-16 InventoryListProjector | `Snapshot`, `StockMap`, `PathMap`, Food Type order | `InventoryListDto` | — |
| BC-17 FoodTypeDetailProjector | `foodTypeId`, `Snapshot`, `BatchView[]`, `ThresholdMap`, `StockMap`, `PathMap` | `FoodTypeDetailDto`: header, batches by `D_exp`, referencing recipes (for the delete confirmation) | FOOD\_TYPE\_NOT\_FOUND |
| BC-18 WarningPanelProjector | `BatchView[]`, `Snapshot`, Food Type order | `WarningPanelDto` | — |
| BC-19 ReferenceDataProjector | `Snapshot`, `today` | `ReferenceDataDto` | — |

### 1.5 Backend C — deciders, resolver, draft validator (16 modules)

A decider is a pure function from validated input plus the current `Snapshot` to a `ChangeSet`; it never edits the snapshot. One rule family, one decider: no decider calls a validator or an allocator, because the coordinator hands it already-validated values and reserved ids.

**Responsibility**

| Module | Category | Unique responsibility | Est. lines |
| --- | --- | --- | --- |
| BC-20 CategoryCreateDecider | computation | Builds the `ChangeSet` that adds one category (Parent, Child or cuisine). | 100 |
| BC-21 CategoryRenameDecider | computation | Builds the `ChangeSet` that renames one category. | 60 |
| BC-22 CategoryDeleteDecider | computation | Builds the `ChangeSet` that removes a category, re-homing its Food Types or recipes to `Other`. | 160 |
| BC-23 CategoryThresholdDecider | computation | Builds the `ChangeSet` that sets or clears one category threshold. | 70 |
| BC-24 FoodTypeCreateDecider | computation | Builds the `ChangeSet` that adds one Food Type. | 80 |
| BC-25 FoodTypeEditDecider | computation | Builds the `ChangeSet` that edits a Food Type's name, category or threshold. | 110 |
| BC-26 FoodTypeDeleteDecider | computation | Builds the `ChangeSet` that deletes a batch-free Food Type, stamping `deletedFoodTypeName` on referencing recipe rows. | 90 |
| BC-27 UnitChangeDecider | computation | Builds the `ChangeSet` that switches a Food Type's unit, with a new quantity for every batch. | 120 |
| BC-28 FoodTypeResolver | computation | Resolves an inbound reference (id or typed name) to an existing Food Type or a new one. | 40 |
| BC-29 BatchCreateDecider | computation | Builds the `ChangeSet` that adds one batch. | 70 |
| BC-30 BatchQuantityEditDecider | computation | Builds the `ChangeSet` that replaces one batch's quantity. | 50 |
| BC-31 BatchRemoveDecider | computation | Builds the `ChangeSet` that removes one batch. | 40 |
| BC-32 RecipeDraftValidator | computation | Validates a recipe draft (cuisine, ingredient rows) against `rules`. | 200 |
| BC-33 RecipeUpsertDecider | computation | Builds the `ChangeSet` that creates or replaces one recipe with its rows. | 80 |
| BC-34 RecipeDeleteDecider | computation | Builds the `ChangeSet` that removes one recipe with its rows. | 40 |
| BC-35 SettingsDecider | computation | Builds the `ChangeSet` that sets or clears Simulated Today. | 60 |

**Interface**

| Module | Input | Output | Errors |
| --- | --- | --- | --- |
| BC-20 CategoryCreateDecider | `scope`, `ValidName`, `parentId?`, `Snapshot`, one id | `ChangeSet` (add category) | PARENT\_INVALID, CATEGORY\_NOT\_FOUND |
| BC-21 CategoryRenameDecider | `scope`, `categoryId`, `ValidName`, `Snapshot` | `ChangeSet` (rename) | CATEGORY\_NOT\_FOUND, SYSTEM\_PROTECTED |
| BC-22 CategoryDeleteDecider | `scope`, `categoryId`, `Snapshot` | `ChangeSet` (delete the category and its children, re-home members to `Other`) | CATEGORY\_NOT\_FOUND, SYSTEM\_PROTECTED |
| BC-23 CategoryThresholdDecider | `categoryId`, `ValidThreshold` or `null`, `Snapshot` | `ChangeSet` (set or clear threshold) | CATEGORY\_NOT\_FOUND, THRESHOLD\_FORBIDDEN |
| BC-24 FoodTypeCreateDecider | `ValidName`, `categoryId?`, `ValidUnit`, `ValidThreshold` or `null`, `Snapshot`, one id | `ChangeSet` (add Food Type; category defaults to `Other`) | CATEGORY\_NOT\_FOUND |
| BC-25 FoodTypeEditDecider | `foodTypeId`, `ValidName`, `categoryId`, `ValidThreshold` or `null`, `Snapshot` | `ChangeSet` (update) | FOOD\_TYPE\_NOT\_FOUND, CATEGORY\_NOT\_FOUND |
| BC-26 FoodTypeDeleteDecider | `foodTypeId`, `Snapshot` | `ChangeSet` (delete Food Type, stamp referencing rows) | FOOD\_TYPE\_NOT\_FOUND, HAS\_BATCHES |
| BC-27 UnitChangeDecider | `foodTypeId`, `ValidUnit`, `{batchId, ValidQty}[]`, `Snapshot` | `ChangeSet` (unit plus every batch quantity) | FOOD\_TYPE\_NOT\_FOUND, UNIT\_UNCHANGED, BATCH\_SET\_MISMATCH |
| BC-28 FoodTypeResolver | `foodTypeId?` or `foodName?`, `Snapshot` | `Resolved`: `existing(FoodType)` or `new(name)`; with no id and no name it gives `new('')` | FOOD\_TYPE\_NOT\_FOUND |
| BC-29 BatchCreateDecider | `foodTypeId`, `ValidQty`, `{inboundDate, expirationDate}`, one id, one seq | `ChangeSet` (add batch) | — |
| BC-30 BatchQuantityEditDecider | `batchId`, `ValidQty`, `Snapshot` | `ChangeSet` (update quantity) | BATCH\_NOT\_FOUND |
| BC-31 BatchRemoveDecider | `batchId`, `Snapshot` | `ChangeSet` (delete batch) | BATCH\_NOT\_FOUND |
| BC-32 RecipeDraftValidator | `RecipeDraft`, `Snapshot` | `ValidRecipeDraft` (rows as `QtyMilli`, units checked) | NO\_INGREDIENTS, DUP\_INGREDIENT, UNKNOWN\_FOOD\_TYPE, QTY\_NOT\_POSITIVE, QTY\_TOO\_LARGE, QTY\_NOT\_INTEGER, UNIT\_UNKNOWN, CATEGORY\_NOT\_FOUND |
| BC-33 RecipeUpsertDecider | `recipeId?`, `ValidName`, `ValidRecipeDraft`, `Snapshot`, one id | `ChangeSet` (put recipe, replace rows) | RECIPE\_NOT\_FOUND |
| BC-34 RecipeDeleteDecider | `recipeId`, `Snapshot` | `ChangeSet` (delete recipe) | RECIPE\_NOT\_FOUND |
| BC-35 SettingsDecider | `date` or `null` | `ChangeSet` (set `simulatedToday`; `bootstrapped` stays true) | — |

### 1.6 Backend D — cook engine, bootstrap, guard, response (9 modules)

`SeedPlanner` consumes ids in the order `SEED_ID_ORDER` fixes (food categories, cuisines, Food Types, recipes). The coordinator reserves exactly `idDemand` of them through `IdAllocator`, so only one module owns the id scheme.

**Responsibility**

| Module | Category | Unique responsibility | Est. lines |
| --- | --- | --- | --- |
| BC-36 FefoAllocator | computation | Picks the batches, earliest `D_exp` first, expired excluded, that cover one ingredient's `Q_req`. | 110 |
| BC-37 CookChangeSetBuilder | computation | Builds the `ChangeSet` that deducts a recipe's allocations from batches. | 90 |
| BC-38 CookReportBuilder | computation | Builds one recipe's execution-summary entry (deducted, missing, skipped). | 110 |
| BC-39 SystemDataInitializer | computation | Builds the `ChangeSet` that adds the missing system categories (both `Other`). | 50 |
| BC-40 SeedPlanner | computation | Turns a `ParsedSeed` plus reserved ids into the pre-load `ChangeSet`. | 220 |
| BC-41 SnapshotInvariantChecker | computation | Verifies a `Snapshot` against every stored-state invariant of the specification. | 280 |
| BC-42 ChangeSetMerger | computation | Joins several `ChangeSet`s into one ordered `ChangeSet`. | 60 |
| BC-43 ChangeSetEncoder | computation | Translates a `ChangeSet` into storage-level `WriteOps`. | 130 |
| BC-44 ApiResponseBuilder | computation | Wraps a `Result` into the `ApiResponse` envelope with its HTTP status. | 80 |

**Interface**

| Module | Input | Output | Errors |
| --- | --- | --- | --- |
| BC-36 FefoAllocator | `foodTypeId`, `qReq`, `BatchView[]` | `Allocation{foodTypeId, takes[{batchId, takeMilli, emptied}]}` | INSUFFICIENT\_STOCK |
| BC-37 CookChangeSetBuilder | `recipeId`, `Allocation[]`, `Snapshot` | `ChangeSet` (batch quantity updates; deletes at zero) | BATCH\_NOT\_FOUND |
| BC-38 CookReportBuilder | `recipeId`, its `MatchMap` entry or `null`, `Allocation[]`, `Snapshot` | `CookReportEntry{outcome, deducted[], missing[], reason?}` | — |
| BC-39 SystemDataInitializer | `Snapshot` | `ChangeSet` (system categories with `SYSTEM_IDS`; empty when present) | — |
| BC-40 SeedPlanner | `ParsedSeed`, `Id[]` in `SEED_ID_ORDER`, `Snapshot` | `ChangeSet` (all pre-load entities, `bootstrapped = true`) | — |
| BC-41 SnapshotInvariantChecker | `Snapshot` | `Ok` (snapshot unchanged) | INVARIANT\_BROKEN (lists every violated rule) |
| BC-42 ChangeSetMerger | `ChangeSet[]` | one `ChangeSet` | — |
| BC-43 ChangeSetEncoder | `ChangeSet` | `WriteOps` | — |
| BC-44 ApiResponseBuilder | `Result<{payload, today}, DomainError>` | `ApiResponse` with HTTP status | — |

### 1.7 Frontend A — gateways, parsers, computation, slices (13 modules)

A slice is a pure reducer for one piece of UI state. The generic slices (`ResourceSlice`, `FormSlice`) are instantiated once per resource or form, so one module serves many features; the instances are mapped in Part 2.5. Slices never fail: an action that is illegal in the current state returns the state unchanged.

**Responsibility**

| Module | Category | Unique responsibility | Est. lines |
| --- | --- | --- | --- |
| FG-01 ApiGateway | IO gateway | Sends one envelope to the backend, returns the raw HTTP result. | 100 |
| FG-02 MidnightTimerGateway | IO gateway | Fires a callback at every local 00:00. | 40 |
| FG-03 DomHostGateway | IO gateway | Binds a `RenderTree` to a DOM slot, relays DOM events as `UiEvent`s. | 160 |
| FP-01 FormSchemaParser | parsing | Turns raw form text into a typed command payload, driven by a `FormSchema` (decimal text → `QtyMilli`). | 300 |
| FP-02 ApiResponseParser | parsing | Turns a raw HTTP result into typed view data or a `DomainError`. | 240 |
| FC-01 ErrorNoticeMapper | computation | Maps an error to a user-facing `NoticeModel` with field hints. | 140 |
| FC-02 FormPrefillBuilder | computation | Builds a form's initial text values plus option lists from view data. | 120 |
| FS-01 ResourceSlice | state machine | Tracks one remote read: idle, loading, ready, failed. | 70 |
| FS-02 FormSlice | state machine | Tracks one form: closed, editing, confirming, submitting. | 200 |
| FS-03 NavigationSlice | state machine | Tracks the active tab, the open Food Type detail. | 90 |
| FS-04 NoticeSlice | state machine | Tracks the queue of visible notices. | 60 |
| FS-05 CatalogViewSlice | state machine | Tracks the cuisine filter, the highlighted recipe. | 50 |
| FS-06 CookQueueSlice | state machine | Tracks the ordered cook queue. | 120 |

**Interface**

| Module | Input | Output | Errors |
| --- | --- | --- | --- |
| FG-01 ApiGateway | `Envelope` (command or query) | `RawHttpResult{status, bodyText}` | NETWORK\_ERROR, TIMEOUT |
| FG-02 MidnightTimerGateway | callback | `unsubscribe` handle | — |
| FG-03 DomHostGateway | slot id, `RenderTree`; DOM events | painted DOM; `UiEvent` handed to the dispatcher, with the text of an input or a select as `value` | SLOT\_NOT\_FOUND |
| FP-01 FormSchemaParser | `FormSchema`, field texts | typed payload (`qtyMilli`, `{days}` or `{date}`, ids) | per field: FIELD\_REQUIRED, QTY\_FORMAT, QTY\_DECIMALS, INT\_FORMAT, DATE\_FORMAT, CHOICE\_UNKNOWN |
| FP-02 ApiResponseParser | `RawHttpResult`, expected kind | typed DTO or payload; or the backend `DomainError`, passed through | BAD\_JSON, BAD\_RESPONSE, HTTP\_STATUS |
| FC-01 ErrorNoticeMapper | `DomainError` or field errors, context `{message, batchCount}` (the message that was sent, and the batch count that HAS\_BATCHES names) | `NoticeModel{severity, text, fieldHints}` | — |
| FC-02 FormPrefillBuilder | form kind, view data (the payload of the event that opens the form, typed by kind), `ReferenceDataDto` | `FormValues` (text) plus option lists | — |
| FS-01 ResourceSlice | `ResourceState<T>`, `ResourceAction` | next `ResourceState<T>` | — |
| FS-02 FormSlice | `FormState`, `FormAction` | next `FormState` | — |
| FS-03 NavigationSlice | `NavState`, `NavAction` | next `NavState` | — |
| FS-04 NoticeSlice | `NoticeState`, `NoticeAction` | next `NoticeState` | — |
| FS-05 CatalogViewSlice | `CatalogViewState`, action | next `CatalogViewState` | — |
| FS-06 CookQueueSlice | `QueueState`, `QueueAction` (add, remove, move, prune, clear) | next `QueueState` | — |

### 1.8 Frontend B — puppet UIs (16 modules)

A puppet UI is a pure function from a view model to a `RenderTree`. It holds no state, calls no API and decides nothing: every interactive node carries a namespaced `UiEvent` descriptor that `DomHostGateway` relays back to the top coordinator. The descriptor is the event without the `value` of an input or a select, which the DOM host adds when the person types or chooses. A button that opens a form carries the record that the form is about (a batch, a Food Type, a category or a recipe), so the form opens without a request. Quantities print as `milli / 1000` through a one-line expression inside each view; no formatter is shared, so no view depends on another.

**Responsibility**

| Module | Category | Unique responsibility | Est. lines |
| --- | --- | --- | --- |
| FU-01 AppShellView | puppet UI | Draws the page frame: tab bar, header slot, content slots. | 120 |
| FU-02 NoticeBarView | puppet UI | Draws the notice list with dismiss controls. | 70 |
| FU-03 DemoControlView | puppet UI | Draws the Simulated Today control. | 80 |
| FU-04 InventoryListView | puppet UI | Draws the Food Type list: rows, status breakdown, overall badge, empty state. | 160 |
| FU-05 FoodTypeDetailView | puppet UI | Draws one Food Type's header, batch list, row actions. | 220 |
| FU-06 BatchFormView | puppet UI | Draws the add-batch or edit-quantity form. | 150 |
| FU-07 FoodTypeFormView | puppet UI | Draws the Food Type create or edit form. | 170 |
| FU-08 UnitConversionModalView | puppet UI | Draws the per-batch quantity modal for a unit change. | 140 |
| FU-09 ConfirmDialogView | puppet UI | Draws a generic confirmation dialog. | 80 |
| FU-10 WarningPanelView | puppet UI | Draws the Warning Panel: a Near-Expiry section, an Expired section. | 120 |
| FU-11 RecommendationView | puppet UI | Draws Tier 1, Tier 2 or the empty state of Feature 3. | 170 |
| FU-12 RecipeCatalogView | puppet UI | Draws the Feature 4 recipe list: filter, status badges, row actions. | 190 |
| FU-13 CookQueueView | puppet UI | Draws the cook queue with reorder controls. | 130 |
| FU-14 CookReportView | puppet UI | Draws the per-recipe execution summary. | 130 |
| FU-15 RecipeFormView | puppet UI | Draws the recipe create or edit form with its ingredient rows. | 230 |
| FU-16 CategoryManagerView | puppet UI | Draws the category trees with inline create, rename, delete, threshold controls. | 220 |

**Interface**

| Module | Input | Output | Errors |
| --- | --- | --- | --- |
| FU-01 AppShellView | `NavState`, today label, the slot ids of the page | `RenderTree` | — |
| FU-02 NoticeBarView | `NoticeItem[]` (each notice with its id, for the dismiss control) | `RenderTree` | — |
| FU-03 DemoControlView | `FormState` (settings), `ReferenceDataDto` (`today`, `simulatedToday`) | `RenderTree` | — |
| FU-04 InventoryListView | `ResourceState<InventoryListDto>` | `RenderTree` | — |
| FU-05 FoodTypeDetailView | `ResourceState<FoodTypeDetailDto>` | `RenderTree` | — |
| FU-06 BatchFormView | `FormState` (batch), which holds its option lists | `RenderTree` | — |
| FU-07 FoodTypeFormView | `FormState` (foodType), which holds its option lists | `RenderTree` | — |
| FU-08 UnitConversionModalView | `FormState` (unitConversion), which holds a row for each batch | `RenderTree` | — |
| FU-09 ConfirmDialogView | `FormState` (batchRemove, foodTypeDelete, categoryDelete or recipeDelete), which holds the title, the lines and the confirm label of its dialog | `RenderTree` | — |
| FU-10 WarningPanelView | `ResourceState<WarningPanelDto>` | `RenderTree` | — |
| FU-11 RecommendationView | `ResourceState<RecommendationDto>` | `RenderTree` | — |
| FU-12 RecipeCatalogView | `ResourceState<CatalogDto>`, `CatalogViewState`, `ReferenceDataDto` (the cuisines of the filter) | `RenderTree` | — |
| FU-13 CookQueueView | `QueueState` (entries carry `recipeName`) | `RenderTree` | — |
| FU-14 CookReportView | `ResourceState<CookReportDto>` | `RenderTree` | — |
| FU-15 RecipeFormView | `FormState` (recipe), which holds its option lists | `RenderTree` | — |
| FU-16 CategoryManagerView | `FormState` (category), `FormState` (threshold), `ReferenceDataDto` trees | `RenderTree` | — |

### 1.9 Rule audits

| Rule | Result | Evidence |
| --- | --- | --- |
| 1. Single data transformation | Every module is one `A → B` converter; no Responsibility cell above uses 'and' or 'then'. | Splits taken: first table below. |
| 2. Pure vs IO isolation | 8 IO gateways (5 backend, 3 frontend) hold no business logic. The other 75 modules reach no clock, random source, file, network, storage, timer or DOM. | A lint rule bans those APIs outside the 8 gateways; `today` and ids arrive as inputs. |
| 3. Zero peer awareness | No module imports another module. | Replacement test: second table below. |
| 4. 1,000-line limit | Largest module: BP-01 CommandParser, about 420 lines. | Backend about 6,060 lines, frontend about 4,070, total about 10,130 for 83 modules. Next largest: BP-03 (320), FP-01 (300), BC-41 (280). |

**Splits taken.** Each row is a responsibility that first read as 'X and then Y'.

| Draft responsibility | Split into |
| --- | --- |
| Validate a name, then build a Food Type | BC-03 NameValidator, BC-24 FoodTypeCreateDecider |
| Check fulfilment, then pick batches, then build deductions | BC-13 RecipeMatchEvaluator, BC-36 FefoAllocator, BC-37 CookChangeSetBuilder |
| Apply a change set, then persist it | BS-01 ChangeSetApplier, BC-43 ChangeSetEncoder, BG-03 StoreWriteGateway |
| Read the store, then parse it | BG-02 StoreReadGateway, BP-03 SnapshotParser |
| Read the seed, parse it, then plan entities | BG-05 SeedSourceGateway, BP-04 SeedBundleParser, BC-40 SeedPlanner |
| Total the stock, then draw a list | BC-09 StockAggregator, BC-16 InventoryListProjector, FU-04 InventoryListView |
| Parse a response, then explain an error | FP-02 ApiResponseParser, FC-01 ErrorNoticeMapper |
| Hold a form's state, then draw the form | FS-02 FormSlice, FU-06 BatchFormView (and its sibling views) |

**Replacement test.** Replacing a module forces edits in no other module; only the coordinator that wires it can change.

| Replace or delete | Modules that must change | Coordinators that must change |
| --- | --- | --- |
| BG-03 StoreWriteGateway (JSON file → SQLite) | none | none; `WriteOps` is a contract type |
| BC-11 NameSorter (new collation) | none | none if the signature holds; if deleted: QueryCoordinator |
| BC-05 ExpiryResolver (new expiry rule) | none | none if the signature holds; if deleted: InventoryCommandCoordinator |
| FG-03 DomHostGateway (canvas instead of DOM) | none | none; views only emit a `RenderTree` |
| FU-12 RecipeCatalogView | none | RecipeBookCoordinator (one render call) |

The limit of seven workflows per coordinator is audited in Part 3.

## Part 2 — Coordinator scheduling topology and data flow

The system runs on 11 coordinators in two trees (5 backend, 6 frontend), and every call from one module to another passes through one of them. The diagrams show each coordinator's steps in the order it runs them, and where an error ends the run.

### 2.1 Reading the diagrams

A flow reads top to bottom. A `×` line is a short-circuit: that step returns its error at once, nothing below it runs, and the error travels up to the top coordinator, which turns it into the response.

```text
╔═════╗  coordinator       [Mod]   pure module      {Gate}  IO gateway
╚═════╝                    <Slice> slice instance   (View)  puppet UI
──►  normal data flow      × CODE  error exit: return the Err, skip the rest
NAME_* QTY_* SEED_BAD_*  = every code with that prefix (lists in Part 1.2)
shape · validation · rules · io  = error families (Part 1.2)
derive = [ThresholdResolver] ► [BatchStatusClassifier] ► [StockAggregator]
```

### 2.2 Coordinator topology

Each side has one top coordinator over its sub-coordinators. A sub-coordinator never calls another sub-coordinator or a gateway. Only the top coordinator reaches the gateways, and the frontend sub-coordinators reach the API through the `ctx` services the top hands them. The two sides meet at one HTTP pair.

```text
FRONTEND (browser)
╔══════════════════════════════════════════════════════════════════════════════╗
║ AppCoordinator [top]   startup · dispatch · onTick                           ║
║ holds the UI route table and ctx { callApi, mount, reference }               ║
╚══╤═══════════════════════════════════════════════════════════════════════════╝
  ├─ ShellCoordinator       navigate · pushNotice · dismissNotice ·
  │                         loadReferenceData · submitSimulatedToday
  ├─ InventoryCoordinator   loadList · openDetail · refresh · loadWarnings ·
  │                         addBatch · editBatchQuantity · removeBatch
  ├─ TaxonomyCoordinator    saveFoodType · changeUnit · deleteFoodType ·
  │                         saveCategory · deleteCategory · setThreshold
  ├─ RecipeBookCoordinator  loadRecommendations · openInCook · loadCatalog ·
  │                         setCuisineFilter · highlightRecipe ·
  │                         saveRecipe · deleteRecipe
  ├─ CookingCoordinator     editQueue · runCook · dismissReport
  │
  └─ gateways, top only:  {ApiGateway} {DomHostGateway}
                          {MidnightTimerGateway}

 ═══════════════════════ HTTP / JSON ═══════════════════════
   ▼ request   POST /api/command · POST /api/query
   ▲ response  ApiResponse { ok, data or error, meta:{ today } }
 ═══════════════════════════════════════════════════════════

BACKEND (service)
╔══════════════════════════════════════════════════════════════════════════════╗
║ BackendCoordinator [top]   handleCommand · handleQuery · startup             ║
║ the only coordinator on this side that touches gateways                      ║
╚══╤═══════════════════════════════════════════════════════════════════════════╝
  ├─ ReferenceCommandCoordinator  bootstrap · setSimulatedToday ·
  │                               saveCategory · deleteCategory ·
  │                               setCategoryThreshold · saveFoodType ·
  │                               deleteFoodType
  ├─ InventoryCommandCoordinator  inbound · editQuantity · removeBatch ·
  │                               changeUnit
  ├─ RecipeCommandCoordinator     saveRecipe · deleteRecipe · cookRecipes
  ├─ QueryCoordinator             getReferenceData · getInventoryList ·
  │                               getFoodTypeDetail · getWarningPanel ·
  │                               getRecommendations · getCatalog
  │
  └─ gateways, top only:  {HttpServerGateway} {StoreReadGateway}
                          {StoreWriteGateway} {ClockGateway}
                          {SeedSourceGateway}
```

Part 3.1 audits the workflow count of every coordinator: seven at most.

### 2.3 Backend top coordinator

Every request runs the same pipeline in the top coordinator. The sub-coordinator is called once, in the middle, and does no IO. A query produces no change sets, so it skips the persist step.

```text
  raw body from {HttpServerGateway}
  │
  ▼
  [CommandParser | QueryParser] ················· × shape ────────────────────┐
  │ Command | Query                                                           │
  ▼                                                                           │
  {StoreReadGateway} ···························· × io ───────────────────────┤
  │ RawStore                                                                  │
  ▼                                                                           │
  [SnapshotParser] ······························ × shape ────────────────────┤
  │ Snapshot                                                                  │
  ▼                                                                           │
  [TodayResolver] ◄── {ClockGateway}                                          │
  │ today                                                                     │
  ▼                                                                           │
  route(msg.type).handle(msg, snap, today) ······ × validation, rules ────────┤
  │   a sub-coordinator, IO-free                                              │
  │ Outcome { changeSets[], payload }                                         │
  ▼                                                                           │
  persist, once per ChangeSet (commands only; a query has none):              │
  │  [ChangeSetApplier] ························· × rules ────────────────────┤
  │  [SnapshotInvariantChecker] ················· × rules ────────────────────┤
  │  [ChangeSetEncoder] ► {StoreWriteGateway} ··· × io ───────────────────────┤
  │ Ok                                                                        │
  ▼                                                                           │
  [ApiResponseBuilder] ◄──────── every × above arrives as Err(DomainError) ───┘
  │ ApiResponse
  ▼
  {HttpServerGateway} ► HTTP status + JSON text
```

Startup runs once, before the first request. It loads the store and, if the store is fresh, seeds it.

```text
startup()
├─ {StoreReadGateway} ► RawStore ·········· × io
├─ [SnapshotParser] ► snap ················ × shape
├─ snap.settings.bootstrapped? ············ yes ► serve requests
├─ {SeedSourceGateway} ► seedRaw ·········· × io
├─ ReferenceCommandCoordinator.bootstrap ► Outcome
│                                          × BAD_SEED DUP_SEED_KEY SEED_BAD_*
├─ persist(Outcome.changeSets) ············ × rules io
└─ serve requests
an × here stops the start: the Err is printed and no ApiResponse is built
```

### 2.4 Backend sub-coordinator flows

These are the methods the top coordinator routes to, grouped under the four sub-coordinators that own them. Each takes the snapshot (and `today` where it needs it) and returns an `Outcome { changeSets[], payload }`; none of them reads or writes anything.

**ReferenceCommandCoordinator** (7 workflows). Seeds the store and edits the reference data. In saveFoodType the threshold validator runs only when the command carries a threshold.

```text
bootstrap(seedRaw, snap)
├─ [SystemDataInitializer] ► cs1
├─ [SeedBundleParser] ► parsed ············ × BAD_SEED DUP_SEED_KEY SEED_BAD_*
├─ [IdAllocator] ► alloc (idDemand ids, 0 seqs)
├─ [SeedPlanner] ► cs2
└─ [ChangeSetMerger] cs1 · counters · cs2 ► Outcome { changeSets:[cs] }

setSimulatedToday(cmd)
├─ [SettingsDecider] ► cs
└─ Outcome { changeSets:[cs] }

saveCategory(cmd, snap)
├─ [NameValidator] ► name ················· × NAME_*
├─ create (no categoryId):
│    ├─ [IdAllocator] ► alloc
│    ├─ [CategoryCreateDecider] ► cs ······ × PARENT_INVALID CATEGORY_NOT_FOUND
│    └─ [ChangeSetMerger] counters · cs
├─ rename (categoryId given):
│    └─ [CategoryRenameDecider] ► cs ······ × CATEGORY_NOT_FOUND
│                                           SYSTEM_PROTECTED
└─ Outcome { changeSets:[cs], payload:{ categoryId } }

deleteCategory(cmd, snap)
├─ [CategoryDeleteDecider] ► cs ··········· × CATEGORY_NOT_FOUND
│                                           SYSTEM_PROTECTED
└─ Outcome { changeSets:[cs] }

setCategoryThreshold(cmd, snap)
├─ [ScalarValidator:threshold] ► thr ······ × THRESHOLD_INVALID
├─ [CategoryThresholdDecider] ► cs ········ × CATEGORY_NOT_FOUND
│                                           THRESHOLD_FORBIDDEN
└─ Outcome { changeSets:[cs] }

saveFoodType(cmd, snap)
├─ [NameValidator] ► name ················· × NAME_*
├─ [ScalarValidator:threshold] ► thr ······ × THRESHOLD_INVALID
├─ create (no foodTypeId):
│    ├─ [ScalarValidator:unit] ► unit ····· × UNIT_UNKNOWN
│    ├─ [IdAllocator] ► alloc
│    ├─ [FoodTypeCreateDecider] ► cs ······ × CATEGORY_NOT_FOUND
│    └─ [ChangeSetMerger] counters · cs
├─ edit (foodTypeId given):
│    └─ [FoodTypeEditDecider] ► cs ········ × FOOD_TYPE_NOT_FOUND
│                                           CATEGORY_NOT_FOUND
└─ Outcome { changeSets:[cs], payload:{ foodTypeId } }

deleteFoodType(cmd, snap)
├─ [FoodTypeDeleteDecider] ► cs ··········· × FOOD_TYPE_NOT_FOUND HAS_BATCHES
└─ Outcome { changeSets:[cs] }
```

**InventoryCommandCoordinator** (4 workflows). In inbound, when the resolver finds no existing Food Type, the call creates one in the same step, and that path reserves two ids instead of one.

```text
inbound(cmd, snap, today)
├─ [FoodTypeResolver] ► ref ··············· × FOOD_TYPE_NOT_FOUND
├─ [ScalarValidator:qty] ► qty ············ × QTY_*
├─ [ExpiryResolver] ► dates ··············· × DAYS_INVALID PAST_EXPIRY
├─ [IdAllocator] ► alloc (new type: 2 ids · existing: 1 id · 1 seq)
├─ if ref is new:
│    ├─ [NameValidator] ► name ············ × NAME_*
│    ├─ [ScalarValidator:unit] ► unit ····· × UNIT_UNKNOWN
│    └─ [FoodTypeCreateDecider] ► csFt ···· × CATEGORY_NOT_FOUND
├─ [CapChecker:add] ······················· × CAP_EXCEEDED
├─ [BatchCreateDecider] ► csB
└─ [ChangeSetMerger] counters · csFt · csB ► Outcome

editQuantity(cmd, snap)
├─ [ScalarValidator:qty] ► qty ············ × QTY_*
├─ [CapChecker:edit] ······················ × CAP_EXCEEDED BATCH_NOT_FOUND
├─ [BatchQuantityEditDecider] ► cs ········ × BATCH_NOT_FOUND
└─ Outcome { changeSets:[cs] }

removeBatch(cmd, snap)
├─ [BatchRemoveDecider] ► cs ·············· × BATCH_NOT_FOUND
└─ Outcome { changeSets:[cs] }

changeUnit(cmd, snap)
├─ [ScalarValidator:unit] ► unit ·········· × UNIT_UNKNOWN
├─ [ScalarValidator:qty] ► qtys ··········· × QTY_*
├─ [CapChecker:convert] ··················· × CAP_EXCEEDED
├─ [UnitChangeDecider] ► cs ··············· × FOOD_TYPE_NOT_FOUND UNIT_UNCHANGED
│                                           BATCH_SET_MISMATCH
└─ Outcome { changeSets:[cs] }
```

**RecipeCommandCoordinator** (3 workflows). In cookRecipes, a recipe is cooked for its fulfilled ingredient rows only and reports the others as missing; a blocked recipe, or one with no fulfilled row, is reported as skipped and the loop moves on. The three guards in the loop (FEFO, change set, apply) catch an inconsistent snapshot: if one fires, the command returns that error and nothing is written. Otherwise the top coordinator persists the change sets one at a time, so each cooked recipe commits as one unit.

```text
saveRecipe(cmd, snap)
├─ [NameValidator] ► name ················· × NAME_*
├─ [RecipeDraftValidator] ► draft ········· × NO_INGREDIENTS DUP_INGREDIENT
│                                           UNKNOWN_FOOD_TYPE QTY_* UNIT_UNKNOWN
│                                           CATEGORY_NOT_FOUND
├─ [IdAllocator] ► alloc (1 id when creating)
├─ [RecipeUpsertDecider] ► cs ············· × RECIPE_NOT_FOUND
├─ [ChangeSetMerger] counters · cs
└─ Outcome { changeSets:[cs], payload:{ recipeId } }

deleteRecipe(cmd, snap)
├─ [RecipeDeleteDecider] ► cs ············· × RECIPE_NOT_FOUND
└─ Outcome { changeSets:[cs] }

cookRecipes(cmd, snap, today)        cur = snap
for each recipeId, in queue order:
├─ derive on cur ► th · views · stock
├─ [RecipeErrorEvaluator] ► errs
├─ [RecipeMatchEvaluator] ► match
│     a missing recipe gives match = null: skipped, not an exit
├─ blocked, or nothing available?
│     yes ► [CookReportBuilder] ► skipped entry; next recipe
├─ for each fulfilled ingredient row:
│    └─ [FefoAllocator] ► allocation ······ × INSUFFICIENT_STOCK
├─ [CookChangeSetBuilder] ► cs ············ × BATCH_NOT_FOUND
├─ [CookReportBuilder] ► cooked entry
└─ [ChangeSetApplier](cur, cs) ► cur ······ × CONFLICTING_OPS UNKNOWN_TARGET
Outcome { changeSets: [one cs per cooked recipe], payload: { reports } }
```

**QueryCoordinator** (6 workflows). A read returns a payload and no change set. Four of the six start with the `derive` chain from the legend; getWarningPanel needs only its first two modules, and getReferenceData none.

```text
getReferenceData(query, snap, today)
└─ [ReferenceDataProjector] ► dto ► Outcome { payload: dto }

getInventoryList(query, snap, today)
├─ derive ► th · views · stock
├─ [CategoryPathResolver] ► paths
├─ [NameSorter](foodTypes) ► order
└─ [InventoryListProjector] ► dto ► Outcome { payload: dto }

getFoodTypeDetail(query, snap, today)
├─ derive ► th · views · stock
├─ [CategoryPathResolver] ► paths
├─ [FoodTypeDetailProjector] ► dto ········ × FOOD_TYPE_NOT_FOUND
└─ Outcome { payload: dto }

getWarningPanel(query, snap, today)
├─ [ThresholdResolver] ► th · [BatchStatusClassifier] ► views
├─ [NameSorter](foodTypes) ► order
└─ [WarningPanelProjector] ► dto ► Outcome { payload: dto }

getRecommendations(query, snap, today)
├─ derive ► th · views · stock
├─ [RecipeErrorEvaluator] ► errs
├─ [RecipeMatchEvaluator] ► matches (all recipes)
├─ [NameSorter](recipes) ► order
└─ [RecommendationBuilder] ► dto ► Outcome { payload: dto }

getCatalog(query, snap, today)
├─ derive ► th · views · stock
├─ [RecipeErrorEvaluator] ► errs
├─ [RecipeMatchEvaluator] ► matches (all recipes)
├─ [NameSorter](recipes) ► order
└─ [CatalogBuilder](cuisineId?) ► dto ····· × CATEGORY_NOT_FOUND
```

### 2.5 Frontend coordinators and slices

A frontend sub-coordinator owns its slices (pure reducers) and the views they feed (pure renderers), and it is the one place where state, view and API meet. The map lists all 22 slice instances under their owners; `┐` and `┴►` join two slices that feed one view.

```text
AppCoordinator [top]
 ├─ ShellCoordinator
 │    ├─ <NavigationSlice>                 ► (AppShellView)
 │    ├─ <NoticeSlice>                     ► (NoticeBarView)
 │    ├─ <ResourceSlice:referenceData>     (read by other coordinators via ctx)
 │    └─ <FormSlice:settings>              ► (DemoControlView)
 ├─ InventoryCoordinator
 │    ├─ <ResourceSlice:inventoryList>     ► (InventoryListView)
 │    ├─ <ResourceSlice:foodTypeDetail>    ► (FoodTypeDetailView)
 │    ├─ <ResourceSlice:warningPanel>      ► (WarningPanelView)
 │    ├─ <FormSlice:batch>                 ► (BatchFormView)
 │    └─ <FormSlice:batchRemove>           ► (ConfirmDialogView)
 ├─ TaxonomyCoordinator
 │    ├─ <FormSlice:foodType>              ► (FoodTypeFormView)
 │    ├─ <FormSlice:unitConversion>        ► (UnitConversionModalView)
 │    ├─ <FormSlice:foodTypeDelete>        ► (ConfirmDialogView)
 │    ├─ <FormSlice:category>              ┐
 │    ├─ <FormSlice:threshold>             ┴► (CategoryManagerView)
 │    └─ <FormSlice:categoryDelete>        ► (ConfirmDialogView)
 ├─ RecipeBookCoordinator
 │    ├─ <ResourceSlice:recommendations>   ► (RecommendationView)
 │    ├─ <ResourceSlice:catalog>           ┐
 │    ├─ <CatalogViewSlice>                ┴► (RecipeCatalogView)
 │    ├─ <FormSlice:recipe>                ► (RecipeFormView)
 │    └─ <FormSlice:recipeDelete>          ► (ConfirmDialogView)
 └─ CookingCoordinator
      ├─ <CookQueueSlice>                  ► (CookQueueView)
      └─ <ResourceSlice:cookReport>        ► (CookReportView)
```

Every UI event, whichever coordinator receives it, runs this cycle.

```text
 DOM event ► {DomHostGateway} ► UiEvent { ns, name, payload }
    │
    ▼
 AppCoordinator.dispatch(UiEvent): route by event.ns (UI route table)
    │
    ▼
 SubCoordinator.handle(event, ctx)
    ├─ <Slice> reduce(state, action) ········ edits · open · close
    ├─ [FormSchemaParser] ··················· submits only
    ├─ ctx.callApi(envelope) ► Result ······· submits, loads
    ├─ <Slice> reduce(state, result) ········ closed · editing · ready · failed
    ├─ (View)(viewModel) ► RenderTree ► ctx.mount(slot, tree)
    └─ return Intent[]
    │
    ▼
 AppCoordinator applies each Intent
    navigate ► Shell          notify ► Shell        dataChanged ► refreshVisible
    openInCook ► Shell + RecipeBook           recipeDeleted ► Cooking (prune)
```

A sub-coordinator never calls another one. It returns `Intent[]` and the top coordinator applies each, which is how a form in one coordinator can refresh a list owned by another.

### 2.6 Frontend to backend round trip

A write is one command round trip followed by the queries that refresh the visible views. The sequence below is an Add Batch submit; every other command runs the same steps with different sub-coordinators on each side.

```text
 FRONTEND (browser)                     │ BACKEND (service)
────────────────────────────────────────┼───────────────────────────────────────
 1 click Save ► UiEvent batch/submit    │
 2 AppCoordinator routes "batch" ►      │
   InventoryCoordinator.addBatch        │
 3 [FormSchemaParser] values ► payload  │
   × field errors ► [ErrorNoticeMapper] │
     ► <FormSlice> editing; stop        │
 4 <FormSlice> submitting; re-render    │
 5 ctx.callApi(command envelope)        │
   {ApiGateway} POST /api/command ──────┼──► 6 BackendCoordinator.handleCommand
                                        │   [CommandParser] {StoreReadGateway}
                                        │   [SnapshotParser] {ClockGateway}
                                        │   [TodayResolver]
                                        │ 7 InventoryCommandCoordinator.inbound
                                        │   ► Outcome
                                        │ 8 persist: apply · gate · encode
                                        │   ► {StoreWriteGateway}
                                        │ 9 [ApiResponseBuilder]
                                        │   ► ApiResponse
                                        │   (an Err in 6 to 8 exits here too)
   [ApiResponseParser] ► Result ────────┼◄── { ok, data | error, meta:{today} }
10 ok ► <FormSlice> closed              │
     ► Intent [dataChanged]             │
   err ► [ErrorNoticeMapper] ► notice   │
     ► <FormSlice> editing              │
     ► Intent [notify]                  │
11 AppCoordinator: refreshVisible()     │
   {ApiGateway} POST /api/query × N ────┼──► 12 handleQuery × N (no persist)
   ► <ResourceSlice> ready; re-render ──┼◄── { ok, data: DTO, meta:{today} }
```

### 2.7 Refresh and the midnight tick

Every write and every date change ends in the same refresh path, and a tab switch reloads that tab, so no screen keeps data from before the change.

```text
 edit coordinator returns          {MidnightTimerGateway}
 Intent [dataChanged]              fires at local 00:00 ► onTick
            │                                │
            └────────► AppCoordinator ◄──────┘
                            │ refreshVisible()
                            ▼
 Shell.loadReferenceData ► ctx.callApi(GetReferenceData)
 then the visible tab only:
   Inventory       ► Inventory.refresh  (list, plus the open detail)
   Warnings        ► Inventory.loadWarnings
   Recommendations ► RecipeBook.loadRecommendations
   Catalog         ► RecipeBook.loadCatalog  (current cuisine filter)
   Categories      ► Taxonomy.redraw  (the trees come with the data)

 navigate(tab)     ► Shell.navigate; a tab change returns dataChanged,
                     so a tab never shows data older than its last visit
 recipeDeleted(id) ► Cooking.editQueue: removes that recipe from the queue
```

## Part 3 — Coordinator workflows

This part describes what each of the 11 coordinators does, in the order it does it. A workflow is one user task that a coordinator carries from trigger to result: a round trip to the backend, a load, or a local state change. A form's open, edit, cancel and submit events all belong to that form's single workflow.

### 3.1 Coordinators and the workflow audit

| Coordinator | Count | Workflows | Owns | Est. lines |
| --- | --- | --- | --- | --- |
| BackendCoordinator (top) | 3 | handleCommand, handleQuery, startup | nothing kept between requests | 110 |
| ReferenceCommandCoordinator | 7 | bootstrap, setSimulatedToday, saveCategory, deleteCategory, setCategoryThreshold, saveFoodType, deleteFoodType | nothing | 225 |
| InventoryCommandCoordinator | 4 | inbound, editQuantity, removeBatch, changeUnit | nothing | 155 |
| RecipeCommandCoordinator | 3 | saveRecipe, deleteRecipe, cookRecipes | nothing | 170 |
| QueryCoordinator | 6 | getReferenceData, getInventoryList, getFoodTypeDetail, getWarningPanel, getRecommendations, getCatalog | nothing | 170 |
| AppCoordinator (top) | 3 | startup, dispatch, onTick | UI route table, `ctx` | 130 |
| ShellCoordinator | 5 | navigate, pushNotice, dismissNotice, loadReferenceData, submitSimulatedToday | NavigationSlice, NoticeSlice, Resource\[referenceData\], Form\[settings\] | 160 |
| InventoryCoordinator | 7 | loadList, openDetail, refresh, loadWarnings, addBatch, editBatchQuantity, removeBatch | Resource\[inventoryList\], Resource\[foodTypeDetail\], Resource\[warningPanel\], Form\[batch\], Form\[batchRemove\] | 240 |
| TaxonomyCoordinator | 6 | saveFoodType, changeUnit, deleteFoodType, saveCategory, deleteCategory, setThreshold | Form\[foodType\], Form\[unitConversion\], Form\[foodTypeDelete\], Form\[category\], Form\[threshold\], Form\[categoryDelete\] | 240 |
| RecipeBookCoordinator | 7 | loadRecommendations, openInCook, loadCatalog, setCuisineFilter, highlightRecipe, saveRecipe, deleteRecipe | Resource\[recommendations\], Resource\[catalog\], CatalogViewSlice, Form\[recipe\], Form\[recipeDelete\] | 270 |
| CookingCoordinator | 3 | editQueue, runCook, dismissReport | CookQueueSlice, Resource\[cookReport\] | 110 |

No coordinator has more than seven workflows, and the largest estimate is 270 lines against the 1,000-line limit, so none needs splitting. The 11 together come to about 1,980 lines (backend 830, frontend 1,150). Data stays small as well: no frontend coordinator owns more than six slices, and at most three of them are Resource slices, the ones that hold server data.

Coordinators are grouped by the data they change or show. The limit that binds is the 40-line pseudocode limit of Part 4, not the workflow limit: a single backend coordinator for every Food Type and batch workflow would need 45 lines. So the Food Type workflows join the category, settings and seed workflows, while the batch workflows include `changeUnit`, which rewrites every batch quantity under the same cap check as an inbound.

The `derive` chain from the legend (`ThresholdResolver`, `BatchStatusClassifier`, `StockAggregator`) is written out in two places. `QueryCoordinator` writes it once as a shared step that four of its six reads use, and `RecipeCommandCoordinator` writes it again inside the cook loop, where it must run on the running copy. That repetition is accepted. One module that chained the three calls would have to know three peers, and a shared coordinator would make coordinators depend on each other. Three lines of plumbing in two places cost less than either.

### 3.2 Backend coordinators

A backend sub-coordinator is stateless and IO-free. It receives the snapshot (and `today` where it needs it) as arguments, calls pure modules in a fixed order, and returns an `Outcome` or the first error. Only `BackendCoordinator` touches a gateway. The route table from message type to sub-coordinator method is in 3.4.

**BackendCoordinator (top).** The only backend coordinator that touches IO; it keeps nothing between requests.

1. **handleCommand** — Parses the body into a `Command`, reads and parses the store into a `Snapshot`, resolves `today` from the device clock and the stored Simulated Today, and routes by command type. It then persists each returned change set in order: apply it to get the next snapshot, check the invariants, encode it to write operations, write them. The result goes through `ApiResponseBuilder`.
2. **handleQuery** — The same pipeline with a `Query` and no persist step.
3. **startup** — Reads and parses the store. A store that is not yet bootstrapped is seeded: the top reads the seed file through `SeedSourceGateway`, calls `ReferenceCommandCoordinator.bootstrap`, and persists the result.

Ends in any error family. A failed step becomes an `ApiResponse` with `ok: false`; a failure at startup is printed and stops the start.

**ReferenceCommandCoordinator.** Seeds the store and edits everything the forms and filters are built from: the demo date, the categories and the Food Types.

1. **bootstrap** — Runs once, on a fresh store. Adds the system categories, parses the seed bundle, reserves the ids the seed needs, plans the pre-load (the built-in recipes together with the Food Types and categories they reference, all as ordinary records), and merges everything into one change set that marks the store bootstrapped.
2. **setSimulatedToday** — Turns a date, or an empty value, into a change set that sets or clears the Simulated Today setting. The next request resolves `today` from it.  The change set replaces the whole settings row and keeps `bootstrapped` true, because startup has seeded the store before any command is handled.
3. **saveCategory** — Validates the name (length, uniqueness within its tree, `Other` reserved), then either creates the category (reserves an id; a Child needs an existing top-level Parent) or renames it in place. The system `Other` cannot be renamed.
4. **deleteCategory** — Decides the cascade from the specification: Food Types of the deleted category and of its Children, or recipes of a deleted cuisine, fall back to `Other`; Children and the custom thresholds of every deleted category are deleted with them. The system `Other` is protected.
5. **setCategoryThreshold** — Sets or clears a custom near-expiry threshold, a whole number of days of at least 1. It is refused for `Other` and for cuisines.
6. **saveFoodType** — Validates the name and, when given, the threshold. Create needs a unit and defaults the category to `Other`; edit changes the name, category and threshold but never the unit.
7. **deleteFoodType** — Allowed only with zero batches. The change set also removes the Food Type's threshold and stamps `deletedFoodTypeName` on the recipe rows that referenced it, which makes those recipes blocked.

Ends in BAD\_SEED, DUP\_SEED\_KEY and SEED\_BAD\_\*; NAME\_\*, PARENT\_INVALID, CATEGORY\_NOT\_FOUND, SYSTEM\_PROTECTED, THRESHOLD\_INVALID and THRESHOLD\_FORBIDDEN; UNIT\_UNKNOWN, FOOD\_TYPE\_NOT\_FOUND and HAS\_BATCHES. A malformed date is rejected earlier, by the command parser (DATE\_INVALID).

**InventoryCommandCoordinator.** Changes how much is in stock: adds, corrects and removes batches, and converts a Food Type's unit together with all its batches. `changeUnit` sits here because it rewrites every batch quantity under the same cap check as an inbound.

1. **inbound** — Resolves the Food Type from an id or a case-insensitive name, validates the quantity, turns shelf-life days or an explicit date into dates (a past expiry is refused), and reserves the ids and the `createdSeq`. If the name matches no Food Type, the same call validates the name and unit and creates the Food Type. A request that names no Food Type at all counts as an empty name, so it ends in NAME\_EMPTY. It then checks the cap, creates the batch, and merges both change sets, so the Food Type and its first batch are created together or not at all.
2. **editQuantity** — Validates the new quantity (above zero), checks the cap with the batch's old quantity replaced, and replaces it. Nothing else on a batch is editable.
3. **removeBatch** — Deletes one whole batch.
4. **changeUnit** — The multi-batch conversion. Validates the new unit and every batch's new quantity, checks that the new quantities fit under the 500,000 cap, then decides the change as a whole, so all batches convert or none do. The quantity list must name exactly the Food Type's current batches.

Ends in FOOD\_TYPE\_NOT\_FOUND, NAME\_\*, QTY\_\*, UNIT\_UNKNOWN, DAYS\_INVALID, PAST\_EXPIRY, CATEGORY\_NOT\_FOUND, CAP\_EXCEEDED, BATCH\_NOT\_FOUND, UNIT\_UNCHANGED and BATCH\_SET\_MISMATCH.

**RecipeCommandCoordinator.** Creates, edits and deletes recipes, and runs the cook queue.

1. **saveRecipe** — Validates the name, then the draft: at least one ingredient row, no Food Type twice, known Food Types, valid quantities and units, an existing cuisine. A Required Unit that differs from the Food Type's unit is allowed, because that only makes the recipe a Unit Conflict, which is derived later. Reserves an id when creating, then upserts.
2. **deleteRecipe** — Deletes the recipe.
3. **cookRecipes** — Cooks the queued recipes strictly in queue order against a running copy of the snapshot. For each recipe it re-derives the stock, evaluates errors and match, and skips a recipe that is blocked or has nothing available. Otherwise it picks batches by FEFO for each fulfilled ingredient, builds that recipe's change set and report entry, and applies the change set to the running copy so the next recipe sees the depleted stock. It returns one change set per cooked recipe and one report entry per queued entry; the top persists the change sets one by one.

Ends in NAME\_\*, NO\_INGREDIENTS, DUP\_INGREDIENT, UNKNOWN\_FOOD\_TYPE, QTY\_\*, UNIT\_UNKNOWN, CATEGORY\_NOT\_FOUND and RECIPE\_NOT\_FOUND from the recipe workflows. The cook loop ends in INSUFFICIENT\_STOCK, BATCH\_NOT\_FOUND, CONFLICTING\_OPS and UNKNOWN\_TARGET, which all mean an inconsistent snapshot. A blocked, missing or unknown recipe is a report entry, not an error.

**QueryCoordinator.** Serves every read: the reference data, the inventory screens and the recipe screens. It changes nothing, and four of its reads share one `derive` step.

1. **getReferenceData** — Projects what forms and filters need: the category trees, the unit list, Food Type and cuisine options, `today` and the simulated date.
2. **getInventoryList** — Derives thresholds, batch statuses and stock, then projects every Food Type A–Z with its category path, total quantity (Expired stock included), status breakdown and overall badge.
3. **getFoodTypeDetail** — Projects one Food Type with its batches (status and days left), its effective threshold and the recipes that reference it.
4. **getWarningPanel** — Projects the Near-Expiry section and the Expired section, each sorted by days left, then Food Type name, then creation order.
5. **getRecommendations** — Evaluates every recipe against the derived stock and builds Feature 3: recipes that are not blocked and have at least one Rescued Ingredient. Tier 1 holds the Full Matches; Tier 2 (Partial Matches) appears only when Tier 1 is empty; both are A–Z.
6. **getCatalog** — Builds Feature 4: all recipes A–Z with their status (blocked reasons, missing ingredients, cookable), optionally filtered to one cuisine.

Ends in FOOD\_TYPE\_NOT\_FOUND (detail only) and CATEGORY\_NOT\_FOUND (an unknown cuisine filter on the catalog).

### 3.3 Frontend coordinators

A frontend sub-coordinator owns the slices and views of one screen area. `AppCoordinator` hands it each `UiEvent` of its namespaces together with `ctx` (`callApi`, `mount`, `reference()`); it answers with a list of intents and never calls another sub-coordinator. Every call through `ctx.callApi` can also end in a transport error (NETWORK\_ERROR, TIMEOUT, BAD\_JSON, BAD\_RESPONSE, HTTP\_STATUS); the entries below do not repeat them. Two workflow shapes recur, so they are written out once.

**Load shape**, used by every ResourceSlice:

1. `reduce(loading)` and render.
2. `ctx.callApi(query)`.
3. Ok: `reduce(ready(dto))` and render. Err: `reduce(failed(err))`, render, and return `notify` with the text from `ErrorNoticeMapper`.

A ResourceSlice keeps its last good data while it reloads and after a failed read, so a screen, and `ctx.reference()`, keep what they have until a new answer arrives. Only `idle` clears it.

**Form shape**, used by every FormSlice:

1. Open: `FormPrefillBuilder` builds the initial texts and option lists from the view data and the reference data, `reduce(open)`, render. The view data is the payload of the event that opens the form: the record that the form is about. A destructive action opens at `confirming` instead of `editing`, and the texts of its dialog (`title`, `confirmLabel` and the numbered `lines.<n>`) are among the prefilled values, so `ConfirmDialogView` draws the dialog from the form like every other form view.
2. Edit events: `reduce(edit)` and render. Adding or removing a row of a `rows` field: `reduce(addRow)` or `reduce(removeRow)` and render. Cancel: `reduce(close)` and render.
3. Submit: `FormSchemaParser` turns the texts into a typed payload. If that fails, `ErrorNoticeMapper` turns the field errors into hints, the slice returns to `editing` with them, and no request is sent.
4. `reduce(submitting)`, render, `ctx.callApi(command)`.
5. Ok: `reduce(closed)`, render, return `dataChanged`. Err: `ErrorNoticeMapper` builds the notice, the slice returns to `editing` with any field hints, render, return `notify`.

**Intents** are the only way a sub-coordinator reaches another one:

| Intent | Raised by | The top coordinator then |
| --- | --- | --- |
| `navigate` | Inventory, Taxonomy | calls Shell.navigate |
| `notify` | any coordinator after an error | calls Shell.pushNotice |
| `dataChanged` | a form after success, runCook, Shell after a tab change | runs refreshVisible |
| `openInCook` | RecipeBook | calls Shell.navigate to the catalog, then RecipeBook.highlightRecipe |
| `recipeDeleted` | RecipeBook | calls Cooking.editQueue to prune that recipe |

Intents returned by those calls are applied the same way, which is how the Shell's `dataChanged` after a tab change reaches `refreshVisible`.

**Event payloads** are typed in the `ui` contract (`UiPayloads`). An event that opens a form carries the record that the form is about, as a read model of the `views` contract: `ev.batch`, `ev.foodType`, `ev.category` (with its `scope`), `ev.parent` or `ev.recipe`. The other events carry an id, a tab, a field or a position. For an input or a select the DOM host adds the text that was typed or chosen as `ev.value`.

**AppCoordinator (top).** The only frontend coordinator that touches gateways. It routes events and applies intents.

1. **startup** — Builds `ctx` (`callApi` is `ApiGateway` plus `ApiResponseParser`, `mount` is `DomHostGateway`, `reference()` reads the reference slice), registers the UI route table, hands `dispatch` to the DOM host as its event handler, has the Shell draw the frame, runs `refreshVisible` to load the reference data and the default tab (Inventory), and subscribes `onTick` to the midnight timer.
2. **dispatch** — Looks up the event's namespace in the route table, calls that sub-coordinator's `handle(event, ctx)`, and applies the returned intents. The table maps each slice namespace (`batch`, `batchRemove`, `foodType`, and so on) to the coordinator that owns the slice. An unknown namespace is a programming error: the event is dropped and an error notice is pushed.
3. **onTick** — Runs `refreshVisible` when the timer fires at local 00:00.

`refreshVisible` is the helper behind `dataChanged`, `onTick` and startup. It calls `Shell.loadReferenceData`, reads the visible tab and open detail from the Shell's `NavigationSlice`, and calls that tab's loader: Inventory → `Inventory.refresh`, Warnings → `Inventory.loadWarnings`, Recommendations → `RecipeBook.loadRecommendations`, Catalog → `RecipeBook.loadCatalog`. The Categories tab calls `Taxonomy.redraw`, which remounts the category view from the new reference data; it sends no request and changes no slice state, so it is a hook, not a workflow.

Ends in the transport errors above, including SLOT\_NOT\_FOUND from the DOM host; each reaches the user as a notice.

**ShellCoordinator.** Owns the active tab, the open Food Type detail, the notice queue, the reference data and the demo-date control.

1. **navigate** — Sets the active tab and the open detail in `NavigationSlice` and redraws the frame. When the tab changed it returns `dataChanged`, so the new tab loads. Opening or closing a detail inside the Inventory tab returns nothing.
2. **pushNotice** — Adds a notice to `NoticeSlice` and redraws the notice bar.
3. **dismissNotice** — Removes one notice and redraws.
4. **loadReferenceData** — Load shape with `GetReferenceData`. The result holds the category trees, units, Food Type and cuisine options, `today` and the simulated date. The other coordinators read it through `ctx.reference()` to prefill their forms.
5. **submitSimulatedToday** — Form shape for the demo control, prefilled with the current simulated date; an empty value clears it. It sends `SetSimulatedToday` and, on success, returns `dataChanged`, so the reference data and the visible tab reload with the new `today`.

Ends in DATE\_FORMAT (form) and DATE\_INVALID (backend), from `submitSimulatedToday`. The navigation and notice workflows change local state only and call no API.

**InventoryCoordinator.** Owns the inventory list, the open Food Type detail, the warning panel, the batch form (add and edit-quantity share one slice) and the remove confirmation.

1. **loadList** — Load shape with `GetInventoryList`.
2. **openDetail** — Load shape with `GetFoodTypeDetail` for the clicked Food Type. It returns `navigate`, so the Shell records which detail is open.
3. **refresh** — Runs `loadList` again and, when the top passes the id of an open detail, the detail load as well. `refreshVisible` calls it for the Inventory tab.
4. **loadWarnings** — Load shape with `GetWarningPanel`.
5. **addBatch** — Form shape for `InboundBatch`. The form lists the existing Food Types; picking one reruns `FormPrefillBuilder` to show its unit and category read-only, while typing a new name opens the category and unit fields. `FormSchemaParser` reads the quantity as thousandths and the shelf life as days or an explicit date.  Only one of the two name fields is filled at a time: picking a Food Type leaves the typed name empty, and typing a name leaves the pick empty, because the name field is drawn only while the pick is on "New Food Type". A pick refills only the fields that depend on it, so a quantity that was already typed stays. If both are empty, the request goes as it is, and the backend answers NAME\_EMPTY. 
6. **editBatchQuantity** — Form shape for `EditBatchQuantity`, prefilled with the batch's current quantity. The quantity is the only batch field that can change.
7. **removeBatch** — Opens `batchRemove` at `confirming`. Confirming sends `RemoveBatch` and returns `dataChanged`.

Ends in FOOD\_TYPE\_NOT\_FOUND (detail only), the form errors FIELD\_REQUIRED, QTY\_FORMAT, QTY\_DECIMALS, INT\_FORMAT, DATE\_FORMAT, CHOICE\_UNKNOWN and the backend codes of `inbound`, `editQuantity` and `removeBatch` in `InventoryCommandCoordinator`.

**TaxonomyCoordinator.** Owns the Food Type form, the unit-conversion modal, the inline category forms, the threshold form and the two delete confirmations. It also has a `redraw` hook that the top calls when the Categories tab refreshes; the hook only remounts the view and is not a workflow.

1. **saveFoodType** — Form shape for `SaveFoodType`. Create comes from the Inventory view's Add Food Type action (name, category defaulting to `Other`, unit required). Edit comes from the detail (name, category, threshold set or cleared); the unit changes only through changeUnit.
2. **changeUnit** — Opens `unitConversion` from the detail's batch list, with one new-quantity field per batch (Fresh, Near-Expiry and Expired alike). Submit stays disabled until every field is valid. It sends `ChangeFoodTypeUnit` with the new unit and all quantities. A Food Type without batches shows only the unit field.
3. **deleteFoodType** — Opens `foodTypeDelete` at `confirming`; the dialog lists the recipes that will become blocked, read from the detail data. Confirming sends `DeleteFoodType`. On success it returns `navigate` (close the detail) and `dataChanged`. A Food Type that still has batches is refused with HAS\_BATCHES, and the notice says "Remove all N batches first", where N is the batch count that the backend names in its error.
4. **saveCategory** — Form shape for `SaveCategory`: create a Parent, a Child under a Parent, or a cuisine, or rename in place.
5. **deleteCategory** — Opens `categoryDelete` at `confirming`; the dialog states that the contents fall back to `Other`. Confirming sends `DeleteCategory` and returns `dataChanged`.
6. **setThreshold** — Form shape for `SetCategoryThreshold`: a whole number of days, or empty to clear.

Ends in the form errors above and the backend codes of `ReferenceCommandCoordinator`, plus those of `changeUnit` in `InventoryCommandCoordinator`.

**RecipeBookCoordinator.** Owns the recommendations, the recipe catalog with its view state (cuisine filter, highlighted recipe), the recipe form and the delete confirmation.

1. **loadRecommendations** — Load shape with `GetRecommendations`.
2. **openInCook** — Turns a click on a recommendation into the `openInCook` intent with the recipe id. Feature 3 only recommends, so cooking happens in the Recipe catalog.
3. **loadCatalog** — Load shape with `GetCatalog`, passing the cuisine filter held in `CatalogViewSlice`. If that cuisine has been deleted meanwhile, the backend answers CATEGORY\_NOT\_FOUND; the coordinator then clears the filter and loads the full list.
4. **setCuisineFilter** — Stores the chosen cuisine (or none) in `CatalogViewSlice` and runs `loadCatalog`, because the backend does the filtering.
5. **highlightRecipe** — Marks one recipe in `CatalogViewSlice` and redraws. The top calls it after `openInCook`.
6. **saveRecipe** — Form shape for `SaveRecipe`: name, cuisine (default `Other`) and ingredient rows. Each row picks an existing Food Type, a quantity from 0.001 to 500,000 and a unit that defaults to the Food Type's unit. `FormPrefillBuilder` supplies the unit of every Food Type, and `FormSlice` sets the unit of a row when its Food Type is picked. Rows are added and removed with the `addRow` and `removeRow` events of the form. When a recipe is blocked because a Food Type was deleted, editing it opens that row with no Food Type, so the user picks another one for it.
7. **deleteRecipe** — Opens `recipeDelete` at `confirming`. Confirming sends `DeleteRecipe` and returns `recipeDeleted` and `dataChanged`.

Ends in the form errors above and the backend codes of `saveRecipe` and `deleteRecipe` in `RecipeCommandCoordinator`. The catalog's row actions (add to queue, edit, delete) are events in the `cook` and `recipe` namespaces: the route table sends the first to `CookingCoordinator` and the others here.

**CookingCoordinator.** Owns the cook queue and the execution report.

1. **editQueue** — Applies add, remove, move, prune or clear to `CookQueueSlice` and redraws. The queue is transient and lives only in the browser. A recipe may be queued twice; each entry runs on its own.
2. **runCook** — Sends `CookRecipes` with the recipe ids in queue order. Ok: the reports go into `Resource[cookReport]`, the queue is cleared, and the report view opens. Err: a notice, and the queue stays so the user can retry. Either way it returns `dataChanged`, because some recipes may already have been cooked.
3. **dismissReport** — Closes the report (`Resource[cookReport]` returns to idle).

Ends in the cook codes of `RecipeCommandCoordinator`. A skipped recipe is a report entry, not an error.

### 3.4 Frontend and backend interaction

The two sides share only the read-only contracts (messages, views, errors) and a wire protocol; no module or state is shared. All traffic is JSON over two POST routes: `/api/command` takes an envelope with `type` and `payload`, and `/api/query` takes one with `type` and `params`. Every reply has the same shape, `ApiResponse { ok, data or error, meta: { today } }`, and `ApiResponseBuilder` chooses the HTTP status from the error family. The frontend never computes a date; it shows the `today` the backend resolved.

Each message has one sender and one handler (the word Coordinator is dropped to fit):

| Message | Sent by (frontend) | Handled by (backend) |
| --- | --- | --- |
| SaveCategory | Taxonomy.saveCategory | ReferenceCommand.saveCategory |
| DeleteCategory | Taxonomy.deleteCategory | ReferenceCommand.deleteCategory |
| SetCategoryThreshold | Taxonomy.setThreshold | ReferenceCommand.setCategoryThreshold |
| SaveFoodType | Taxonomy.saveFoodType | ReferenceCommand.saveFoodType |
| ChangeFoodTypeUnit | Taxonomy.changeUnit | InventoryCommand.changeUnit |
| DeleteFoodType | Taxonomy.deleteFoodType | ReferenceCommand.deleteFoodType |
| InboundBatch | Inventory.addBatch | InventoryCommand.inbound |
| EditBatchQuantity | Inventory.editBatchQuantity | InventoryCommand.editQuantity |
| RemoveBatch | Inventory.removeBatch | InventoryCommand.removeBatch |
| SaveRecipe | RecipeBook.saveRecipe | RecipeCommand.saveRecipe |
| DeleteRecipe | RecipeBook.deleteRecipe | RecipeCommand.deleteRecipe |
| CookRecipes | Cooking.runCook | RecipeCommand.cookRecipes |
| SetSimulatedToday | Shell.submitSimulatedToday | ReferenceCommand.setSimulatedToday |
| GetReferenceData | Shell.loadReferenceData | Query.getReferenceData |
| GetInventoryList | Inventory.loadList, refresh | Query.getInventoryList |
| GetFoodTypeDetail | Inventory.openDetail, refresh | Query.getFoodTypeDetail |
| GetWarningPanel | Inventory.loadWarnings | Query.getWarningPanel |
| GetRecommendations | RecipeBook.loadRecommendations | Query.getRecommendations |
| GetCatalog | RecipeBook.loadCatalog | Query.getCatalog |

The first 13 rows are commands and the last 6 are queries; `BackendCoordinator` routes each by its `type`.

**Command round trip.** Section 2.6 draws it.

1. The sub-coordinator parses the form text into a typed payload and calls `ctx.callApi`.
2. The top posts the envelope to `/api/command`, and `ApiResponseParser` turns the raw reply into a `Result`.
3. `BackendCoordinator.handleCommand` runs its pipeline (2.3) and answers with the command's own payload, such as a new id. It never returns refreshed views.
4. Ok closes the form and raises `dataChanged`. Err keeps the form open and raises `notify`.

**Query round trip.** A load workflow posts its query to `/api/query`. The backend builds the answer from a fresh snapshot and returns a DTO, which the frontend puts into a ResourceSlice.

**Refresh after a change.** `dataChanged` makes the top reload the reference data and the visible tab with new queries (2.7), so every view comes from the backend and no local copy is patched. The other tabs reload when the user next opens them.

**Startup.** The backend starts first: it reads the store and, if the store is fresh, seeds it before it accepts requests. The frontend then runs `AppCoordinator.startup`, which draws the frame, loads the reference data and the Inventory tab, and starts the midnight timer. If the backend is not reachable yet, the first calls end in NETWORK\_ERROR notices and a page reload retries.

**Midnight tick.** At local 00:00 the browser's timer calls `onTick`, which runs `refreshVisible`. The new queries carry the new date, so statuses move on (a batch whose last usable day was yesterday is now Expired) without any frontend date arithmetic.

**Simulated Today.** The backend stores the demo date through `SetSimulatedToday`. Every later request resolves `today` from it, and the reply's `meta.today` shows it. Clearing it returns to the device clock. The backend runs on the user's machine, so that clock is the device clock; the frontend's only use of time is the midnight timer.

**Errors.** A backend failure arrives as `ok: false` with a family and a code from Part 1.2. Transport failures never reach the backend: `ApiGateway` reports NETWORK\_ERROR or TIMEOUT, and `ApiResponseParser` reports BAD\_JSON (a success status with a body that is not JSON), BAD\_RESPONSE (JSON that is not an `ApiResponse` of the kind that was asked for) or HTTP\_STATUS (the status and the body disagree: an error status with no `ApiResponse` in it, such as a proxy's error page, or a success status that carries a failure). All of them reach the sub-coordinator as one `Err`, and `ErrorNoticeMapper` turns it into a notice with field hints. The six form-only codes are raised in the browser and never travel.

**A recipe deleted while queued.** The queue exists only in the browser, so `recipeDeleted` prunes it. If a stale id still reaches the backend, the cook report lists it as skipped instead of failing the run.

**No backend state.** The backend keeps nothing between requests. Each one loads a full snapshot and caches nothing, and the single-user demo serves one request at a time.

## Part 4 — Coordinator scheduling pseudocode

Every coordinator fits in 40 lines of pseudocode, and the longest block is 40. Each line is a module call, a gateway call or a routing choice; none computes a business value. The blocks use the module, workflow and message names of Parts 1 to 3.

### 4.1 Notation and front-end templates

| Notation | Meaning |
| --- | --- |
| `x = Module(args)` | Calls a module. A gateway is called as `Gateway.method(args)` and appears only in the two top coordinators. |
| `x = Module(args)?` | The module returns a `Result`. On `Err` the workflow returns that `Err` at once: the short-circuit path drawn in Part 2. |
| `run(block)` | Evaluates a block and turns its first `Err`, or its value, into a `Result`. |
| `x else f` | The value of `x`, or `f(err)` when `x` is an `Err`. |
| `Outcome{changeSets, payload}` | What a backend workflow returns. A query leaves `changeSets` out. |
| `commit(cs, payload?)` | Shorthand for `Outcome{changeSets: [cs], payload}`: one change set, and a payload only when the workflow has one. |
| `route(type).handle(msg, snap, today)` | The backend top finds the sub-coordinator that owns a message type (table in 3.4). `handle` runs the workflow named after the type, so the backend blocks show the workflows only. |
| Shared step | A helper that two or more workflows of one coordinator call, such as `derive` in the QueryCoordinator or `apply` in the AppCoordinator. It is local to that coordinator and is not a workflow. The lead-in of each block names its shared steps. |
| `st.k` | A front-end sub-coordinator's private state for its slice instance `k`. A form's key is also its event namespace. |
| `ev`, `ev.f` | A front-end event, and field `f` of its payload (`UiPayloads` of the `ui` contract). `OPEN(…, ev)` hands the whole payload over as the view data of the form. An input or a select also has the `value` that the DOM host added. `ev.action` is the `QueueAction` that a `cook` event stands for: its name is the type, and its payload holds the rest. |
| `draw(k)` | Mounts every view that shows slice `k`: `ctx.mount(slot, View(state))`. The first lines of a block name the views. |
| `[navigate(..), notify(..)]` | The `Intent[]` that a front-end workflow returns (table in 3.3). |
| `if a then b else c` | An expression. `or`, `and`, `in`, `+=` and `where` read as in any scripting language. |

The Load shape and the Form shape of 3.3 are written out once below as four templates. `LOAD` is the Load shape. `OPEN`, `INPUT` and `SUBMIT` are the open step, the edit, row and cancel steps, and the submit step of the Form shape. A template is a text pattern, not shared code: each coordinator carries its own expansion, so no coordinator depends on another, and the line estimates in 3.1 are for the expanded code.

```text
-- Front-end templates. Each coordinator expands them in place; nothing here is shared code.
LOAD(k, msg):                                    -- k: a Resource slice
  st.k = ResourceSlice(st.k, loading);           draw(k)
  r = ctx.callApi(msg)                           -- ApiGateway, then ApiResponseParser
  if r is Err:
    st.k = ResourceSlice(st.k, failed(r.err));   draw(k)
    return [notify(ErrorNoticeMapper(r.err, {message: msg}))]
  st.k = ResourceSlice(st.k, ready(r.value));    draw(k)
  return []

OPEN(k, kind, data, at = editing):               -- k: a Form slice
  vals = FormPrefillBuilder(kind, data, ctx.reference())
  st.k = FormSlice(st.k, open(kind, vals, at));  draw(k)
  return []

INPUT(k, ev):                                    -- the edit, row and cancel events
  st.k = FormSlice(st.k, action(ev))             -- edit(ev.field, ev.value), addRow(ev.group, ev.fields), removeRow(ev.group, ev.index) or close
  draw(k);  return []

SUBMIT(k, SCHEMA, msg):
  p = FormSchemaParser(SCHEMA, st.k.values)
  if p is Err:                                   -- no request is sent
    st.k = FormSlice(st.k, rejected(ErrorNoticeMapper(p.err, null).fieldHints));  draw(k)
    return []
  st.k = FormSlice(st.k, submitting);            draw(k)
  r = ctx.callApi(msg(p.value))
  if r is Err:
    n = ErrorNoticeMapper(r.err, {message: msg})
    st.k = FormSlice(st.k, rejected(n.fieldHints));  draw(k)   -- back to editing, or confirming
    return [notify(n)]
  st.k = FormSlice(st.k, closed);                draw(k)
  return [dataChanged]
```

### 4.2 Backend coordinators

The top coordinator is the only backend code that touches a gateway. Every sub-coordinator is IO-free and receives `snap` and `today` as plain values.

**BackendCoordinator** (top). Workflows: handleCommand, handleQuery, startup. Shared steps: load, persist. 39 lines.

```text
BackendCoordinator                       -- top; the only backend owner of gateways

handleCommand(raw):                      -- raw: the gateway's body, or its PAYLOAD_TOO_LARGE
  r = run(() =>
    body  = raw?
    cmd   = CommandParser(body)?
    snap  = load()?
    today = TodayResolver(ClockGateway.today(), snap.settings.simulatedToday)
    out   = route(cmd.type).handle(cmd, snap, today)?
    persist(snap, out.changeSets)?
    return {payload: out.payload, today})
  return ApiResponseBuilder(r)

handleQuery(raw):                        -- the same pipeline; nothing is persisted
  r = run(() =>
    body  = raw?
    q     = QueryParser(body)?
    snap  = load()?
    today = TodayResolver(ClockGateway.today(), snap.settings.simulatedToday)
    out   = route(q.type).handle(q, snap, today)?
    return {payload: out.payload, today})
  return ApiResponseBuilder(r)

startup():                               -- an Err stops the start
  snap = load()?
  if not snap.settings.bootstrapped:
    seedRaw = SeedSourceGateway.read()?
    out     = ReferenceCommandCoordinator.bootstrap(seedRaw, snap)?
    persist(snap, out.changeSets)?
  HttpServerGateway.serve(handleCommand, handleQuery)

load():  return SnapshotParser(StoreReadGateway.read()?)?

persist(snap, changeSets):               -- once per ChangeSet, in order
  for cs in changeSets:
    next = ChangeSetApplier(snap, cs)?
    SnapshotInvariantChecker(next)?
    StoreWriteGateway.apply(ChangeSetEncoder(cs))?
    snap = next
```

**ReferenceCommandCoordinator**. Workflows: bootstrap, setSimulatedToday, saveCategory, deleteCategory, setCategoryThreshold, saveFoodType, deleteFoodType. 40 lines.

```text
ReferenceCommandCoordinator              -- IO-free; the top calls bootstrap itself, at startup

bootstrap(seedRaw, snap):
  base   = SystemDataInitializer(snap)                      -- the two reserved Other categories
  parsed = SeedBundleParser(seedRaw)?
  alloc  = IdAllocator(snap.counters, {ids: parsed.idDemand, seqs: 0})
  plan   = SeedPlanner(parsed, alloc.ids, snap)             -- the pre-load; bootstrapped = true
  return commit(ChangeSetMerger([base, alloc.counterCs, plan]))

setSimulatedToday(cmd):  return commit(SettingsDecider(cmd.date))      -- null clears it

saveCategory(cmd, snap):                                    -- cmd.scope: food or cuisine tree
  name = NameValidator(cmd.name, cmd.scope, snap, cmd.categoryId)?
  if cmd.categoryId != null:                                -- rename
    cs = CategoryRenameDecider(cmd.scope, cmd.categoryId, name, snap)?
    return commit(cs, {categoryId: cmd.categoryId})
  alloc = IdAllocator(snap.counters, {ids: 1, seqs: 0})     -- create
  cs    = CategoryCreateDecider(cmd.scope, name, cmd.parentId, snap, alloc.ids[0])?
  return commit(ChangeSetMerger([alloc.counterCs, cs]), {categoryId: alloc.ids[0]})

deleteCategory(cmd, snap):  return commit(CategoryDeleteDecider(cmd.scope, cmd.categoryId, snap)?)

setCategoryThreshold(cmd, snap):
  thr = if cmd.thresholdDays == null then null
        else ScalarValidator("thresholdDays", cmd.thresholdDays)?
  return commit(CategoryThresholdDecider(cmd.categoryId, thr, snap)?)

saveFoodType(cmd, snap):
  name = NameValidator(cmd.name, FOOD_TYPE, snap, cmd.foodTypeId)?
  thr  = if cmd.thresholdDays == null then null
         else ScalarValidator("thresholdDays", cmd.thresholdDays)?
  if cmd.foodTypeId != null:                                -- edit
    cs = FoodTypeEditDecider(cmd.foodTypeId, name, cmd.categoryId, thr, snap)?
    return commit(cs, {foodTypeId: cmd.foodTypeId})
  unit  = ScalarValidator("unit", cmd.unit)?                -- create
  alloc = IdAllocator(snap.counters, {ids: 1, seqs: 0})
  cs    = FoodTypeCreateDecider(name, cmd.categoryId, unit, thr, snap, alloc.ids[0])?
  return commit(ChangeSetMerger([alloc.counterCs, cs]), {foodTypeId: alloc.ids[0]})

deleteFoodType(cmd, snap):  return commit(FoodTypeDeleteDecider(cmd.foodTypeId, snap)?)
```

**InventoryCommandCoordinator**. Workflows: inbound, editQuantity, removeBatch, changeUnit. 31 lines.

```text
InventoryCommandCoordinator              -- IO-free; every write that changes how much is in stock

inbound(cmd, snap, today):
  ref   = FoodTypeResolver(cmd.foodTypeId, cmd.foodName, snap)?
  qty   = ScalarValidator("qty", cmd.quantity)?
  dates = ExpiryResolver(cmd.expiry, today)?              -- {days} or {date}
  need  = if ref is new then 2 else 1                     -- Food Type id + batch id, or batch id
  alloc = IdAllocator(snap.counters, {ids: need, seqs: 1})
  parts = [alloc.counterCs]
  ftId  = if ref is new then alloc.ids[0] else ref.foodType.id
  if ref is new:
    name   = NameValidator(ref.name, FOOD_TYPE, snap, null)?
    unit   = ScalarValidator("unit", cmd.unit)?
    parts += FoodTypeCreateDecider(name, cmd.categoryId, unit, null, snap, ftId)?
  CapChecker(snap, {kind: add, foodTypeId: ftId, qty})?
  parts += BatchCreateDecider(ftId, qty, dates, last(alloc.ids), alloc.seqs[0])
  return commit(ChangeSetMerger(parts))

editQuantity(cmd, snap):
  qty = ScalarValidator("qty", cmd.quantity)?
  CapChecker(snap, {kind: edit, batchId: cmd.batchId, qty})?
  return commit(BatchQuantityEditDecider(cmd.batchId, qty, snap)?)

removeBatch(cmd, snap):  return commit(BatchRemoveDecider(cmd.batchId, snap)?)

changeUnit(cmd, snap):                                      -- the unit and every batch quantity
  unit = ScalarValidator("unit", cmd.unit)?
  rows = []
  for r in cmd.batches:  rows += {batchId: r.batchId, qty: ScalarValidator("qty", r.quantity)?}
  CapChecker(snap, {kind: convert, foodTypeId: cmd.foodTypeId, rows})?
  return commit(UnitChangeDecider(cmd.foodTypeId, unit, rows, snap)?)
```

**RecipeCommandCoordinator**. Workflows: saveRecipe, deleteRecipe, cookRecipes. 32 lines.

```text
RecipeCommandCoordinator                 -- IO-free, so the whole cook loop can be replayed

saveRecipe(cmd, snap):
  name  = NameValidator(cmd.name, RECIPE, snap, cmd.recipeId)?
  draft = RecipeDraftValidator(cmd.draft, snap)?
  need  = if cmd.recipeId == null then 1 else 0           -- an id only when creating
  alloc = IdAllocator(snap.counters, {ids: need, seqs: 0})
  cs    = RecipeUpsertDecider(cmd.recipeId, name, draft, snap, alloc.ids[0])?
  return commit(ChangeSetMerger([alloc.counterCs, cs]), {recipeId: cmd.recipeId or alloc.ids[0]})

deleteRecipe(cmd, snap):  return commit(RecipeDeleteDecider(cmd.recipeId, snap)?)

cookRecipes(cmd, snap, today):
  cur = snap;  sets = [];  reports = []
  for recipeId in cmd.recipeIds:                 -- queue order; a recipe queued twice runs twice
    th    = ThresholdResolver(cur)               -- derive again on the running copy
    views = BatchStatusClassifier(cur.batches, th, today)
    stock = StockAggregator(cur, views)
    errs  = RecipeErrorEvaluator(cur)
    m     = RecipeMatchEvaluator(cur, stock, errs, [recipeId])   -- Err: the recipe is gone
    match = if m is Err then null else m.value[recipeId]
    if match == null or match.status == blocked or match.availableCount == 0:
      reports += CookReportBuilder(recipeId, match, [], cur)     -- a skipped entry, not an exit
      continue
    allocs = []
    for row in match.rows where row.fulfilled:
      allocs += FefoAllocator(row.foodTypeId, row.qReq, views)?  -- INSUFFICIENT_STOCK
    cs = CookChangeSetBuilder(recipeId, allocs, cur)?            -- BATCH_NOT_FOUND
    reports += CookReportBuilder(recipeId, match, allocs, cur)
    cur = ChangeSetApplier(cur, cs)?                             -- CONFLICTING_OPS, UNKNOWN_TARGET
    sets += cs
  return Outcome{changeSets: sets, payload: {reports}}
```

**QueryCoordinator**. Workflows: getReferenceData, getInventoryList, getFoodTypeDetail, getWarningPanel, getRecommendations, getCatalog. Shared step: `derive`. 39 lines.

```text
QueryCoordinator                         -- IO-free; reads only, so it returns no change set

derive(snap, today):                     -- shared step: the derive chain behind four of the reads
  th    = ThresholdResolver(snap)
  views = BatchStatusClassifier(snap.batches, th, today)
  return {th, views, stock: StockAggregator(snap, views)}

getReferenceData(q, snap, today):  return Outcome{payload: ReferenceDataProjector(snap, today)}

getInventoryList(q, snap, today):
  d     = derive(snap, today)
  paths = CategoryPathResolver(snap)
  order = NameSorter(snap.foodTypes)
  return Outcome{payload: InventoryListProjector(snap, d.stock, paths, order)}

getFoodTypeDetail(q, snap, today):
  d     = derive(snap, today)
  paths = CategoryPathResolver(snap)
  dto   = FoodTypeDetailProjector(q.foodTypeId, snap, d.views, d.th, d.stock, paths)?
  return Outcome{payload: dto}

getWarningPanel(q, snap, today):
  views = BatchStatusClassifier(snap.batches, ThresholdResolver(snap), today)
  return Outcome{payload: WarningPanelProjector(views, snap, NameSorter(snap.foodTypes))}

getRecommendations(q, snap, today):
  d     = derive(snap, today)
  errs  = RecipeErrorEvaluator(snap)
  match = RecipeMatchEvaluator(snap, d.stock, errs, null)?   -- null: every recipe
  order = NameSorter(snap.recipes)
  return Outcome{payload: RecommendationBuilder(match, d.stock, snap, order)}

getCatalog(q, snap, today):
  d     = derive(snap, today)
  errs  = RecipeErrorEvaluator(snap)
  match = RecipeMatchEvaluator(snap, d.stock, errs, null)?
  order = NameSorter(snap.recipes)
  dto   = CatalogBuilder(match, errs, snap, order, q.cuisineId)?    -- CATEGORY_NOT_FOUND
  return Outcome{payload: dto}
```

### 4.3 Frontend coordinators

The top coordinator owns the three gateways and builds `ctx`. A sub-coordinator reaches the network and the DOM only through `ctx`, and reaches another sub-coordinator only through the intents it returns.

**AppCoordinator** (top). Workflows: startup, dispatch, onTick. Shared steps: apply, refreshVisible. 39 lines.

```text
AppCoordinator                           -- top; the only frontend owner of gateways
ROUTE = the ui contract's table: event namespace -> sub-coordinator
ctx = { callApi(msg)      = ApiResponseParser(ApiGateway.send(Envelope(msg))?, msg.kind),
        mount(slot, tree) = DomHostGateway.mount(slot, tree) else showError,
        reference()       = Shell.referenceData() }
showError(e) = apply([notify(ErrorNoticeMapper(e, null))])

startup():
  DomHostGateway.onEvent(dispatch)
  apply(Shell.navigate(HOME, null, ctx))                -- draws the frame
  refreshVisible()
  MidnightTimerGateway.subscribe(onTick)

dispatch(ev):
  owner = ROUTE[ev.ns]
  if owner == null:  return showError(BAD_ENVELOPE)     -- an unrouted event is a bad envelope
  apply(owner.handle(ev, ctx))

onTick():  refreshVisible()

apply(intents):                           -- in order; a call may return more intents
  for i in intents:
    match i.kind:
      navigate:      apply(Shell.navigate(i.tab, i.detail, ctx))
      notify:        apply(Shell.pushNotice(i.notice, ctx))
      dataChanged:   refreshVisible()
      openInCook:    apply(Shell.navigate(CATALOG, null, ctx))
                     apply(RecipeBook.highlightRecipe(i.recipeId, ctx))
      recipeDeleted: apply(Cooking.editQueue(prune(i.recipeId), ctx))

refreshVisible():
  apply(Shell.loadReferenceData(ctx))
  nav = Shell.navigation()
  match nav.tab:
    INVENTORY:       apply(Inventory.refresh(nav.detail, ctx))
    WARNINGS:        apply(Inventory.loadWarnings(ctx))
    RECOMMENDATIONS: apply(RecipeBook.loadRecommendations(ctx))
    CATALOG:         apply(RecipeBook.loadCatalog(ctx))
    CATEGORIES:      apply(Taxonomy.redraw(ctx))        -- the trees come with the reference data
```

**ShellCoordinator**. Workflows: navigate, pushNotice, dismissNotice, loadReferenceData, submitSimulatedToday. The accessors `navigation` and `referenceData` are read by the top; `referenceData` feeds `ctx.reference()`. 29 lines.

```text
ShellCoordinator             -- navigation -> AppShellView · notices -> NoticeBarView
                             -- referenceData · settings -> DemoControlView

handle(ev, ctx):                         -- namespaces: shell, settings
  match ev.name:
    "navigate":        return navigate(ev.tab, ev.detail, ctx)   -- a tab click or the detail's back
    "dismiss":         return dismissNotice(ev.noticeId, ctx)
    "open":            return OPEN(settings, settingsForm, ev)
    "edit", "cancel":  return INPUT(settings, ev)
    "submit":          return SUBMIT(settings, SETTINGS, SetSimulatedToday)  -- submitSimulatedToday

navigate(tab, detail, ctx):
  was = st.navigation.tab
  st.navigation = NavigationSlice(st.navigation, go(tab, detail));  draw(navigation)
  return if tab != was then [dataChanged] else []         -- opening or closing a detail: nothing

pushNotice(notice, ctx):
  st.notices = NoticeSlice(st.notices, push(notice));  draw(notices)
  return []

dismissNotice(id, ctx):
  st.notices = NoticeSlice(st.notices, dismiss(id));  draw(notices)
  return []

loadReferenceData(ctx):
  return LOAD(referenceData, GetReferenceData{})

navigation():     return st.navigation                      -- read by the top
referenceData():  return st.referenceData.context.data      -- read by the top for ctx.reference()
```

**InventoryCoordinator**. Workflows: loadList, openDetail, refresh, loadWarnings, addBatch, editBatchQuantity, removeBatch. 34 lines.

```text
InventoryCoordinator         -- inventoryList -> InventoryListView
                             -- foodTypeDetail -> FoodTypeDetailView
                             -- warningPanel -> WarningPanelView
                             -- batch -> BatchFormView · batchRemove -> ConfirmDialogView

handle(ev, ctx):                         -- namespaces: inventory, batch, batchRemove
  match ev.name:
    "openDetail":         return openDetail(ev.foodTypeId, ctx)
    "edit", "cancel":     return INPUT(ev.ns, ev)
    "addBatch":           return OPEN(batch, batchAdd, ev)
    "pickFoodType":       vals = FormPrefillBuilder(batchAdd, ev, ctx.reference())
                          st.batch = FormSlice(st.batch, refill(vals));  draw(batch);  return []
    "editBatchQuantity":  return OPEN(batch, batchQty, ev)
    "removeBatch":        return OPEN(batchRemove, batchRemove, ev, confirming)
    "submit":
      match st[ev.ns].kind:
        batchAdd:     return SUBMIT(batch, BATCH_ADD, InboundBatch)
        batchQty:     return SUBMIT(batch, BATCH_QTY, EditBatchQuantity)
        batchRemove:  return SUBMIT(batchRemove, TARGET, RemoveBatch)

loadList(ctx):
  return LOAD(inventoryList, GetInventoryList{})

openDetail(foodTypeId, ctx):
  intents = LOAD(foodTypeDetail, GetFoodTypeDetail{foodTypeId})
  return [navigate(INVENTORY, foodTypeId)] + intents        -- the Shell records the open detail

refresh(detailId, ctx):                  -- the top calls it for the Inventory tab
  intents = loadList(ctx)
  if detailId != null:  intents += LOAD(foodTypeDetail, GetFoodTypeDetail{detailId})
  return intents

loadWarnings(ctx):
  return LOAD(warningPanel, GetWarningPanel{})
```

**TaxonomyCoordinator**. Workflows: saveFoodType, changeUnit, deleteFoodType, saveCategory, deleteCategory, setThreshold. The `redraw` hook is not a workflow: it sends no request and changes no state. 30 lines.

```text
TaxonomyCoordinator          -- foodType -> FoodTypeFormView
                             -- unitConversion -> UnitConversionModalView
                             -- category · threshold -> CategoryManagerView
                             --   (its trees come from ctx.reference())
                             -- foodTypeDelete · categoryDelete -> ConfirmDialogView

handle(ev, ctx):          -- namespaces: foodType, unitConversion, foodTypeDelete,
  match ev.name:          --   category, threshold, categoryDelete
    "edit", "cancel":  return INPUT(ev.ns, ev)
    "newFoodType":     return OPEN(foodType, foodTypeCreate, ev)               -- saveFoodType
    "editFoodType":    return OPEN(foodType, foodTypeEdit, ev)
    "changeUnit":      return OPEN(unitConversion, unitChange, ev)             -- changeUnit
    "deleteFoodType":  return OPEN(foodTypeDelete, foodTypeDelete, ev, confirming)
    "newCategory":     return OPEN(category, categoryCreate, ev)               -- saveCategory
    "renameCategory":  return OPEN(category, categoryRename, ev)
    "setThreshold":    return OPEN(threshold, thresholdSet, ev)                -- setThreshold
    "deleteCategory":  return OPEN(categoryDelete, categoryDelete, ev, confirming)
    "submit":
      match ev.ns:
        foodType:        return SUBMIT(foodType, FOOD_TYPE, SaveFoodType)
        unitConversion:  return SUBMIT(unitConversion, UNIT_CHANGE, ChangeFoodTypeUnit)
        foodTypeDelete:                                                        -- deleteFoodType
          i = SUBMIT(foodTypeDelete, TARGET, DeleteFoodType)
          return if dataChanged in i then [navigate(INVENTORY, null)] + i else i
        category:        return SUBMIT(category, CATEGORY, SaveCategory)
        threshold:       return SUBMIT(threshold, THRESHOLD, SetCategoryThreshold)
        categoryDelete:  return SUBMIT(categoryDelete, TARGET, DeleteCategory)   -- deleteCategory

redraw(ctx):                   -- a hook for the top, not a workflow: no request, no state change
  draw(category);  return []
```

**RecipeBookCoordinator**. Workflows: loadRecommendations, openInCook, loadCatalog, setCuisineFilter, highlightRecipe, saveRecipe, deleteRecipe. 37 lines.

```text
RecipeBookCoordinator        -- recommendations -> RecommendationView
                             -- catalog · catalogView -> RecipeCatalogView
                             -- recipe -> RecipeFormView · recipeDelete -> ConfirmDialogView

handle(ev, ctx):                   -- namespaces: recommendations, catalog, recipe, recipeDelete
  match ev.name:
    "openInCook":       return [openInCook(ev.recipeId)]   -- Feature 3 recommends; catalog cooks
    "setCuisineFilter": return setCuisineFilter(ev.cuisineId, ctx)
    "edit", "addRow", "removeRow", "cancel":   return INPUT(ev.ns, ev)
    "newRecipe":        return OPEN(recipe, recipeCreate, ev)                     -- saveRecipe
    "editRecipe":       return OPEN(recipe, recipeEdit, ev)
    "deleteRecipe":     return OPEN(recipeDelete, recipeDelete, ev, confirming)
    "submit":
      match ev.ns:
        recipe:        return SUBMIT(recipe, RECIPE, SaveRecipe)
        recipeDelete:                                                             -- deleteRecipe
          id = st.recipeDelete.values.id
          i  = SUBMIT(recipeDelete, TARGET, DeleteRecipe)
          return if dataChanged in i then [recipeDeleted(id)] + i else i

loadRecommendations(ctx):
  return LOAD(recommendations, GetRecommendations{})

loadCatalog(ctx):
  intents = LOAD(catalog, GetCatalog{cuisineId: st.catalogView.cuisineId})
  if st.catalog is failed with CATEGORY_NOT_FOUND:           -- the cuisine was deleted meanwhile
    st.catalogView = CatalogViewSlice(st.catalogView, cuisine(null))
    return LOAD(catalog, GetCatalog{cuisineId: null})
  return intents

setCuisineFilter(cuisineId, ctx):        -- the backend does the filtering
  st.catalogView = CatalogViewSlice(st.catalogView, cuisine(cuisineId))
  return loadCatalog(ctx)

highlightRecipe(recipeId, ctx):          -- the top calls it after openInCook
  st.catalogView = CatalogViewSlice(st.catalogView, highlight(recipeId));  draw(catalogView)
  return []
```

**CookingCoordinator**. Workflows: editQueue, runCook, dismissReport. 26 lines.

```text
CookingCoordinator           -- cookQueue -> CookQueueView · cookReport -> CookReportView

handle(ev, ctx):                         -- namespace: cook
  match ev.name:
    "add", "remove", "move", "clear":  return editQueue(ev.action, ctx)
    "run":                             return runCook(ctx)
    "dismiss":                         return dismissReport(ctx)

editQueue(action, ctx):                  -- add, remove, move, prune, clear; the queue is transient
  st.cookQueue = CookQueueSlice(st.cookQueue, action);  draw(cookQueue)
  return []

runCook(ctx):
  st.cookReport = ResourceSlice(st.cookReport, loading);  draw(cookReport)
  r = ctx.callApi(CookRecipes{recipeIds: st.cookQueue.recipeIds})
  if r is Err:                                  -- the queue stays, so the user can retry
    st.cookReport = ResourceSlice(st.cookReport, idle);  draw(cookReport)
    return [notify(ErrorNoticeMapper(r.err, {message: CookRecipes})), dataChanged]
  st.cookReport = ResourceSlice(st.cookReport, ready(r.value))
  st.cookQueue  = CookQueueSlice(st.cookQueue, clear)
  draw(cookQueue);  draw(cookReport)                         -- the report view opens
  return [dataChanged]                                       -- recipes may already be cooked

dismissReport(ctx):
  st.cookReport = ResourceSlice(st.cookReport, idle);  draw(cookReport)
  return []
```
