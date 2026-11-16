# FreshRescue MVP v1.3 — Implementation Plan

## Overview

This plan builds the FreshRescue MVP in **12 phases, numbered 0 to 11**. It implements exactly what the two confirmed documents describe and adds nothing: spec v1.3 (business rules, worked examples, the 23-row exception matrix, the Appendix A sample data) and the architecture blueprint (83 modules, 11 coordinators, 9 read-only contract packages, 13 commands, 6 queries, 58 error codes). As requested, there is no audit logging and no CI/CD.

**The rule that organizes everything:** a phase starts only after the previous phase is fully verified. "Verified" is mechanical, not a judgement call. Every phase ends with an exit gate, `npm run gate -- N`, which runs every check from phase 0 up to N in order and stops at the first failure. Because the gate is cumulative, later work cannot quietly break earlier work. The first task of every phase is to run the previous gate; if it is red, nothing new starts.

Each phase section has the same parts:

| Part | What it gives you |
| :-- | :-- |
| Goal | One sentence: the capability that exists afterwards |
| Depends on | The gate that must already be green |
| What gets built | The workspaces, modules and files, by name and count, in build order. A command appears only where a setup step needs one, and there is no source code |
| Verification | A table of check, command and pass condition. Each row is also an entry in `tools/gates.json`, so the gate runs it |
| Exit gate | The one command that proves the whole phase |

**Order of work.** Phases 0 to 2 prepare the ground: toolchain, structure, contracts. Phases 3 to 7 build the backend from the inside out: pure modules, then coordinators on in-memory gateways, then MySQL and Express. Phases 8 and 9 build the frontend the same way. Phase 10 proves the whole product against the specification and Phase 11 packages it in Docker. Modules inside a phase import contracts only, so they can be built in any order within that phase.

**How this plan was checked.** Phases 0 to 2 were run end to end in a scratch folder (Linux, Node 22.23): clean install from the lockfile, typecheck, lint, tests, the Next.js build, API and web boot, the `/api` rewrite, the guard-rail tests and all nine contract packages. Gates 0, 1 and 2 pass with 7, 10 and 12 checks. Phases 3 to 11 are specified but not executed, because they are the work this plan describes. Two things could not run in the scratch folder: MySQL and the Docker daemon. Phase 7 (MySQL) and Phase 11 (Docker) are therefore specified with extra care but have not been executed; the DDL was parsed with a MySQL grammar and the Compose file validated with `docker compose config`, and their gates are the first time those parts really run. Versions in this plan are those resolved from the npm registry on 2026-11-12.

## Technology decisions

Every technology on your list has a defined job. Each optional library is either adopted for named modules or left out for a stated reason.

| Technology | Its job in FreshRescue | Version used |
| :-- | :-- | :-- |
| TypeScript | All code, in strict mode with `noUncheckedIndexedAccess` and `verbatimModuleSyntax` | 6.0.3, pinned `~6.0` |
| Node.js | Runtime for the API, tests and tooling | 22.22.2+ or 24.15+ |
| Next.js and React | Build, dev server and the `/api` proxy for the browser app. One client component mounts the blueprint's UI | 16.4.6 and 19.3.1 |
| Tailwind CSS | Styling. Class tokens live in the `ui` contract | 4.3.5 |
| Express | HTTP binding of the backend (`HttpServerGateway`) | 5.3.0 |
| MySQL and `mysql2` | The store behind `StoreReadGateway` and `StoreWriteGateway` | MySQL 8.0.19+ (8.4 LTS in Docker), `mysql2` 3.24.6 |
| Vitest | Four projects: `node`, `dom` (jsdom), `db`, `e2e` | 5.1.0 |
| ESLint | Code analysis, and the executable form of the blueprint's four rules | 10.14.0, typescript-eslint 8.72.2, eslint-config-next 16.4.6 |
| Docker and Compose | Images for the API and web app, plus MySQL, in Phase 11 | MySQL image `mysql:8.4` |

**The optional libraries**

| Library | Decision | Where it is used, or why not |
| :-- | :-- | :-- |
| Joi 18.3.2 | Adopt | The four backend parsers: `CommandParser`, `QueryParser`, `SnapshotParser`, `SeedBundleParser`. Joi's error types map onto the shape codes (`MISSING_FIELD`, `WRONG_TYPE`, `BAD_COMBINATION`). The frontend's form parser is hand-written, because its codes (`QTY_FORMAT`, `QTY_DECIMALS`) are text-to-number rules, and this keeps Joi out of the browser bundle |
| http-status-codes 2.3.0 | Adopt | The `errors` contract builds the code-to-HTTP-status table from `StatusCodes`. The library names 413 `REQUEST_TOO_LONG`, not `PAYLOAD_TOO_LARGE` |
| XState 5.33.4 | Adopt, narrowly | `ResourceSlice` and `FormSlice` are real state machines with several states. Their transition tables become XState machines, run through `getNextSnapshot` on plain `{ value, context }` data, so the slices stay pure reducers. The other four slices are one-line reducers and gain nothing from XState |
| fuse.js | Not adopted | Nothing in spec v1.3 is fuzzy. A Food Type is found by id or by exact case-insensitive name, and no match creates a new Food Type (exception #18). A fuzzy match would silently file "Mlik" under "Milk". If a search box is added later, it belongs in a new frontend computation module |

Also installed, development only: `tsx` (runs the TypeScript API), `concurrently` (runs API and web together), `jsdom`, `@eslint/js`, `globals`.

**How Next.js fits the blueprint.** The 16 puppet views return a `RenderTree`, which is plain data, and `DomHostGateway` paints it into DOM slots. React is therefore used for one thing: a client component that creates the gateways and coordinators and calls `AppCoordinator.startup`. All 26 frontend modules stay framework-free, which is what lets Vitest test them in jsdom without a browser. Next.js supplies the bundler, the dev server, the Tailwind pipeline and the `/api/*` rewrite to Express, so the browser never makes a cross-origin call and no CORS setup is needed.

**Three version facts that shape the setup**

- TypeScript is pinned to 6.0.x. TypeScript 7.0.2 is the registry's `latest`, but typescript-eslint 8.72.2 only supports `>=4.8.4 <6.1.0`. The pin stops a later `npm update` from jumping to 7. Revisit it when typescript-eslint adds TypeScript 7.
- Node 22.22.2 is the floor because jsdom 31 requires `^22.22.2 || ^24.15.0 || >=26`. A `.npmrc` with `engine-strict=true` makes `npm install` stop with a clear message on an older Node instead of failing later in odd ways.
- `@types/node` is pinned to the 22 line, so the compiler rejects Node APIs that the minimum runtime does not have.

## Phase map

Phases run strictly in this order. The last column is what the exit gate adds on top of everything earlier.

&#91;embedded content: phase roadmap · 12 phases, 12 gates\]

Colour groups the phases by what they build. The table below says what exists after each phase and what its gate adds.

| Phase | Name | What exists afterwards | The gate adds proof that |
| :-- | :-- | :-- | :-- |
| 0 | Environment and initialization | All dependencies installed, five starter workspaces, MySQL databases, the gate runner | A clean install passes typecheck, lint, tests and the Next.js build; API and web boot; the `/api` rewrite and Tailwind work; MySQL answers |
| 1 | Monorepo structure and guard rails | All 13 workspaces and the full folder tree, ESLint guard rails, the module manifest | The layout is exact, import layers hold, and the lint rules reject every forbidden import, clock, IO and size pattern |
| 2 | Contracts | The 9 contract packages: types and constants only | 58 error codes, 19 messages, the HTTP status table and the seed schema are complete and consistent |
| 3 | Backend modules A | 13 modules: 4 parsers, `ChangeSetApplier`, validators, ids, expiry, status | Every error code of these modules has a test; the spec's date and threshold examples pass |
| 4 | Backend modules B | 20 modules: derived state, projections, cook engine, guards | Stock, status, recipe match, FEFO and the invariant checker give the spec's results |
| 5 | Backend modules C | 16 modules: the deciders, `FoodTypeResolver`, `RecipeDraftValidator` | Every command's decision and cascade rule holds as a ChangeSet |
| 6 | Backend coordinators | The 5 backend coordinators on in-memory gateways | All 13 commands and 6 queries work end to end, without HTTP or MySQL |
| 7 | MySQL, real gateways, Express | Schema migration, 5 gateways, the API server | One conformance suite passes on both memory and MySQL; HTTP contract, restart persistence and concurrency hold |
| 8 | Frontend modules | 26 modules: 2 parsers, 2 computations, 6 slices, 16 puppet views | Every form error code is produced by a test, and each of the 16 views turns state into a RenderTree without touching the DOM |
| 9 | Frontend coordinators, gateways, Next.js app | The 6 frontend coordinators, 3 gateways, the mounted app | Every workflow runs against a fake API in jsdom; the production build serves the app |
| 10 | Integration and acceptance | The whole product on real HTTP and real MySQL | The spec's worked examples and all 23 exception rows pass; all 58 error codes are accounted for |
| 11 | Docker packaging | Dockerfile, Compose with MySQL, release check | `docker compose up` gives a working app that survives a restart |

The gate for Phase N always includes the gates of Phases 0 to N-1, so phases 3 to 5 re-run the same manifest check with a growing scope, and Phase 10 re-runs everything.

## Phase 0 — Environment, dependencies and initialization

**Goal.** An empty folder becomes a project in which every tool on your list is installed, configured and proven to work together, including a live connection to MySQL.

**Depends on.** Nothing. This is the starting point.

**Before you start**

| Need | Check | Pass condition |
| :-- | :-- | :-- |
| Node.js | `node -v` | 22.22.2 or newer in the 22 line, or 24.15 or newer |
| npm and npx | `npm -v` and `npx -v` | Both print a version (npm 10 or newer) |
| MySQL server, running | `mysql --version` | 8.0.19 or newer |
| MySQL admin login | `mysql -u root -p -e "SELECT VERSION()"` | Prints a version. Use your own admin user if it is not `root` |
| Free ports | 3000 and 4000 | Nothing is listening on them |

The commands are POSIX shell. On Windows, use WSL or Git Bash.

### What gets built

**Step 1. Create the root project.** Run this from the folder that will contain the project folder.

```bash
mkdir freshrescue && cd freshrescue
git init -q
npm init -y > /dev/null
npm pkg set name=freshrescue version=0.0.0 type=module
npm pkg set --json private=true
npm pkg set engines.node="^22.22.2 || ^24.15.0 || >=26.0.0"
npm pkg set --json workspaces='["contracts/*","packages/*","apps/*"]'
printf 'engine-strict=true\n' > .npmrc
```

**Step 2. Create the five starter workspaces.** Only five exist in this phase, because dependencies attach to workspaces; Phase 1 adds the other eight. Each one has a `package.json` (private, `"type": "module"`, a `typecheck` script, and for the two libraries an `exports` entry that points at `src/index.ts`) and a `tsconfig.json` that extends the shared base.

| Workspace | Package name | Its job in this phase |
| :-- | :-- | :-- |
| `contracts/errors` | `@freshrescue/contract-errors` | The first contract, holding the error families and their HTTP statuses. Proves that one workspace can import another |
| `packages/backend` | `@freshrescue/backend` | Backend logic. Proves that Express, Joi and mysql2 load |
| `packages/frontend` | `@freshrescue/frontend` | Frontend logic. Proves that XState and jsdom work, and holds the Tailwind probe class |
| `apps/api` | `@freshrescue/api` | Runs the backend with `tsx` |
| `apps/web` | `@freshrescue/web` | The Next.js app |

**Step 3. Install every dependency.** This is the only place dependencies are added; later phases add code, not packages. TypeScript is pinned to the 6.0 line for the reason given in Technology decisions.

```bash
# development tools shared by every workspace (TypeScript pinned to the 6.0 line, Node types to the 22 line)
npm install -D typescript@~6.0 @types/node@22 vitest jsdom eslint @eslint/js typescript-eslint globals concurrently

# contracts, backend, API runner
npm install -w @freshrescue/contract-errors http-status-codes
npm install -w @freshrescue/backend express@5 joi mysql2
npm install -w @freshrescue/backend -D @types/express
npm install -w @freshrescue/api tsx

# frontend logic, then the Next.js app and its Tailwind toolchain
npm install -w @freshrescue/frontend xstate
npm install -w @freshrescue/web next react react-dom
npm install -w @freshrescue/web -D tailwindcss @tailwindcss/postcss postcss @types/react @types/react-dom eslint-config-next
```

**Step 4. Add the configuration, the starter code and the tools.** The starter files exist only to prove the toolchain. The tree in Phase 1 marks the phase that deletes or rewrites each one.

| Files | What they hold | What they prove |
| :-- | :-- | :-- |
| `tsconfig.base.json` and one `tsconfig.json` per workspace | Strict TypeScript for everything: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, Bundler module resolution | The typecheck passes in all five workspaces |
| `eslint.config.mjs` | Flat config: ESLint recommended, typescript-eslint, and the Next.js rules for `apps/web` | The lint passes, and fails on a deliberate `any` |
| `vitest.config.ts` | Four projects: `node` (time zone pinned to America/New\_York), `dom` (jsdom), and `db` and `e2e` (both need MySQL and run on request) | `npm test` runs `node` and `dom` |
| `.gitignore`, `.nvmrc`, `.env.example` | Ignore rules, Node 22, the connection strings and ports | Nothing; housekeeping |
| `packages/backend/src/hello.ts` and `smoke.test.ts`, `apps/api/src/main.ts` | A small Express server with `/healthz` and `/api/ping`; a test that loads Joi, Express, mysql2 and the contract package | The backend toolchain links up and the API boots |
| `packages/frontend/src/smoke.test.ts`, `smoke.dom.test.ts`, `tokens.ts` | An XState machine run as a pure function; a jsdom check; a Tailwind class that lives outside `apps/web` | XState and jsdom work, and Tailwind sees other workspaces |
| `apps/web`: `next.config.ts`, `postcss.config.mjs`, `globals.css`, `layout.tsx`, `page.tsx` | `transpilePackages`, the `/api/*` rewrite to Express, the Tailwind import with two `@source` lines | The production build passes; the rewrite and the CSS work |
| `tools/gate.mjs`, `tools/gates.json` | The gate runner: it runs every check up to phase N in order and stops at the first failure | The gating mechanism itself |
| `tools/smoke-dev.mjs` | Boots the API and the built web app, then checks `/healthz`, the page, the `/api` rewrite and the generated CSS | Verification row 6 |
| `tools/db-ping.mjs`, `tools/vitest.db-setup.ts`, `tools/sql/init-dev.sql` | The MySQL check, the setup for the `db` and `e2e` projects, and the script that creates the databases and the user | Verification row 7 |

**Step 5. Add the root scripts** with `npm pkg set`: `typecheck`, `lint`, `test`, `test:db`, `test:e2e`, `build`, `dev` (which runs `dev:api` and `dev:web` together), `db:ping` and `gate`.

**Step 6. Create the databases and the environment file.** The script creates `freshrescue` and `freshrescue_test` and a `freshrescue` user with access to both. The development password is public on purpose, because this is a demo.

```bash
mysql -u root -p < tools/sql/init-dev.sql
cp .env.example .env
```

**Step 7. Run the gate.**

```bash
npm run gate -- 0
```

### Verification

Run the gate (`npm run gate -- 0`) or each command on its own. Every row must pass.

| # | Check | Command | Pass condition |
| :-- | :-- | :-- | :-- |
| 1 | Dependency tree is consistent | `npm ls` | Exit code 0. Do not use `npm ls --all`: it exits 1 because of optional platform packages |
| 2 | Typecheck, all five workspaces | `npm run typecheck` | Exit code 0 |
| 3 | Lint | `npm run lint` | Exit code 0 |
| 4 | Unit and jsdom tests | `npm test` | 3 test files and 4 tests pass |
| 5 | Production build | `npm run build` | Exit code 0 and the route `/` is listed as static |
| 6 | Boot and wiring | `node tools/smoke-dev.mjs` | Prints `smoke OK`. It proves the API answers `/healthz`, the web page renders, `/api/ping` through port 3000 reaches Express, and the built CSS holds utilities from both `apps/web` and `packages/frontend` |
| 7 | MySQL | `npm run db:ping` | Prints `MySQL OK version=8.…` and exits 0 |
| 8 | The lock file is complete (one time) | `rm -rf node_modules && npm ci && npm run gate -- 0` | Everything passes again from the lock file alone |
| 9 | Lint really lints (one time) | Create `packages/backend/src/canary.ts` containing `export const x: any = 1`, run `npx eslint packages/backend/src/canary.ts`, then delete the file | Exit code 1 with `no-explicit-any` |

**Exit gate.** `npm run gate -- 0` prints `Gate 0: passed (7 checks).` Rows 8 and 9 are one-time checks made by hand.

**Known noise, not a failure.** `npm audit` reports 11 moderate advisories, all inside the ESLint toolchain (a minimatch denial-of-service issue in a development tool). `npm audit --omit=dev` reports 0. Do not run `npm audit fix --force`: it would change major versions. In the dry run `npm ci` took about 12 seconds and the whole gate about 20 seconds.

## Phase 1 — Monorepo structure and architecture guard rails

**Goal.** The finished repository layout exists as real workspaces and folders, and the blueprint's four rules are executable: a forbidden import, a clock read in pure code, or an oversized file fails lint or the gate.

**Depends on.** Gate 0. Run `npm run gate -- 0` first. If it is not green, nothing in this phase starts.

### The structure

The tree is the repository when Phase 11 is finished. Phase 1 creates every workspace and folder in it, and the phase noted beside a file is the one that writes that file. Tests sit beside the code they test and are not drawn.

```text
freshrescue/
├─ apps/
│  ├─ api/
│  │  ├─ src/
│  │  │  ├─ compose.ts                         # API composition root · phase 7
│  │  │  └─ main.ts                            # reads env, starts the server · rewritten in phase 7
│  │  ├─ test/
│  │  │  ├─ concurrency.e2e.test.ts            # phase 7
│  │  │  ├─ exception-matrix.e2e.test.ts       # phase 10
│  │  │  ├─ http.e2e.test.ts                   # phase 7
│  │  │  ├─ restart.e2e.test.ts                # phase 7
│  │  │  └─ worked-examples.e2e.test.ts        # phase 10
│  │  ├─ package.json                          # @freshrescue/api
│  │  └─ tsconfig.json
│  └─ web/
│     ├─ src/
│     │  ├─ app/
│     │  │  ├─ globals.css                     # Tailwind import and @source lines
│     │  │  ├─ layout.tsx
│     │  │  └─ page.tsx                        # rewritten in phase 9
│     │  ├─ components/
│     │  │  └─ AppHost.tsx                     # React shell that mounts the app · phase 9
│     │  └─ compose.ts                         # frontend composition root · phase 9
│     ├─ next.config.ts                        # transpilePackages, /api rewrite
│     ├─ package.json                          # @freshrescue/web
│     ├─ postcss.config.mjs
│     └─ tsconfig.json
├─ contracts/
│  ├─ changeset/
│  │  ├─ src/
│  │  │  ├─ changeset.ts
│  │  │  ├─ index.ts                           # barrel
│  │  │  └─ write-ops.ts
│  │  ├─ package.json                          # @freshrescue/contract-changeset · layer 3 · backend only
│  │  └─ tsconfig.json
│  ├─ entities/
│  │  ├─ src/
│  │  │  ├─ food.ts
│  │  │  ├─ index.ts                           # barrel
│  │  │  ├─ raw-store.ts
│  │  │  ├─ recipe.ts
│  │  │  ├─ settings.ts
│  │  │  └─ snapshot.ts
│  │  ├─ package.json                          # @freshrescue/contract-entities · layer 2 · backend only
│  │  └─ tsconfig.json
│  ├─ errors/
│  │  ├─ src/
│  │  │  ├─ codes.ts
│  │  │  ├─ domain-error.ts
│  │  │  ├─ http-status.ts
│  │  │  └─ index.ts                           # phase 0 starter, becomes the barrel
│  │  ├─ package.json                          # @freshrescue/contract-errors · layer 0 · shared
│  │  └─ tsconfig.json
│  ├─ messages/
│  │  ├─ src/
│  │  │  ├─ commands.ts
│  │  │  ├─ envelope.ts
│  │  │  ├─ index.ts                           # barrel
│  │  │  ├─ port.ts
│  │  │  ├─ queries.ts
│  │  │  └─ routes.ts
│  │  ├─ package.json                          # @freshrescue/contract-messages · layer 3 · shared
│  │  └─ tsconfig.json
│  ├─ primitives/
│  │  ├─ src/
│  │  │  ├─ brand.ts
│  │  │  ├─ date.ts
│  │  │  ├─ id.ts
│  │  │  ├─ index.ts                           # barrel
│  │  │  ├─ quantity.ts
│  │  │  ├─ result.ts
│  │  │  └─ valid.ts
│  │  ├─ package.json                          # @freshrescue/contract-primitives · layer 0 · shared
│  │  └─ tsconfig.json
│  ├─ rules/
│  │  ├─ src/
│  │  │  ├─ index.ts                           # barrel
│  │  │  ├─ limits.ts
│  │  │  ├─ name-scope.ts
│  │  │  ├─ status.ts
│  │  │  ├─ system-ids.ts
│  │  │  └─ units.ts
│  │  ├─ package.json                          # @freshrescue/contract-rules · layer 1 · shared
│  │  └─ tsconfig.json
│  ├─ seed/
│  │  ├─ src/
│  │  │  ├─ bundle.ts
│  │  │  ├─ index.ts                           # barrel
│  │  │  ├─ order.ts
│  │  │  └─ parsed.ts
│  │  ├─ package.json                          # @freshrescue/contract-seed · layer 2 · backend only
│  │  └─ tsconfig.json
│  ├─ ui/
│  │  ├─ src/
│  │  │  ├─ actions.ts
│  │  │  ├─ ctx.ts
│  │  │  ├─ events.ts
│  │  │  ├─ forms.ts
│  │  │  ├─ index.ts                           # barrel
│  │  │  ├─ intents.ts
│  │  │  ├─ notice.ts
│  │  │  ├─ render-tree.ts
│  │  │  ├─ states.ts
│  │  │  └─ tokens.ts
│  │  ├─ package.json                          # @freshrescue/contract-ui · layer 4 · frontend only
│  │  └─ tsconfig.json
│  └─ views/
│     ├─ src/
│     │  ├─ catalog.ts
│     │  ├─ cook-report.ts
│     │  ├─ derived.ts
│     │  ├─ food-type-detail.ts
│     │  ├─ index.ts                           # barrel
│     │  ├─ inventory.ts
│     │  ├─ recommendations.ts
│     │  ├─ reference-data.ts
│     │  └─ warnings.ts
│     ├─ package.json                          # @freshrescue/contract-views · layer 2 · shared
│     └─ tsconfig.json
├─ packages/
│  ├─ backend/
│  │  ├─ seed/
│  │  │  └─ freshrescue.seed.json              # spec Appendix A as seed data · phase 7
│  │  ├─ src/
│  │  │  ├─ coordinators/
│  │  │  │  ├─ BackendCoordinator.ts           # BX-01 · phase 6
│  │  │  │  ├─ InventoryCommandCoordinator.ts  # BX-03 · phase 6
│  │  │  │  ├─ QueryCoordinator.ts             # BX-05 · phase 6
│  │  │  │  ├─ RecipeCommandCoordinator.ts     # BX-04 · phase 6
│  │  │  │  └─ ReferenceCommandCoordinator.ts  # BX-02 · phase 6
│  │  │  ├─ gateways/
│  │  │  │  ├─ conformance/
│  │  │  │  │  └─ storeConformance.ts          # one suite for memory and MySQL · phase 6
│  │  │  │  ├─ memory/
│  │  │  │  │  ├─ fixedClock.ts                # phase 6
│  │  │  │  │  ├─ memorySeedSource.ts          # phase 6
│  │  │  │  │  └─ memoryStore.ts               # phase 6
│  │  │  │  ├─ mysql/
│  │  │  │  │  ├─ migrations/
│  │  │  │  │  │  └─ 0001_init.sql             # phase 7
│  │  │  │  │  ├─ migrate.ts                   # phase 7
│  │  │  │  │  ├─ pool.ts                      # phase 7
│  │  │  │  │  └─ tables.ts                    # table and column map · phase 7
│  │  │  │  ├─ clockGateway.ts                 # BG-04 · phase 7
│  │  │  │  ├─ httpServerGateway.ts            # BG-01 · phase 7
│  │  │  │  ├─ ports.ts                        # StoreReadPort, StoreWritePort, ClockPort, SeedSourcePort · phase 6
│  │  │  │  ├─ seedSourceGateway.ts            # BG-05 · phase 7
│  │  │  │  ├─ storeReadGateway.ts             # BG-02 · phase 7
│  │  │  │  └─ storeWriteGateway.ts            # BG-03 · phase 7
│  │  │  ├─ modules/
│  │  │  │  ├─ decide/
│  │  │  │  │  ├─ batchCreateDecider.ts        # BC-29 · phase 5
│  │  │  │  │  ├─ batchQuantityEditDecider.ts  # BC-30 · phase 5
│  │  │  │  │  ├─ batchRemoveDecider.ts        # BC-31 · phase 5
│  │  │  │  │  ├─ categoryCreateDecider.ts     # BC-20 · phase 5
│  │  │  │  │  ├─ categoryDeleteDecider.ts     # BC-22 · phase 5
│  │  │  │  │  ├─ categoryRenameDecider.ts     # BC-21 · phase 5
│  │  │  │  │  ├─ categoryThresholdDecider.ts  # BC-23 · phase 5
│  │  │  │  │  ├─ foodTypeCreateDecider.ts     # BC-24 · phase 5
│  │  │  │  │  ├─ foodTypeDeleteDecider.ts     # BC-26 · phase 5
│  │  │  │  │  ├─ foodTypeEditDecider.ts       # BC-25 · phase 5
│  │  │  │  │  ├─ foodTypeResolver.ts          # BC-28 · phase 5
│  │  │  │  │  ├─ recipeDeleteDecider.ts       # BC-34 · phase 5
│  │  │  │  │  ├─ recipeDraftValidator.ts      # BC-32 · phase 5
│  │  │  │  │  ├─ recipeUpsertDecider.ts       # BC-33 · phase 5
│  │  │  │  │  ├─ settingsDecider.ts           # BC-35 · phase 5
│  │  │  │  │  └─ unitChangeDecider.ts         # BC-27 · phase 5
│  │  │  │  ├─ derive/
│  │  │  │  │  ├─ catalogBuilder.ts            # BC-15 · phase 4
│  │  │  │  │  ├─ categoryPathResolver.ts      # BC-10 · phase 4
│  │  │  │  │  ├─ foodTypeDetailProjector.ts   # BC-17 · phase 4
│  │  │  │  │  ├─ inventoryListProjector.ts    # BC-16 · phase 4
│  │  │  │  │  ├─ nameSorter.ts                # BC-11 · phase 4
│  │  │  │  │  ├─ recipeErrorEvaluator.ts      # BC-12 · phase 4
│  │  │  │  │  ├─ recipeMatchEvaluator.ts      # BC-13 · phase 4
│  │  │  │  │  ├─ recommendationBuilder.ts     # BC-14 · phase 4
│  │  │  │  │  ├─ referenceDataProjector.ts    # BC-19 · phase 4
│  │  │  │  │  ├─ stockAggregator.ts           # BC-09 · phase 4
│  │  │  │  │  └─ warningPanelProjector.ts     # BC-18 · phase 4
│  │  │  │  ├─ engine/
│  │  │  │  │  ├─ apiResponseBuilder.ts        # BC-44 · phase 4
│  │  │  │  │  ├─ changeSetEncoder.ts          # BC-43 · phase 4
│  │  │  │  │  ├─ changeSetMerger.ts           # BC-42 · phase 4
│  │  │  │  │  ├─ cookChangeSetBuilder.ts      # BC-37 · phase 4
│  │  │  │  │  ├─ cookReportBuilder.ts         # BC-38 · phase 4
│  │  │  │  │  ├─ fefoAllocator.ts             # BC-36 · phase 4
│  │  │  │  │  ├─ seedPlanner.ts               # BC-40 · phase 4
│  │  │  │  │  ├─ snapshotInvariantChecker.ts  # BC-41 · phase 4
│  │  │  │  │  └─ systemDataInitializer.ts     # BC-39 · phase 4
│  │  │  │  ├─ foundation/
│  │  │  │  │  ├─ batchStatusClassifier.ts     # BC-08 · phase 3
│  │  │  │  │  ├─ capChecker.ts                # BC-06 · phase 3
│  │  │  │  │  ├─ expiryResolver.ts            # BC-05 · phase 3
│  │  │  │  │  ├─ idAllocator.ts               # BC-02 · phase 3
│  │  │  │  │  ├─ nameValidator.ts             # BC-03 · phase 3
│  │  │  │  │  ├─ scalarValidator.ts           # BC-04 · phase 3
│  │  │  │  │  ├─ thresholdResolver.ts         # BC-07 · phase 3
│  │  │  │  │  └─ todayResolver.ts             # BC-01 · phase 3
│  │  │  │  ├─ parsing/
│  │  │  │  │  ├─ commandParser.ts             # BP-01 · phase 3
│  │  │  │  │  ├─ queryParser.ts               # BP-02 · phase 3
│  │  │  │  │  ├─ seedBundleParser.ts          # BP-04 · phase 3
│  │  │  │  │  └─ snapshotParser.ts            # BP-03 · phase 3
│  │  │  │  └─ state/
│  │  │  │     └─ changeSetApplier.ts          # BS-01 · phase 3
│  │  │  ├─ testing/
│  │  │  │  └─ fixtures.ts                     # snapshot and batch builders for tests · phase 3
│  │  │  ├─ hello.ts                           # phase 0 starter · deleted in phase 7
│  │  │  ├─ index.ts                           # public surface used by apps/api
│  │  │  └─ smoke.test.ts                      # phase 0 starter · deleted in phase 7
│  │  ├─ package.json                          # @freshrescue/backend
│  │  └─ tsconfig.json
│  └─ frontend/
│     ├─ src/
│     │  ├─ coordinators/
│     │  │  ├─ AppCoordinator.ts               # FX-06 · phase 9
│     │  │  ├─ CookingCoordinator.ts           # FX-11 · phase 9
│     │  │  ├─ InventoryCoordinator.ts         # FX-08 · phase 9
│     │  │  ├─ RecipeBookCoordinator.ts        # FX-10 · phase 9
│     │  │  ├─ ShellCoordinator.ts             # FX-07 · phase 9
│     │  │  └─ TaxonomyCoordinator.ts          # FX-09 · phase 9
│     │  ├─ gateways/
│     │  │  ├─ apiGateway.ts                   # FG-01 · phase 9
│     │  │  ├─ domHostGateway.ts               # FG-03 · phase 9
│     │  │  └─ midnightTimerGateway.ts         # FG-02 · phase 9
│     │  ├─ modules/
│     │  │  ├─ computation/
│     │  │  │  ├─ errorNoticeMapper.ts         # FC-01 · phase 8
│     │  │  │  └─ formPrefillBuilder.ts        # FC-02 · phase 8
│     │  │  ├─ parsing/
│     │  │  │  ├─ apiResponseParser.ts         # FP-02 · phase 8
│     │  │  │  └─ formSchemaParser.ts          # FP-01 · phase 8
│     │  │  ├─ slices/
│     │  │  │  ├─ catalogViewSlice.ts          # FS-05 · phase 8
│     │  │  │  ├─ cookQueueSlice.ts            # FS-06 · phase 8
│     │  │  │  ├─ formSlice.ts                 # FS-02 · phase 8
│     │  │  │  ├─ navigationSlice.ts           # FS-03 · phase 8
│     │  │  │  ├─ noticeSlice.ts               # FS-04 · phase 8
│     │  │  │  └─ resourceSlice.ts             # FS-01 · phase 8
│     │  │  └─ views/
│     │  │     ├─ appShellView.ts              # FU-01 · phase 8
│     │  │     ├─ batchFormView.ts             # FU-06 · phase 8
│     │  │     ├─ categoryManagerView.ts       # FU-16 · phase 8
│     │  │     ├─ confirmDialogView.ts         # FU-09 · phase 8
│     │  │     ├─ cookQueueView.ts             # FU-13 · phase 8
│     │  │     ├─ cookReportView.ts            # FU-14 · phase 8
│     │  │     ├─ demoControlView.ts           # FU-03 · phase 8
│     │  │     ├─ foodTypeDetailView.ts        # FU-05 · phase 8
│     │  │     ├─ foodTypeFormView.ts          # FU-07 · phase 8
│     │  │     ├─ inventoryListView.ts         # FU-04 · phase 8
│     │  │     ├─ noticeBarView.ts             # FU-02 · phase 8
│     │  │     ├─ recipeCatalogView.ts         # FU-12 · phase 8
│     │  │     ├─ recipeFormView.ts            # FU-15 · phase 8
│     │  │     ├─ recommendationView.ts        # FU-11 · phase 8
│     │  │     ├─ unitConversionModalView.ts   # FU-08 · phase 8
│     │  │     └─ warningPanelView.ts          # FU-10 · phase 8
│     │  ├─ testing/
│     │  │  ├─ fakeApi.ts                      # scripted ApiGateway for jsdom flows · phase 9
│     │  │  ├─ fixtures.ts                     # sample read models and slice states for view tests · phase 8
│     │  │  └─ render.ts                       # RenderTree to text, for view tests · phase 8
│     │  ├─ index.ts                           # public surface used by apps/web
│     │  ├─ smoke.dom.test.ts                  # phase 0 starter · deleted in phase 9
│     │  ├─ smoke.test.ts                      # phase 0 starter · deleted in phase 8
│     │  └─ tokens.ts                          # phase 0 starter · deleted in phase 9
│     ├─ package.json                          # @freshrescue/frontend
│     └─ tsconfig.json
├─ tools/
│  ├─ sql/
│  │  └─ init-dev.sql
│  ├─ architecture.mjs                         # the dependency graph · phase 1
│  ├─ check-error-codes.mjs                    # all 58 codes covered · phase 10
│  ├─ db-ping.mjs
│  ├─ gate.mjs                                 # npm run gate -- N
│  ├─ gates.json                               # every check, tagged with its phase
│  ├─ guards.test.ts                           # proves the lint rules reject violations · phase 1
│  ├─ journeys.e2e.test.ts                     # frontend against the real API · phase 10
│  ├─ manifest.txt                             # 94 entries, with phase and error codes · phase 1
│  ├─ scaffold.mjs                             # creates the tree · phase 1
│  ├─ smoke-compose.mjs                        # phase 11
│  ├─ smoke-dev.mjs
│  ├─ verify-layout.mjs                        # phase 1
│  ├─ verify-manifest.mjs                      # phase 1
│  └─ vitest.db-setup.ts
├─ .dockerignore                               # phase 11
├─ .env.example
├─ .gitignore
├─ .npmrc                                      # engine-strict=true
├─ .nvmrc
├─ Dockerfile                                  # phase 11
├─ README.md                                   # phase 11
├─ compose.yaml                                # phase 11
├─ eslint.config.mjs
├─ eslint.guards.mjs                           # the four rules as lint rules · phase 1
├─ package-lock.json
├─ package.json                                # three workspace globs, scripts
├─ tsconfig.base.json                          # strict settings shared by every workspace
└─ vitest.config.ts                            # projects: node, dom, db, e2e
```

How to read it:

- There are 13 workspaces: 9 contract packages, 2 logic packages (`backend`, `frontend`) and 2 apps (`api`, `web`).
- Every module, gateway and coordinator carries its blueprint ID: 75 pure modules, 8 gateways and 11 coordinators, which is the blueprint's 83 modules and 11 coordinators. `tools/manifest.txt` lists all 94 with their phase.
- A file marked "phase 0 starter" is a toolchain probe. The phase named beside it replaces or deletes it.
- Each side has one composition root (`compose.ts`). It creates the gateways and coordinators and wires them together, and it holds no logic. `main.ts` and `AppHost.tsx` are thin shells around it.
- `testing/` folders hold builders and fakes for tests. They are not modules, and production code never imports them.

**Naming rules**

| Thing | Where | What it exports |
| :-- | :-- | :-- |
| Module | `packages/<side>/src/modules/<group>/<lowerCamelName>.ts` | One function with the same name as the file, for example `todayResolver` |
| Gateway | `packages/<side>/src/gateways/<lowerCamelName>.ts` | `create<UpperCamelName>`, for example `createClockGateway`, which returns an object that implements a port |
| Coordinator | `packages/<side>/src/coordinators/<UpperCamelName>.ts` | `create<UpperCamelName>`, for example `createQueryCoordinator` |
| Contract file | `contracts/<name>/src/<kebab-name>.ts` | Types and constants only, re-exported by that package's `index.ts` |
| Test | Beside the file it tests | `name.test.ts` (node), `name.dom.test.ts` (jsdom), `name.db.test.ts` (MySQL), `name.e2e.test.ts` (real HTTP and MySQL) |

Relative imports carry no file extension (`from './hello'`), because with `moduleResolution: Bundler` TypeScript 6 rejects an import path that ends in `.ts` (error TS5097). A gateway folder may also hold support files that are not modules: port interfaces, the MySQL pool, the table map, migrations. They hold no business rule.

### The dependency graph

Contracts form five layers. A contract may import only contracts in a lower layer, which rules out cycles, and a contract that belongs to one side is invisible to the other. This table is the whole graph; `tools/architecture.mjs` holds the same data as code.

| Contract | Layer | Visible to | May import | Holds |
| :-- | :-- | :-- | :-- | :-- |
| `errors` | 0 | both sides | nothing | DomainError, the 58 error codes, the code-to-HTTP-status table |
| `primitives` | 0 | both sides | nothing | Id, QtyMilli, DateISO, Result, Named and the branded ValidName, ValidQty, ValidUnit, ValidThreshold |
| `rules` | 1 | both sides | `primitives` | LIMITS, UNIT\_LIST, SYSTEM\_IDS, the status enum, NameScope |
| `entities` | 2 | backend only | `primitives`, `rules` | FoodCategory, FoodType, Batch, RecipeCategory, Recipe, RecipeIngredient, ValidRecipeDraft, Settings, Counters, Snapshot |
| `seed` | 2 | backend only | `primitives`, `rules` | the seed bundle schema, ParsedSeed, SEED\_ID\_ORDER |
| `views` | 2 | both sides | `primitives`, `errors`, `rules` | the seven read-model DTOs and the derived maps that modules pass to each other |
| `changeset` | 3 | backend only | `primitives`, `rules`, `entities` | ChangeSet, WriteOps |
| `messages` | 3 | both sides | `primitives`, `errors`, `rules`, `views` | the 13 commands, the 6 queries, ApiResponse, ROUTES, CoordinatorPort |
| `ui` | 4 | frontend only | `primitives`, `errors`, `rules`, `views`, `messages` | UiEvent catalog with the typed payload of every event, slice states and actions, FormSchemas, NoticeModel, RenderTree, CSS tokens |

`backend` may use every contract except `ui`. `frontend` may use `primitives`, `errors`, `rules`, `views`, `messages` and `ui`. Everything the two sides exchange therefore goes through `messages` and `views`, which is the contract-driven rule in practice.

&#91;embedded content: monorepo map · 2 apps, 2 packages, 9 contracts\]

Read a lane top to bottom: an app uses its own package, and a package uses the contracts in its own lane plus the shared lane.

| Importer | May import | Never imports |
| :-- | :-- | :-- |
| Contract file | Contracts as in the table above | Modules, coordinators, gateways, app packages, IO libraries. No functions or classes |
| Module | Contracts (plus joi in backend/src/modules/parsing and xstate in frontend/src/modules/slices) | Any other module, coordinator or gateway. IO libraries. The clock and random numbers |
| Sub-coordinator | Modules, contracts | Another coordinator, any gateway, IO libraries |
| Top coordinator (`BackendCoordinator`, `AppCoordinator`) | Its sub-coordinators, modules, contracts, gateways | IO libraries, app packages |
| Gateway | Contracts and IO libraries (`express`, `mysql2`, `fetch`, the DOM) | Modules, coordinators, other gateways |
| App (`api`, `web`) | Its own package only: `api` uses `backend`, `web` uses `frontend` | Contracts directly, the other app |

Two tools enforce this. `tools/verify-layout.mjs` checks the contract graph and what each package declares and imports. ESLint checks what happens inside a package. Declared dependencies alone prove nothing: npm links every workspace into the root `node_modules`, so a file can import a package it never declared. The layout checker therefore reads the imports in the source as well.

### The guard rails

| Blueprint rule | What stops a violation | Where |
| :-- | :-- | :-- |
| Single transformation | This cannot be linted. Two proxies: every module must export its one function, named like its file (the manifest check, from Phase 3), and no file may pass 1000 lines | Manifest check; `max-lines` |
| Pure vs IO isolation | No clock (`new Date()` without an argument, `Date.now()`), no `Math.random()`, no IO global (`fetch`, `window`, `document`, `localStorage`, timers, `process`, `crypto`, `performance`, `Buffer` and others), no IO import (`node:*`, `fs`, `path`, `http`, `express`, `mysql2`, `react`, `next` and others) | Modules and every coordinator, because gateways do the IO. Contracts ban the IO imports too |
| Zero peer awareness | Modules: every relative import is an error, so a module can import contracts only. Sub-coordinators: no `./` import and no `../gateways`. Gateways: no `../modules`, no `../coordinators`, no other gateway. No app package is imported below `apps` | Per folder, as listed |
| 1000-line cap | `max-lines` 1000, blank lines and comments not counted. A coordinator function is also capped at 60 lines | Every non-test file under `src`; `coordinators/**` |
| Contracts hold types and constants | Function declarations, arrow functions and classes are errors | `contracts/*/src` |
| Errors are values | No `throw` statement. A failure is returned as a `DomainError`, and a native call that can throw (`JSON.parse`, a database call) is wrapped in `try/catch` and converted | Modules, coordinators, gateways, contracts and the two apps; not tests and not `testing/` |

Tests are exempt from all of these, so they can import the unit under test and read the clock. `tools/guards.test.ts` proves the rules: for each one it lints a snippet that must be rejected and one that must be accepted.

### Build order

1. **Confirm the starting point.** `npm run gate -- 0` must print `Gate 0: passed (7 checks).`
2. **Write the dependency graph as data**, in `tools/architecture.mjs`: the nine contracts with their layer, side and allowed imports, and the folders every workspace must contain. Every later tool reads this one file.
3. **Scaffold from it** with `tools/scaffold.mjs`, which never overwrites a file, so running it twice is safe. It adds the eight missing contract packages, each with an empty `src/index.ts`; it declares in `packages/backend` and `packages/frontend` every contract they may use; and it creates the 22 missing folders, each held by a `.gitkeep` until its first real file. Then `npm install` links the new workspaces.
4. **Add the guard rails** in `eslint.guards.mjs`, imported by `eslint.config.mjs`, and make `apps/web/next.config.ts` list every package that Next.js must transpile.
5. **Prove the guard rails** in `tools/guards.test.ts`: for each rule, one snippet that must be rejected and one that must be accepted.
6. **Write the two checkers.** `tools/verify-layout.mjs` compares the workspaces, folders, declared dependencies and real imports with the graph. `tools/verify-manifest.mjs` reads `tools/manifest.txt`, a 94-line list of every module, gateway and coordinator with its ID, file, building phase and the error codes its test must mention. Given a phase number, it checks that everything due by then is built, exported and tested.
7. **Register three checks** in `tools/gates.json` (layout, manifest, guard rails), commit, then run the gate.

### Verification

Run the gate (`npm run gate -- 1`) or each command on its own. The gate also re-runs the seven Phase 0 checks, and `npm test` now reports 4 test files and 10 tests.

| # | Check | Command | Pass condition |
| :-- | :-- | :-- | :-- |
| 1 | Workspaces, folders and import graph | `node tools/verify-layout.mjs` | Prints `layout OK: 13 workspaces, 25 folders, 19 source files import only what the graph allows` and exits 0. The file count grows with the code |
| 2 | Manifest is complete and consistent | `node tools/verify-manifest.mjs 1` | Prints `manifest OK: 94 entries (75 modules, 8 gateways, 11 coordinators); 0 due by phase 1` and exits 0 |
| 3 | Guard rails reject violations | `npx vitest run --project node tools/guards.test.ts` | 1 test file and 6 tests pass |
| 4 | The lock file is still complete (one time) | `rm -rf node_modules && npm ci && npm run gate -- 1` | Everything passes again from the lock file alone |
| 5 | The manifest check is not vacuous (one time) | `node tools/verify-manifest.mjs 3` | Exit code 1, with 13 `missing` lines and `13 problem(s)`, because the Phase 3 modules do not exist yet |
| 6 | The layout check catches a layering violation (one time) | Create `contracts/rules/src/canary.ts` containing `import type { Batch } from '@freshrescue/contract-entities'`, run `node tools/verify-layout.mjs`, then delete the file | Exit code 1 with `imports @freshrescue/contract-entities, which @freshrescue/contract-rules may not use` |
| 7 | Lint catches a peer import and a clock read (one time) | Create `packages/backend/src/modules/foundation/canary.ts` with `import { other } from './other'` and `export const bad = () => new Date()`, run `npx eslint packages/backend/src/modules/foundation/canary.ts`, then delete the file | Exit code 1 with `no-restricted-imports` and `no-restricted-syntax` |

**Exit gate.** `npm run gate -- 1` prints `Gate 1: passed (10 checks).` Rows 4 to 7 are one-time checks made by hand. In the dry run the whole gate took about 17 seconds.

## Phase 2 — Contracts: the nine read-only packages

**Goal.** Write every type and constant that the two sides share, and nothing else. When this phase ends, `contracts/` says what each record is, what each of the 19 messages carries, what each of the 58 errors means and which screen events exist. The compiler, the tests and the lint rules refuse any later code that disagrees.

**Depends on.** Gate 1. Run `npm run gate -- 1` first.

**Why this comes before any module.** The blueprint forbids a module from importing another module, so the contracts are the only thing two modules can have in common. They fix the shape of the whole system. Phases 3 to 9 fill shapes that already exist, and a module that needs a new shared type has to change a contract first, where every other module can see the change.

### The nine packages

| Package | Layer | Seen by | Source files | Holds |
| :-- | :-- | :-- | :-- | :-- |
| `primitives` | 0 | both sides | 6 | `Id`, `Named`, `DateISO`, `QtyMilli`, `Result`, `Empty`, `Brand` and the four `Valid` types |
| `errors` | 0 | both sides | 3 | the 58 error codes with their families, `DomainError`, the HTTP status of every code |
| `rules` | 1 | both sides | 5 | `LIMITS`, `UNIT_LIST`, `SYSTEM_IDS`, `NameScope`, the status vocabularies |
| `entities` | 2 | backend only | 5 | the records, `ValidRecipeDraft`, `Snapshot`, `RawStore` |
| `seed` | 2 | backend only | 3 | `SeedBundle`, `ParsedSeed`, `SEED_ID_ORDER` |
| `views` | 2 | both sides | 8 | the seven read-model DTOs and the derived shapes that modules pass to each other |
| `changeset` | 3 | backend only | 2 | `ChangeSet`, `Outcome`, `WriteOps` |
| `messages` | 3 | both sides | 5 | the 13 commands, the 6 queries, `ApiResponse`, the routes, `CoordinatorPort` |
| `ui` | 4 | frontend only | 9 | `UiEvent`, its route table and the payload of each event (`UiPayloads`), `UiEventDescriptor`, form schemas, slice states and actions, `Intent`, `Ctx`, `RenderTree`, style tokens |

That is 46 source files. Each package also has a barrel `index.ts` and one test file, so the phase adds 64 files. A contract file holds types and constants only, and the lint rule from Phase 1 rejects a function or a class in any of them. For that reason no helper such as "build an `Ok`" exists here: a module writes `{ ok: true, value }` itself.

### What the contracts decide

- **Ids.** One counter serves every kind of record, so an id names one record in the whole system. Ids are positive integers and are never reused. Ids 1 and 2 belong to the two `Other` categories (`SYSTEM_IDS`), and the first free id is 3. A recipe row whose Food Type was deleted can therefore never point at a different Food Type created later.
- **Quantities** are whole thousandths everywhere: entities, messages, the seed file and the store. Decimal text exists only in the browser, inside the form parser and the one-line `milli / 1000` expression of each view.
- **Names and units** are plain `string` in the entities. The brands `ValidName` and `ValidUnit` live in the signatures of the deciders, so unvalidated text cannot reach a state change, and `SnapshotInvariantChecker` checks the stored result once more.
- **A change is a list of record-level operations**, each a put (insert or replace) or a delete, 14 kinds in all. A record may appear in a `ChangeSet` once, so `ChangeSetApplier` can reject two operations on one record with `CONFLICTING_OPS`, and a delete of a record that is not there with `UNKNOWN_TARGET`. The ingredient rows of a recipe are the one exception: they are replaced by a single `deleteIngredientsOfRecipe` followed by the new `putIngredient` operations. Deleting the rows of a recipe that has none, which is the case for a new recipe, is not an error. 
- **Storage speaks in `WriteOps`**, which use logical table names and the same field names as the entities. Only the MySQL gateway knows real table and column names, so replacing the store touches nothing else.
- **Every reply has one shape.** A failure carries its family, its code and an optional detail. Its `meta.today` is null on every failure, because `ApiResponseBuilder` receives `today` only together with a successful result. The HTTP status of a code is the default of its family (400, 422, 409, 503), except for 13 codes: server-side faults answer 500 and `PAYLOAD_TOO_LARGE` answers 413. A missing record answers 409, not 404, because both routes are fixed RPC endpoints; 404 stays for an unknown URL.
- **The seed names things by key.** Ids do not exist until `SeedPlanner` takes them from the reserved block, in the order of `SEED_ID_ORDER`. The seed file stores quantities as thousandths too.
- **Screens.** Every user action is a `UiEvent` in one of 16 namespaces, and `UI_ROUTES` names the sub-coordinator that owns each namespace. Every event has a typed payload (`UiPayloads`), and an event that opens a form carries the record that the form is about. A node of a view carries its event without the `value` of an input or a select (`UiEventDescriptor`), because the DOM host adds that when the person types or chooses. A view returns a `RenderTree` of six node kinds and never touches the DOM. `FORM_SCHEMAS` tells the form parser how to turn the texts of the 8 edit forms and the `TARGET` confirmation schema (shared by the 4 deletions) into the payloads of 12 commands; `CookRecipes` takes its `recipeIds` directly from `CookQueueSlice`. 

### How the compiler keeps the contracts complete

Several tables must cover a whole list, and each one is written so that adding to the list breaks the build until the table is updated.

| Table | Must cover | How a gap is caught |
| :-- | :-- | :-- |
| `HTTP_STATUS_BY_CODE` | every `ErrorCode` | `satisfies Record<ErrorCode, number>` |
| `UI_ROUTES` | every `UiNamespace` | `satisfies Record<UiNamespace, CoordinatorName>` |
| `TONE_CLASS`, `LAYOUT_CLASS` | every `Tone` and `Layout` | `satisfies Record<…>` |
| `CommandPayloads`, `QueryParams`, `MessageData` | every message name | `toEqualTypeOf` assertions in `messages.test.ts` |
| `UiPayloads` | every event of `UI_EVENTS` | a `toEqualTypeOf` assertion in `ui.test.ts` |
| `ENTITY_OP_KINDS` | every kind of `EntityOp` | `satisfies` plus a `toEqualTypeOf` assertion |
| `SNAPSHOT_LISTS`, `SEED_ID_ORDER` | every list key | `toEqualTypeOf` assertions in the package tests |

The `toEqualTypeOf` assertions are checked by `tsc`, not by Vitest, which treats them as no-ops at run time. That is why `npm run typecheck` is part of the gate.

### Build order

1. **Write the packages from layer 0 up**, so each one compiles when it is written: `primitives`, `errors`, `rules`; then `entities`, `seed`, `views`; then `changeset`, `messages`; last `ui`. Each package gets the source files named in the table above, a test file `<package>.test.ts`, and a barrel `index.ts` with one `export * from './<file>'` line per file, in alphabetical order.
2. **Turn the Phase 0 starter into the `errors` barrel.** Its two exports, `ERROR_FAMILIES` and `HTTP_STATUS_BY_FAMILY`, move into `codes.ts` and `http-status.ts` and stay exported, so the Phase 0 smoke test keeps passing.
3. **Write the 58-code catalog once**, in `codes.ts`, as a table of code to family. Everything that needs the list of codes derives it from that table.
4. **Add two checkers.** `tools/verify-contracts.mjs` confirms that each package has exactly the expected files and a barrel that re-exports every one of them. `tools/contracts.test.ts` pins facts that span packages: the 19 message names, that every error code the manifest promises exists, that `STORE_TABLES` has two more tables than `SNAPSHOT_LISTS`, and that `BatchView` extends `Batch`. Register both in `tools/gates.json`.
5. **Commit, then run the gate.**

**Where a type lives.** A type that two or more modules use, or that crosses the wire, belongs in a contract. A type that one module makes and only its calling coordinator reads (`Resolved` from `FoodTypeResolver`, `CapChange` from `CapChecker`, `IdAllocation` from `IdAllocator`) stays in that module and is exported from it, because a coordinator may import the modules it calls. `ValidRecipeDraft` is the opposite case: `RecipeDraftValidator` makes it and `RecipeUpsertDecider` takes it, so it lives in `entities`.

### Verification

Run the gate (`npm run gate -- 2`) or each command on its own. The gate also re-runs the ten checks of Phases 0 and 1. `npm test` now reports 14 test files and 45 tests.

| # | Check | Command | Pass condition |
| :-- | :-- | :-- | :-- |
| 1 | Packages are complete | `node tools/verify-contracts.mjs` | Prints `contracts OK: 9 packages, 46 source files, each re-exported by its barrel and covered by a test file` and exits 0 |
| 2 | Constants and shapes are pinned | `npx vitest run --project node contracts` | 10 test files and 35 tests pass: the nine package tests and `tools/contracts.test.ts` |
| 3 | Type-level assertions hold | `npm run typecheck` | Exits 0. `expectTypeOf` assertions are enforced here and nowhere else |
| 4 | Contracts hold no function or class | `npm run lint` | Exits 0 |
| 5 | The import graph still holds | `node tools/verify-layout.mjs` | Prints `layout OK: 13 workspaces, 25 folders, 74 source files import only what the graph allows` and exits 0 |
| 6 | A new error code needs a status (one time) | Add `NEW_CODE: 'rules',` to `ERROR_FAMILY_OF` in `codes.ts`, run `npm run typecheck`, then `git checkout contracts/errors/src/codes.ts` | Exit code 1 with `TS1360` in `http-status.ts`, which says the property `NEW_CODE` is missing |
| 7 | A message list and its tables cannot drift apart (one time) | Delete the line `'RemoveBatch',` from `COMMAND_TYPES` in `commands.ts`, run `npm run typecheck`, then `git checkout contracts/messages/src/commands.ts` | Exit code 1 with `TS2344` in `messages.test.ts` |
| 8 | A missing file is noticed (one time) | Delete `contracts/views/src/warnings.ts`, run `node tools/verify-contracts.mjs`, then `git checkout contracts/views/src/warnings.ts` | Exit code 1 with `contracts/views/src: missing warnings.ts` |

Commit before the one-time checks, so that `git checkout` restores the file.

**Exit gate.** `npm run gate -- 2` prints `Gate 2: passed (12 checks).` Rows 6 to 8 are one-time checks made by hand. In the dry run the gate took about 23 seconds.

## Phase 3 — Backend modules A: parsers, validators, ids and status (13 modules)

**Goal.** The first 13 backend modules exist, each as one pure function with its own tests: four parsers that turn raw input into typed data, the `ChangeSetApplier`, and eight small calculations (today's date, ids, names, scalar values, expiry, the 500,000 cap, thresholds, batch status).

**Depends on.** Gate 2. Run `npm run gate -- 2` first.

### What gets built

Each module lives in `packages/backend/src/modules/<group>/<name>.ts`, exports one function named like its file, and has a test file beside it. A module imports contracts only, so the 13 can be written in any order. In all, about 1,920 lines.

| Group | Modules | Est. lines |
| :-- | :-- | :-- |
| `parsing`, built with Joi | BP-01 `CommandParser`, BP-02 `QueryParser`, BP-03 `SnapshotParser`, BP-04 `SeedBundleParser` | 1,070 |
| `state` | BS-01 `ChangeSetApplier` | 220 |
| `foundation`: validators | BC-03 `NameValidator`, BC-04 `ScalarValidator`, BC-05 `ExpiryResolver`, BC-06 `CapChecker` | 390 |
| `foundation`: today, ids, thresholds, status | BC-01 `TodayResolver`, BC-02 `IdAllocator`, BC-07 `ThresholdResolver`, BC-08 `BatchStatusClassifier` | 240 |

Two supporting pieces come with them. `packages/backend/src/testing/fixtures.ts` holds builders for snapshots and batches that every later backend test uses; it is not a module, and production code never imports it. A new entry in `tools/gates.json` runs `node tools/verify-manifest.mjs 3`.

The clock never enters a module. `TodayResolver` is handed the device date and Simulated Today, and every other date calculation is handed today's date. Joi stays inside the four parsers, and each Joi failure is translated to one of the shape codes.

### Verification

| # | Check | Command | Pass condition |
| :-- | :-- | :-- | :-- |
| 1 | Every module is built, exported and tested for each of its codes | `node tools/verify-manifest.mjs 3` | Prints `manifest OK: 94 entries (75 modules, 8 gateways, 11 coordinators); 13 due by phase 3, each built, exported and tested for every listed error code` and exits 0 |
| 2 | Parsers and the applier reject bad input with the right code | `npx vitest run --project node packages/backend/src/modules/parsing packages/backend/src/modules/state` | Passes. All 15 codes of these five modules are produced by a test with a failing input, and valid input returns a typed value |
| 3 | The calculations follow the specification | `npx vitest run --project node packages/backend/src/modules/foundation` | Passes. All 13 codes of the eight modules are produced, and the three spec examples below hold |
| 4 | Modules stay pure | `npm run lint` | Exits 0. A peer import, a clock read or an IO import in a module would fail here |
| 5 | Types hold | `npm run typecheck` | Exits 0 |
| 6 | The manifest check notices a missing test (one time) | Remove every mention of `CAP_EXCEEDED` from `capChecker.test.ts`, run `node tools/verify-manifest.mjs 3`, then `git checkout` the file | Exit code 1 with `BC-06 CapChecker: no test mentions CAP_EXCEEDED` |

The three spec examples that row 3 must include:

- **Dates (spec 4.3.4).** An item added on Oct 1, 2026 with a 3-day shelf life expires on Oct 4. With the default threshold of 3 days it is Near-Expiry on Oct 1 and still on Oct 4, and Expired on Oct 5.
- **Threshold precedence (spec 4.3.1).** A Food Type's own threshold beats its Child category's, which beats its Parent's, which beats the global 3 days. The resolver reports which level won.
- **The cap (spec section 3).** A Food Type's batches may total exactly 500,000, never more. The post-change total is existing plus new for an inbound, existing minus old plus new for an edit, and the sum of the new quantities for a unit change. Expired batches count.

**Exit gate.** `npm run gate -- 3` prints `Gate 3: passed (13 checks).` Row 6 is a one-time check made by hand.

## Phase 4 — Backend modules B: derived state, projections, cook engine and guards (20 modules)

**Goal.** The 20 modules that compute from a snapshot exist: stock and status figures, recipe matching, the read models the screens need, the FEFO cook engine, and the guards that check and encode every state change before it is written.

**Depends on.** Gate 3. Run `npm run gate -- 3` first.

### What gets built

Same layout and rules as Phase 3: `modules/derive` and `modules/engine`, one function per file, contracts only. About 2,360 lines. The numbers BC-20 to BC-35 are skipped here because they belong to the deciders of Phase 5.

| Group | Modules | Est. lines |
| :-- | :-- | :-- |
| `derive`: stock and labels | BC-09 `StockAggregator`, BC-10 `CategoryPathResolver`, BC-11 `NameSorter` | 210 |
| `derive`: recipe analysis | BC-12 `RecipeErrorEvaluator`, BC-13 `RecipeMatchEvaluator` | 250 |
| `derive`: read models | BC-14 `RecommendationBuilder`, BC-15 `CatalogBuilder`, BC-16 `InventoryListProjector`, BC-17 `FoodTypeDetailProjector`, BC-18 `WarningPanelProjector`, BC-19 `ReferenceDataProjector` | 770 |
| `engine`: cook | BC-36 `FefoAllocator`, BC-37 `CookChangeSetBuilder`, BC-38 `CookReportBuilder` | 310 |
| `engine`: guards and plumbing | BC-39 `SystemDataInitializer`, BC-40 `SeedPlanner`, BC-41 `SnapshotInvariantChecker`, BC-42 `ChangeSetMerger`, BC-43 `ChangeSetEncoder`, BC-44 `ApiResponseBuilder` | 820 |

A new entry in `tools/gates.json` runs `node tools/verify-manifest.mjs 4`.

### Verification

| # | Check | Command | Pass condition |
| :-- | :-- | :-- | :-- |
| 1 | Every module is built, exported and tested for each of its codes | `node tools/verify-manifest.mjs 4` | Prints `manifest OK: 94 entries (75 modules, 8 gateways, 11 coordinators); 33 due by phase 4, each built, exported and tested for every listed error code` and exits 0 |
| 2 | Derived state and read models give the specification's results | `npx vitest run --project node packages/backend/src/modules/derive` | Passes, and includes the partial-match and recommendation cases below |
| 3 | The cook engine and the guards behave | `npx vitest run --project node packages/backend/src/modules/engine` | Passes, and includes the FEFO, invariant and encoder cases below |
| 4 | Modules stay pure and typed | `npm run lint && npm run typecheck` | Both exit 0 |
| 5 | The invariant checker really checks (one time) | Disable one rule in `snapshotInvariantChecker.ts`, for example the 500,000 cap, run row 3, then `git checkout` the file | Exit code 1, and the failing test names that rule |

The cases that rows 2 and 3 must include:

- **FEFO (spec 4.5).** A recipe needs 300 g of Beef. Batch A holds 100 g and is Expired, batch B holds 150 g and is Near-Expiry, batch C holds 200 g and is Fresh. A is left alone, B is used up, and 150 g comes from C, leaving 50 g. The allocator, the ChangeSet builder and the report builder agree on this.
- **Partial match (spec 4.5).** A recipe needs 300 g Beef and 200 g Broccoli, and the fridge holds 150 g Beef and 250 g Broccoli. The match is Partial. Cooking deducts 200 g Broccoli (50 g left) and 0 g Beef, and the report lists Beef as missing, needed 300 and available 150.
- **Recommendations and catalog (exception rows 11, 12, 13 and 17).** With no fully matching recipe the recommendation degrades to partial matches. A recipe without a rescued (Near-Expiry) ingredient is absent from the recommendations but present in the catalog. With no Near-Expiry items the empty state says so, and with Near-Expiry items but no rescuing recipe it gives the other empty state.
- **Invariants.** One snapshot per rule, each breaking exactly that rule and rejected with `INVARIANT_BROKEN` listing it. A snapshot that breaks two rules lists both. The seed that `SeedPlanner` builds from the Appendix A data passes the checker.
- **Applier and encoder agree.** For every ChangeSet used in these tests, replaying the `WriteOps` from `ChangeSetEncoder` on plain rows gives the same snapshot as `ChangeSetApplier`. This is what lets Phase 7 trust MySQL to match the in-memory behaviour.
- **Responses.** `ApiResponseBuilder` gives every error code the HTTP status from the Phase 2 table, and sets `meta.today` to null on a failure.

**Exit gate.** `npm run gate -- 4` prints `Gate 4: passed (14 checks).` Row 5 is a one-time check made by hand.

## Phase 5 — Backend modules C: the deciders (16 modules)

**Goal.** Every command's decision exists as a pure module: given a validated request and a snapshot, it returns a ChangeSet or an error. This includes the cascade rules (deleting a category, deleting a Food Type, changing a unit) and the validation of a recipe draft.

**Depends on.** Gate 4. Run `npm run gate -- 4` first.

### What gets built

Same layout and rules as Phase 3: `modules/decide`, one function per file, contracts only. About 1,370 lines. A decider calls no other module. Validating the request first, merging the ChangeSets and checking the result are the coordinators' work in Phase 6.

| Group | Modules | Est. lines |
| :-- | :-- | :-- |
| `decide`: categories | BC-20 `CategoryCreateDecider`, BC-21 `CategoryRenameDecider`, BC-22 `CategoryDeleteDecider`, BC-23 `CategoryThresholdDecider` | 390 |
| `decide`: Food Types | BC-24 `FoodTypeCreateDecider`, BC-25 `FoodTypeEditDecider`, BC-26 `FoodTypeDeleteDecider`, BC-27 `UnitChangeDecider`, BC-28 `FoodTypeResolver` | 440 |
| `decide`: batches | BC-29 `BatchCreateDecider`, BC-30 `BatchQuantityEditDecider`, BC-31 `BatchRemoveDecider` | 160 |
| `decide`: recipes | BC-32 `RecipeDraftValidator`, BC-33 `RecipeUpsertDecider`, BC-34 `RecipeDeleteDecider` | 320 |
| `decide`: settings | BC-35 `SettingsDecider` | 60 |

One test crosses modules: `packages/backend/src/testing/deciders.test.ts` applies the ChangeSet of every decider's success case with `ChangeSetApplier` and runs `SnapshotInvariantChecker` on the result. A new entry in `tools/gates.json` runs `node tools/verify-manifest.mjs 5`.

### Verification

| # | Check | Command | Pass condition |
| :-- | :-- | :-- | :-- |
| 1 | Every module is built, exported and tested for each of its codes | `node tools/verify-manifest.mjs 5` | Prints `manifest OK: 94 entries (75 modules, 8 gateways, 11 coordinators); 49 due by phase 5, each built, exported and tested for every listed error code` and exits 0 |
| 2 | Each decider gives the right ChangeSet or error | `npx vitest run --project node packages/backend/src/modules/decide` | Passes. All 17 codes of the 16 modules are produced by a test, and the cases below hold |
| 3 | No decider proposes an illegal state | `npx vitest run --project node packages/backend/src/testing` | Passes. Every success case yields a snapshot that the invariant checker accepts |
| 4 | Modules stay pure and typed | `npm run lint && npm run typecheck` | Both exit 0 |
| 5 | The cascade tests bite (one time) | In `categoryDeleteDecider.ts`, remove the step that moves Food Types to `Other`, run row 2, then `git checkout` the file | Exit code 1, and the test for exception row 9 fails |

The cases that row 2 must include:

- **One Food Type, two batches (spec 4.2.1).** On Oct 1, 500 ml of Milk with a 5-day shelf life (expires Oct 6). On Oct 2, 1,000 ml with a 10-day shelf life (expires Oct 12). The result is one Food Type under Dairy → Liquid Dairy and two separate batches with their own dates.
- **Unit change (spec 4.2.2).** Chicken has batches of 100 g and 200 g. Changing its unit to pieces with 0.5 and 1 gives one ChangeSet that changes the unit and both quantities. A request that leaves out a batch is `BATCH_SET_MISMATCH`, and the same unit is `UNIT_UNCHANGED`.
- **Deletions (exception rows 7, 9 and 15).** Deleting a category moves its Food Types (also those under its children) or its recipes to `Other` and drops its threshold. Deleting a Food Type that still has batches is `HAS_BATCHES`. Deleting one without batches succeeds, and every recipe row that used it keeps its name for display.
- **Names and categories (rows 18 and 19).** An inbound name that matches an existing Food Type, ignoring case, joins that Food Type, and no match creates a new one; nothing is matched loosely. Creating a category named `Other`, a child under `Other`, or a child under a child is rejected. An inbound with no id and no name counts as an empty name (NAME_EMPTY). 
- **Recipe drafts.** No ingredient rows is `NO_INGREDIENTS`, the same Food Type twice is `DUP_INGREDIENT`, a row naming a Food Type that does not exist is `UNKNOWN_FOOD_TYPE`, and each row obeys the quantity and unit rules.

**Exit gate.** `npm run gate -- 5` prints `Gate 5: passed (15 checks).` Row 5 is a one-time check made by hand.

## Phase 6 — Backend coordinators on in-memory gateways

**Goal.** All 13 commands and 6 queries work end to end through the backend's single entry point, with no HTTP and no MySQL. The five backend coordinators run the 49 modules in the blueprint's order, against in-memory stand-ins for the store, the clock and the seed file.

**Depends on.** Gate 5. Run `npm run gate -- 5` first.

### What gets built

| Part | Files | Job |
| :-- | :-- | :-- |
| Top coordinator | BX-01 `BackendCoordinator` | Implements `CoordinatorPort.handle`: parse the request, pick the sub-coordinator, run the write path (ChangeSet, `ChangeSetApplier`, `SnapshotInvariantChecker`, `ChangeSetEncoder`, store write), build the `ApiResponse`. Seeds an empty store on startup |
| Command coordinators | BX-02 `ReferenceCommandCoordinator` (bootstrap, SaveCategory, DeleteCategory, SetCategoryThreshold, SaveFoodType, DeleteFoodType, SetSimulatedToday); BX-03 `InventoryCommandCoordinator` (ChangeFoodTypeUnit, InboundBatch, EditBatchQuantity, RemoveBatch); BX-04 `RecipeCommandCoordinator` (SaveRecipe, DeleteRecipe, CookRecipes) | Validate, call the deciders, return the ChangeSets. They never write |
| Query coordinator | BX-05 `QueryCoordinator` | Runs the six queries from one snapshot: reference data, inventory list, Food Type detail, warning panel, recommendations, catalog |
| Ports | `gateways/ports.ts` | The four interfaces the `BackendCoordinator` use: store read, store write, clock, seed source |
| In-memory gateways | `gateways/memory/`: `memoryStore.ts`, `fixedClock.ts`, `memorySeedSource.ts` | Stand-ins that obey the same ports as the real gateways of Phase 7 |
| Store conformance suite | `gateways/conformance/storeConformance.ts` | One suite that any store must pass. It runs on the memory store now and on MySQL in Phase 7 |

The coordinators read the whole snapshot at the start of a request and write once at the end, so they assume one request at a time. That rule is enforced by the HTTP gateway in Phase 7. In this phase the tests send requests one by one. A new entry in `tools/gates.json` runs `node tools/verify-manifest.mjs 6`.

### Verification

| # | Check | Command | Pass condition |
| :-- | :-- | :-- | :-- |
| 1 | Everything due is built, exported and tested | `node tools/verify-manifest.mjs 6` | Prints `manifest OK: 94 entries (75 modules, 8 gateways, 11 coordinators); 54 due by phase 6, each built, exported and tested for every listed error code` and exits 0 |
| 2 | The memory store passes the conformance suite | `npx vitest run --project node packages/backend/src/gateways` | Passes: an empty store reads as nothing; what was written reads back unchanged; a write that fails leaves the store as it was and reports `STORE_WRITE_FAILED`; a delete with a partial key removes every matching row |
| 3 | All 19 messages work through the port | `npx vitest run --project node packages/backend/src/coordinators` | Passes: one success scenario for each of the 13 commands and 6 queries, and a registry test fails if the scenarios do not cover exactly `COMMAND_TYPES` and `QUERY_TYPES` |
| 4 | Failures change nothing | same command as row 3 | A malformed request answers 400 with a shape code, an invalid value 422, a rule violation 409 and the store is identical afterwards. A decider that returns an illegal ChangeSet (a test double) answers 500 with `INVARIANT_BROKEN` and writes nothing |
| 5 | Startup seeding is idempotent | same command as row 3 | The first start of an empty store adds the two system categories and the seed bundle in one write; a second start adds nothing |
| 6 | Coordinators only sequence | `npm run lint && npm run typecheck` | Both exit 0. A sub-coordinator importing a peer or a gateway, or a coordinator function over 60 lines, would fail |
| 7 | The conformance suite bites (one time) | Make `memoryStore.ts` apply operations one by one without undoing them on failure, run row 2, then `git checkout` the file | Exit code 1, and the rollback test fails |

The scenarios that row 3 must include:

- **Inbound with a new name.** The request creates the Food Type and its batch in one write, taking two ids from the counter. The same name typed in another letter case adds a batch to the existing Food Type (exception row 18).
- **Inbound with no name.** A request that names no Food Type, which is what the form sends when its name is left blank, answers `NAME_EMPTY` (422, exception row 3) and writes nothing. 
- **A cook queue (exception rows 14, 16 and 21).** Two recipes share an ingredient: the first deducts it, the second finds it depleted, deducts none of it and the queue goes on. The same recipe queued twice runs twice. A recipe that is blocked at its turn, or has nothing available, is skipped with its reason and the queue continues. The report lists each recipe's deducted and missing ingredients.
- **A blocked write.** A unit change whose new total exceeds 500,000 answers `CAP_EXCEEDED` and leaves every batch as it was.

**Exit gate.** `npm run gate -- 6` prints `Gate 6: passed (16 checks).` Row 7 is a one-time check made by hand.

## Phase 7 — MySQL, the real gateways and Express

**Goal.** The backend runs as a real server on MySQL. The five backend gateways exist, data survives a restart, and every error answers with the HTTP status documented in the `errors` contract.

**Depends on.** Gate 6, with MySQL running and the databases from Phase 0 in place. Run `npm run gate -- 6` first.

**Not dry-run.** The scratch environment had no MySQL server, so this is the first phase whose checks have not been run. The DDL was only parsed with a MySQL grammar.

### What gets built

| Part | Files | Job |
| :-- | :-- | :-- |
| Schema | `gateways/mysql/migrations/0001_init.sql`, `migrate.ts` | Nine tables: `food_category`, `food_type`, `batch`, `recipe_category`, `recipe`, `recipe_ingredient`, `app_settings`, `app_counters`, `schema_migrations`. Ids are assigned by the app. There are no foreign keys, because the cascade rules live in the deciders and the invariant checker. A CHECK keeps quantities between 1 and 500,000,000 thousandths. `recipe_ingredient` has an auto-increment `seq` and a unique pair of recipe and Food Type. The runner is idempotent and records what it applied |
| Connection | `pool.ts`, `tables.ts` | A mysql2 pool with `dateStrings: true`, so DATE columns arrive as `YYYY-MM-DD` text and not as JavaScript dates. `tables.ts` maps the logical table and field names of `WriteOps` to real ones, and is the only file that knows them |
| Gateways | BG-02 `StoreReadGateway`, BG-03 `StoreWriteGateway`, BG-04 `ClockGateway`, BG-05 `SeedSourceGateway`, BG-01 `HttpServerGateway` | Read: all tables into one `RawStore`, or nothing when empty; failure is `STORE_UNAVAILABLE`. Write: all `WriteOps` as upserts in one transaction; failure rolls back and is `STORE_WRITE_FAILED`. Clock: today's date on the local calendar, not UTC. Seed: reads `packages/backend/seed/freshrescue.seed.json`; failure is `SEED_UNREADABLE`. HTTP: Express with `POST /api/command`, `POST /api/query` and `GET /healthz`; the body is read as text with a size limit (`PAYLOAD_TOO_LARGE`, 413) and requests run one at a time through a promise chain |
| Seed file | `packages/backend/seed/freshrescue.seed.json` | Spec Appendix A, with quantities in thousandths: 8 Food Types, 6 recipes, the preset food categories and cuisines, no batches |
| Composition | `apps/api/src/compose.ts`, `apps/api/src/main.ts` | `compose.ts` creates the gateways and coordinators and wires them. `main.ts` reads `DATABASE_URL` and `API_PORT` and starts the server; it replaces the Phase 0 starter |
| Removed | `packages/backend/src/hello.ts`, `smoke.test.ts` | The Phase 0 backend starters |
| Updated | `tools/smoke-dev.mjs` | The proxy check posts a real query through port 3000 instead of calling the old `/api/ping` |

New entries in `tools/gates.json`: `node tools/verify-manifest.mjs 7`, `npm run test:db` and `npm run test:e2e`.

### Verification

| # | Check | Command | Pass condition |
| :-- | :-- | :-- | :-- |
| 1 | Everything due is built, exported and tested | `node tools/verify-manifest.mjs 7` | Prints `manifest OK: 94 entries (75 modules, 8 gateways, 11 coordinators); 59 due by phase 7, each built, exported and tested for every listed error code` and exits 0 |
| 2 | MySQL passes the same store conformance suite as memory | `npm run test:db` | Passes. Also: running the migration twice changes nothing; a date reads back as `YYYY-MM-DD`; the largest quantity, 500,000,000, reads back as an integer; a write whose second operation violates a constraint leaves the first undone |
| 3 | The HTTP contract holds | `npm run test:e2e` | Passes, with real Express and real MySQL. `/healthz` answers ok. Each route gives one success and one failure with the status of the Phase 2 table: 400, 422, 409, 500 for server faults, 413 for an oversized body, 404 for an unknown URL |
| 4 | State survives a restart | same command as row 3 | Stop the server and start it again on the same database: the same queries give the same answers, and the seed is not loaded twice. After the first start the catalog lists the 6 recipes of Appendix A and none is blocked |
| 5 | Requests run one at a time | same command as row 3 | Ten parallel `InboundBatch` requests of 100,000 each for one Food Type: exactly 5 succeed and 5 answer `CAP_EXCEEDED` |
| 6 | The clock uses the local date | `npm test` | With the time zone pinned to America/New\_York, 23:30 on Nov 12 gives Nov 12 (in UTC it is already Nov 13), and so does a day on which daylight saving changes |
| 7 | The web proxy reaches the real API | `node tools/smoke-dev.mjs` | Prints `smoke OK`: the API answers `/healthz`, a query sent through port 3000 reaches Express and MySQL, and the built CSS still holds the Tailwind classes |
| 8 | Gateways stay at the edge | `npm run lint && npm run typecheck` | Both exit 0. A gateway importing a module, a coordinator or another gateway would fail |
| 9 | A clean database works (one time) | Drop and recreate `freshrescue_test`, then run `npm run gate -- 7` | Passes, so nothing depends on data left from earlier runs |

**Exit gate.** `npm run gate -- 7` prints `Gate 7: passed (19 checks).` Row 9 is a one-time check made by hand.

## Phase 8 — Frontend modules: parsers, slices and the 16 views (26 modules)

**Goal.** All 26 frontend modules exist as pure functions that need no browser: two parsers, two calculations, six slices and sixteen views. Between them they turn form text into commands, replies into view data or notices, events into new state, and state into a `RenderTree`.

**Depends on.** Gate 7. Run `npm run gate -- 7` first.

### What gets built

Each module lives in `packages/frontend/src/modules/<group>/<name>.ts`, exports one function named like its file, has a test beside it, and imports contracts only (two slices also import `xstate`). About 3,770 lines. No module imports React or Next.js or touches the DOM: a view returns a `RenderTree`, and `DomHostGateway` paints it in Phase 9.

| Group | Modules | Est. lines |
| :-- | :-- | :-- |
| `parsing`, hand-written | FP-01 `FormSchemaParser` (form text to command payload, driven by the 8 form schemas), FP-02 `ApiResponseParser` (raw HTTP result to view data or an error) | 540 |
| `computation` | FC-01 `ErrorNoticeMapper`, FC-02 `FormPrefillBuilder` | 260 |
| `slices` | FS-01 `ResourceSlice` and FS-02 `FormSlice` (XState machines run through `getNextSnapshot`), FS-03 `NavigationSlice`, FS-04 `NoticeSlice`, FS-05 `CatalogViewSlice`, FS-06 `CookQueueSlice` | 590 |
| `views` | FU-01 `AppShellView`, FU-02 `NoticeBarView`, FU-03 `DemoControlView`, FU-04 `InventoryListView`, FU-05 `FoodTypeDetailView`, FU-06 `BatchFormView`, FU-07 `FoodTypeFormView`, FU-08 `UnitConversionModalView`, FU-09 `ConfirmDialogView`, FU-10 `WarningPanelView`, FU-11 `RecommendationView`, FU-12 `RecipeCatalogView`, FU-13 `CookQueueView`, FU-14 `CookReportView`, FU-15 `RecipeFormView`, FU-16 `CategoryManagerView` | 2,380 |

Also in this phase: `packages/frontend/src/testing/render.ts`, which turns a `RenderTree` into text so that tests can read what a view shows, and the removal of the Phase 0 XState probe `packages/frontend/src/smoke.test.ts`, because the slice tests now cover XState. A new entry in `tools/gates.json` runs `node tools/verify-manifest.mjs 8`.

The events that the views emit are typed by the `ui` contract (`UiPayloads`): a button that opens a form carries the record that the form is about, and `FormPrefillBuilder` takes that record as its view data, typed by the kind of form. `packages/frontend/src/testing/fixtures.ts` holds sample read models and slice states for the tests of the views; like `render.ts` it is not a module, and production code never imports it. One test crosses modules: `packages/frontend/src/testing/forms.test.ts` opens every form from the event of a view with `FormPrefillBuilder` and `FormSlice`, draws it with its view and reads it with `FormSchemaParser`, so a view and a module that disagree about a form fail there, before any coordinator exists.

### Verification

| # | Check | Command | Pass condition |
| :-- | :-- | :-- | :-- |
| 1 | Everything due is built, exported and tested | `node tools/verify-manifest.mjs 8` | Prints `manifest OK: 94 entries (75 modules, 8 gateways, 11 coordinators); 85 due by phase 8, each built, exported and tested for every listed error code` and exits 0 |
| 2 | Form text becomes the right payload or the right error | `npx vitest run --project node packages/frontend/src/modules/parsing` | Passes. Each of the 6 form codes is produced by a test; each of the 8 form schemas has a success case whose payload fits its command type; `ApiResponseParser` produces `BAD_JSON`, `BAD_RESPONSE` and `HTTP_STATUS` |
| 3 | Slices follow their transition tables | `npx vitest run --project node packages/frontend/src/modules/slices` | Passes. Every transition of the two XState machines is exercised, an event that a state does not handle changes nothing, and no slice changes its input |
| 4 | Views draw from data alone | `npx vitest run --project node packages/frontend/src/modules/views` | Passes. Each view is rendered from fixture state and read back through `render.ts`; every node is one of the six kinds, every slot is one of the 16 slot ids, and every class comes from the `ui` contract's tokens |
| 5 | Every error has a message | `npx vitest run --project node packages/frontend/src/modules/computation` | Passes. A table test walks all 58 codes of the catalog and `ErrorNoticeMapper` gives each one a notice |
| 6 | Modules stay free of browsers and frameworks | `npm run lint && npm run typecheck` | Both exit 0. A `document` or `window` reference, or a React import, in a module would fail |

The cases that rows 2, 4 and 5 must include:

- **Inbound name fields (spec 4.2.5).** A picked Food Type gives its id and no name; a typed name gives the name and no id; a form with neither gives two nulls.
- **Quantity text (spec section 3).** `1.5` gives 1500 thousandths and `0.001` gives 1. `1.2345` is `QTY_DECIMALS`; `1e3`, `-2` and `1,000` are `QTY_FORMAT`; an empty field is `FIELD_REQUIRED`.
- **Messages the specification words out.** "No near-expiry items" (row 13), "No recipe can rescue your near-expiry items yet" (row 17), "Nothing available to deduct" (row 16), and "Remove all N batches first" (row 15).
- **Inventory rows (spec 4.7.1, rows 22 and 23).** A Food Type with batches in several statuses shows a breakdown such as `Fresh 300 · Near-Expiry 150 · Expired 100`, omits statuses with quantity 0, and takes its badge from the most urgent status. A Food Type with no batches shows quantity 0 and "—".

**Exit gate.** `npm run gate -- 8` prints `Gate 8: passed (20 checks).`

## Phase 9 — Frontend coordinators, gateways and the Next.js app

**Goal.** The browser app works end to end against a stand-in API. Three gateways touch the outside world, six coordinators run the 28 workflows, and the Next.js page mounts the whole thing. The real server joins in Phase 10.

**Depends on.** Gate 8. Run `npm run gate -- 8` first.

### What gets built

Coordinators go in `packages/frontend/src/coordinators/` and gateways in `packages/frontend/src/gateways/`. Each has a test beside it named `*.dom.test.ts`, which the `dom` project runs in jsdom. Coordinators receive their gateways as typed ports, so the same code runs against `fakeApi` in tests and against the real gateways in the browser.

| ID | Piece | What it does |
| :-- | :-- | :-- |
| FX-06 | `AppCoordinator` | The top of the app. `start` loads reference data and the first screen and starts the midnight timer. Every `UiEvent` goes to one sub-coordinator through `UI_ROUTES`, and after each event the views are rebuilt and repainted. `stop` cancels the timer and detaches the page listeners |
| FX-07 | `ShellCoordinator` | 5 workflows: navigate, pushNotice, dismissNotice, loadReferenceData, submitSimulatedToday |
| FX-08 | `InventoryCoordinator` | 7 workflows: loadList, openDetail, refresh, loadWarnings, addBatch, editBatchQuantity, removeBatch |
| FX-09 | `TaxonomyCoordinator` | 6 workflows: saveFoodType, changeUnit, deleteFoodType, saveCategory, deleteCategory, setThreshold |
| FX-10 | `RecipeBookCoordinator` | 7 workflows: loadRecommendations, openInCook, loadCatalog, setCuisineFilter, highlightRecipe, saveRecipe, deleteRecipe |
| FX-11 | `CookingCoordinator` | 3 workflows: editQueue, runCook, dismissReport |
| FG-01 | `apiGateway` | Sends commands and queries with `fetch` to `/api/command` and `/api/query` and returns the `ApiResponse`. When there is no reply it returns a `NETWORK_ERROR` or `TIMEOUT` error instead. The timeout is a timer that races the request, not an AbortSignal, so the gateway behaves the same under jsdom, Node and the browser |
| FG-02 | `midnightTimerGateway` | Calls back once when the local date changes, then arms itself for the next midnight |
| FG-03 | `domHostGateway` | Paints a `RenderTree` into the 16 slots and passes clicks and typing on as events (an input or a select adds its text as `value`). Returns `SLOT_NOT_FOUND` if a slot is missing |

The rest of the phase sits around them:

| File | Change |
| :-- | :-- |
| `apps/web/src/compose.ts` | New. The only place where the real gateways (browser `fetch`, `document`, timers) and the six coordinators are wired together. It returns `start` and `stop` |
| `apps/web/src/components/AppHost.tsx` | New. A client component that renders the 16 empty slots, calls `start` when it mounts and `stop` when it unmounts. React never touches what is inside the slots |
| `apps/web/src/app/page.tsx` | Rewritten to render `AppHost` |
| `packages/frontend/src/index.ts` | Exports what `compose.ts` needs |
| `packages/frontend/src/testing/fakeApi.ts` | New. A scripted stand-in for `apiGateway`: it answers each message name with a prepared reply and records every request it receives |
| `packages/frontend/src/smoke.dom.test.ts`, `packages/frontend/src/tokens.ts` | Deleted. The Phase 0 probes give way to the real coordinators and the `ui` contract's tokens |
| `tools/smoke-dev.mjs` | Updated. The CSS check now looks for a real class from the `ui` contract's tokens, and the home page must hold all 16 slot elements |
| `vitest.config.ts` | Updated. The `dom` project pins `TZ` to America/New\_York, as the `node` project does, so the midnight tests mean the same on every machine |
| `tools/gates.json` | New entry: `node tools/verify-manifest.mjs 9` |

The build, the jsdom tests and the dev smoke check have been in the gate since Phase 0. This phase makes them run real code instead of starters.

### Verification

| # | Check | Command | Pass condition |
| :-- | :-- | :-- | :-- |
| 1 | Everything due is built, exported and tested | `node tools/verify-manifest.mjs 9` | Prints `manifest OK: 94 entries (75 modules, 8 gateways, 11 coordinators); 94 due by phase 9, each built, exported and tested for every listed error code` and exits 0 |
| 2 | Gateways work at their edges | `npx vitest run --project dom packages/frontend/src/gateways` | Passes. `apiGateway` returns `NETWORK_ERROR` when `fetch` fails and `TIMEOUT` when it never answers. `domHostGateway` paints a tree into the slots, passes input on as events and returns `SLOT_NOT_FOUND` for a missing slot. `midnightTimerGateway` calls back once per local midnight under fake timers |
| 3 | Every event has exactly one owner | `npx vitest run --project dom packages/frontend/src/coordinators/AppCoordinator` | Passes. One event from each of the 16 `UiEvent` namespaces is sent in; exactly one sub-coordinator receives it, and it is the one `UI_ROUTES` names |
| 4 | Every workflow runs against the stand-in API | `npx vitest run --project dom packages/frontend/src/coordinators` | Passes. Each of the 28 workflows has a test that starts from one event, checks the messages `fakeApi` received, and checks what was painted afterwards |
| 5 | The app builds and renders on the server | `npm run build` | Exits 0. The build pre-renders the page on the server, so a gateway that touches `document` when it is imported fails here |
| 6 | Both dev servers boot and the page is the real one | `node tools/smoke-dev.mjs` | Prints `smoke OK`: the home page holds all 16 slot elements, the CSS holds a real class from the `ui` contract's tokens, and a query sent through the Next rewrite still gets an answer |
| 7 | Coordinators and gateways follow the guard rails | `npm run lint && npm run typecheck` | Both exit 0. The coordinator and gateway rules proven in Phase 1 now apply to real files |
| 8 | One-time: the page shows the seeded data | `npm run dev`, then open http://localhost:3000 | The inventory list shows the 8 seeded Food Types, Beef to Tomato, each with quantity 0 and "—". No notice appears and the browser console shows no errors. Reloading the page shows the same list |

The cases that rows 3 and 4 must include:

- **Startup.** Starting the app sends `GetReferenceData` and the queries for the first screen, then paints the answers.
- **Success reloads.** After a command succeeds, the coordinator reloads what is on screen and paints the answers. The screen never shows a figure that the frontend worked out itself.
- **Failure becomes a notice.** A command answered with an error code (`CAP_EXCEEDED`, say) is painted as a notice in the notice bar, and the data on screen is left as it was. A `NETWORK_ERROR` is treated the same way.
- **Cooking.** `editQueue` sends nothing. `runCook` sends one `CookRecipes` command with the queue as it stands and paints the report. `dismissReport` removes the report.
- **Simulated Today.** `submitSimulatedToday` sends `SetSimulatedToday`, then reloads everything on screen, and the statuses painted afterwards come from the new date.
- **Midnight (spec row 20).** When the timer calls back, the screen reloads without any user action. With `fakeApi` answering differently before and after, the painted statuses change.
- **Mounting twice.** `start`, `stop`, `start` (what React does in development) leaves one timer and one set of page listeners, so one click sends one request.

**Exit gate.** `npm run gate -- 9` prints `Gate 9: passed (21 checks).`

## Phase 10 — Full-stack integration and acceptance against spec v1.3

**Goal.** The finished system, with the real frontend talking to the real API and MySQL, reproduces every worked example in the spec, covers every row of its exception matrix and accounts for all 58 error codes. After this phase the software is complete; Phase 11 only packages it.

**Depends on.** Gate 9. Run `npm run gate -- 9` first.

### What gets built

No product code is planned here. Phase 10 adds tests and one checking script. If an acceptance test fails, the fault is fixed in the module that owns it, and a case that would have caught it is added to that module's own tests, so that an earlier gate catches it next time.

| File | What it holds |
| :-- | :-- |
| `apps/api/test/worked-examples.e2e.test.ts` | The five worked examples of the spec as HTTP scenarios against the real server and `freshrescue_test`: 4.2.1, 4.2.2, 4.3.4, and 4.5 in its Partial and FEFO forms |
| `apps/api/test/exception-matrix.e2e.test.ts` | One test for each row of the exception matrix, titled with its row number. Row 4 is exercised inside the journeys, so this file holds 22 |
| `tools/journeys.e2e.test.ts` | The real frontend coordinators, gateways and views, in jsdom, talking to the real API: the six journeys below. The `apiGateway` is pointed at the test server's address. The file's first line, `// @vitest-environment jsdom`, switches this one file to jsdom while the `e2e` project stays on node. The journey that covers row 4 names it in its title |
| `tools/check-error-codes.mjs` | Reads the 58 codes of the `errors` contract. A code passes if some end-to-end test expects it, or if the script lists it with a one-line reason. The script fails on a code that has neither, and on an explained code that a test does cover, because that explanation has gone stale |
| `tools/gates.json` | New entry: `node tools/check-error-codes.mjs`. The new test files need no entry, since `npm run test:e2e` has been in the gate since Phase 7 |

### Verification

| # | Check | Command | Pass condition |
| :-- | :-- | :-- | :-- |
| 1 | The spec's worked examples hold | `npx vitest run --project e2e apps/api/test/worked-examples.e2e.test.ts` | Passes. The five scenarios give the figures listed below, over real HTTP and real MySQL |
| 2 | Every row of the exception matrix is covered | `npx vitest run --project e2e apps/api/test/exception-matrix.e2e.test.ts tools/journeys.e2e.test.ts --reporter=verbose` | Passes. The output lists a passing test for every row number from 1 to 23 |
| 3 | The real frontend works on the real API | `npx vitest run --project e2e tools/journeys.e2e.test.ts` | Passes. The six journeys run through the real coordinators, gateways and views |
| 4 | Every error code is seen or explained | `node tools/check-error-codes.mjs` | Prints `error codes OK: 58 codes (N seen end to end, M explained)` with N + M = 58, and exits 0. Deleting the only test that expects a code makes it exit 1 and name that code |
| 5 | One-time: a clean database works | Drop and recreate `freshrescue_test`, then run `npm run gate -- 10` | Passes, so the whole system starts from nothing and nothing depends on data left from earlier runs |
| 6 | One-time: a person uses it | Drop and recreate `freshrescue`, run `npm run dev`, open http://localhost:3000 and follow the walkthrough below | Every step shows what it says |

The figures that row 1 must reproduce:

- **4.2.1, separate batches.** Milk added on Oct 1 (500 ml, 5-day shelf life, expires Oct 6) and on Oct 2 (1000 ml, 10-day shelf life, expires Oct 12) stay two batches under Dairy → Liquid Dairy → Milk, and the Food Type's detail lists both.
- **4.2.2, unit change.** Chicken with batches of 100 g and 200 g changes its unit from grams to pieces, and the batches then show the quantities the spec prints for that change.
- **4.3.4, dates.** A batch added on Oct 1, 2026 with a 3-day shelf life expires on Oct 4. With Simulated Today set from Oct 1 through Oct 4 it is Near-Expiry, and from 00:00 on Oct 5 it is Expired.
- **4.5, Partial.** A recipe needing 300 g Beef and 200 g Broccoli, with 150 g Beef and 250 g Broccoli in stock: cooking deducts 200 g Broccoli (50 g left) and 0 g Beef.
- **4.5, FEFO.** A recipe needing 300 g Beef, with batch A of 100 g expired, batch B of 150 g near-expiry and batch C of 200 g fresh: cooking uses up B and takes 150 g from C (50 g left), and the expired batch A is left alone.

The six journeys of row 3:

- **First run.** On an empty database the first start seeds Appendix A. The page lists the 8 Food Types with quantity 0, and the catalog lists the 6 recipes.
- **Stock in.** Add a batch under a name that does not exist yet, and a new Food Type appears. Edit the batch's quantity, then remove the batch. Save the form once with the name left blank and read the "name is empty" message (row 3). 
- **Rescue and cook.** Add a Chicken batch with a 3-day shelf life, which is Near-Expiry at once. The warning panel lists it and the recommendations show the recipes that use Chicken. Put one in the cook queue, run it and read the report; the stock drops by what the report says.
- **Taxonomy.** Create a category, move a Food Type into it, change a threshold, change a unit through the confirm dialog, try to delete a Food Type that still has a batch and read the message (row 15), then delete it once it is empty.
- **Recipes.** Create a recipe, edit it and delete it. Delete a built-in recipe too, because the rules are the same for both.
- **Time and restart.** Move Simulated Today forward and watch the statuses change. Stop the app and start a new one against the same server, and the same state appears. Restart the server itself, and it appears again. The midnight timer was tested with fake timers in Phase 9; here Simulated Today moves the date.

The walkthrough of row 6, which is the only place where a person looks at the page, since tests cannot judge layout:

1. Open the page. The 8 seeded Food Types are listed.
2. Add 500 g of Chicken with a 3-day shelf life. The warning panel lists the batch as Near-Expiry.
3. Open the recommendations, open one recipe in Cook and run it. The report appears and the Chicken stock drops.
4. Try to delete a Food Type that has a batch. A message asks you to remove its batches first.
5. Set Simulated Today a few days ahead. The statuses on the list and in the warning panel change.
6. Reload the page, then stop and restart `npm run dev`. The same data is there.
7. Look at the page itself: nothing overlaps, every button can be read, and the notice bar is visible when a notice appears.

**Exit gate.** `npm run gate -- 10` prints `Gate 10: passed (22 checks).` Rows 5 and 6 are one-time checks and are not part of the gate.

## Phase 11 — Docker packaging and release check

**Goal.** The whole system starts with one command on a machine that has only Docker, and a script proves that it works. This is the last phase, and passing its gate re-runs all 25 checks of the plan from the first to the last.

**Depends on.** Gate 10. Run `npm run gate -- 10` first.

**Not dry-run.** The scratch project used to check this plan had no Docker daemon. Only `docker compose config -q` was run, on a draft of `compose.yaml`, and it passed. No image was built and no container was started, so treat the Dockerfile and the smoke script as the least-tested part of the plan and expect to adjust them.

### What gets built

| File | What it does |
| :-- | :-- |
| `Dockerfile` | One file with three stages. `build` runs `npm ci` and `npm run build`; it declares `ARG API_ORIGIN=http://api:4000` first, because Next bakes its `/api` rewrite into the build. `api` and `web` start from the built tree and run their workspace's `start` script; the API runs TypeScript through `tsx`, as it does in development. Each has a `HEALTHCHECK` that calls `fetch` from Node, since the slim image has no `curl`. The Node version comes from a `NODE_VERSION` argument, and `engine-strict` makes `npm ci` fail inside the image, as it does on a laptop, if that Node is older than the 22.22.2 floor |
| `.dockerignore` | Keeps `node_modules`, `.next`, `.git` and `.env` out of the build context, so no local build output or setting reaches an image |
| `compose.yaml` | Three services. `db` is `mysql:8.4` with a `mysqladmin ping` healthcheck and a named volume for its data. `api` is built from the `api` stage, waits for `db` to be healthy, gets `DATABASE_URL` pointing at `db`, `API_PORT=4000` and the host's `TZ` (UTC if unset), and is not published. `web` is built from the `web` stage with `API_ORIGIN=http://api:4000`, waits for `api` to be healthy and is published on port 3000 |
| `tools/smoke-compose.mjs` | Starts the stack, checks it as listed below, and always ends by taking it down together with its volume |
| `README.md` | What the project is; how to run it on the machine (create the databases, copy `.env.example`, `npm install`, `npm run dev`); how to run it in Docker (`docker compose up --build -d --wait`, open http://localhost:3000, `docker compose down -v` to stop and erase); the `TZ` setting; how to run the checks (`npm run gate -- 11`) |
| `tools/gates.json` | Three new entries: `docker compose config -q`, `docker compose build` and `node tools/smoke-compose.mjs` |

### Verification

| # | Check | Command | Pass condition |
| :-- | :-- | :-- | :-- |
| 1 | The compose file is valid | `docker compose config -q` | Exits 0 and prints nothing |
| 2 | Both images build | `docker compose build` | Exits 0 for `api` and `web`. The first build downloads the base images and installs every dependency, so it takes minutes |
| 3 | The stack runs and answers | `node tools/smoke-compose.mjs` | Prints `compose OK` and exits 0. The checks it makes are listed below |
| 4 | Teardown leaves nothing behind | `docker compose ps -a`, then `docker volume ls`, after row 3 | The first lists no container of the project, and the second lists no volume whose name starts with `freshrescue` |
| 5 | One-time: the API container uses the host's calendar day | `TZ=America/New_York docker compose up -d --wait`, then `docker compose exec api date +%F` and `TZ=America/New_York date +%F`, then `docker compose down -v` | Both dates are the same. Without `TZ` the container would use UTC, which is why the setting exists |
| 6 | One-time: the README works from a clean checkout | `git clone . ../freshrescue-check`, then follow only the README's Docker steps in that folder | The page opens at http://localhost:3000 and shows the seeded list. Stop the dev servers first, or port 3000 is taken |
| 7 | One-time: nothing is left to commit | `git status --porcelain` and `git ls-files .env` | Both print nothing |

What row 3 checks, in order:

- `docker compose up -d --wait` returns only when `db`, `api` and `web` are all healthy. If one never becomes healthy, the script prints that service's logs.
- `GET /` on port 3000 answers 200 and holds all 16 slot elements.
- A `GetReferenceData` query posted to `/api/query` on port 3000, which the web container forwards to the API, returns the 8 seeded Food Types, and `GetCatalog` returns the 6 recipes.
- One command round trip: a `SaveCategory` command sent through port 3000 creates a category, and a later query lists it.
- After `docker compose restart api` and a wait for health, the category is still there and the seed was not loaded twice: still 8 Food Types and 6 recipes.
- Whatever the outcome, the script ends with `docker compose down -v`, so a failed run leaves nothing running.

**Exit gate.** `npm run gate -- 11` prints `Gate 11: passed (25 checks).` Rows 5 to 7 are one-time checks and are not part of the gate.

## Risks and watch-outs

Each risk is listed with the phase whose check would show it. None of them is a reason to stop; the list says what to look at first when a check fails.

| Risk | What goes wrong | What the plan does | Caught in |
| :-- | :-- | :-- | :-- |
| TypeScript 7 is the newest release | A later `npm update` or `npm install typescript@latest` would install TypeScript 7, which typescript-eslint does not support yet, so lint breaks | TypeScript is pinned to 6.0.x. Revisit when typescript-eslint adds TypeScript 7 | Phase 0 (`npm run lint`) |
| Node older than the floor | jsdom 31 needs Node 22.22.2 or newer, and an older Node fails in odd ways | `engines` and `engine-strict=true` stop `npm install` with a clear message. The Dockerfile must pick a Node that respects the same floor | Phase 0 (before-you-start table), Phase 11 (image build) |
| Noise that looks like failure | `npm audit` reports 11 moderate advisories inside the ESLint toolchain, and `npm ls --all` exits 1 on this tree | The gate runs plain `npm ls` and no audit. Never run `npm audit fix --force`, which changes major versions | Phase 0 |
| Tailwind 4 misses workspace packages | It scans the app's own folder by default, so class names written in `packages/` or `contracts/` produce no CSS and the page looks unstyled | `globals.css` has an `@source` line for every workspace that holds class names | Phase 0 (`smoke-dev.mjs` probe), Phase 9 (real token class) |
| A guard rail that matches nothing | An ESLint rule with a wrong pattern passes silently and forbids nothing | `tools/guards.test.ts` gives each rule a violation and fails if the rule does not reject it | Phase 1 |
| Server packages reach the browser | `joi`, `mysql2` or `express` imported by frontend code would be bundled for the browser. The contracts are not marked `sideEffects: false`, so `http-status-codes` may be bundled too; it is small and harmless | `tools/verify-layout.mjs` fails on an undeclared import, or on one that the allowed-imports table forbids | Phase 1, Phase 9 (`npm run build`) |
| The date depends on the time zone | `toISOString()` gives the UTC date, so on a New York evening "today" is already tomorrow and every status is a day off. A container runs on UTC unless told otherwise | The clock gateway reads the local calendar. The test projects pin `TZ`, and compose passes the host's `TZ` to the API | Phase 7 (row 6), Phase 9 (midnight tests), Phase 11 (row 5) |
| mysql2 turns DATE into a JavaScript date | A DATE column arrives as a `Date` at local midnight and can shift by a day when it is printed | The pool sets `dateStrings: true`, so dates stay `YYYY-MM-DD` text | Phase 7 (`npm run test:db`) |
| `VALUES()` in upserts is deprecated | `ON DUPLICATE KEY UPDATE col=VALUES(col)` works in MySQL 8.4 but has been deprecated since 8.0.20, so it prints a warning and a later release could drop it | The write gateway is the only place that writes SQL. The row-alias form (`AS new`, available from 8.0.19, the minimum version) is the replacement | Phase 7 |
| Two writes at once overwrite each other | The backend reads a full snapshot per request, so two simultaneous writes could start from the same snapshot, and the second would erase the first | The HTTP gateway runs requests one at a time through a promise chain. That holds for one API process only, so compose starts exactly one | Phase 7 (row 5: ten parallel requests, five succeed) |
| Browser code that runs on import | Next pre-renders the page on the server, where `document` does not exist, and React's development double-mount calls `start` twice | Gateways touch the browser only when used, never at import, and `stop` undoes everything `start` did | Phase 9 (`npm run build`, the "mounting twice" case) |
| Test environments differ from browsers | jsdom and Node do not implement every web API alike, `AbortSignal` among them | `apiGateway` enforces its timeout with a timer, not by aborting the request, so it does not depend on which `AbortSignal` exists | Phase 9, Phase 10 (journeys) |
| Next bakes the `/api` rewrite into the build | An image built without `API_ORIGIN=http://api:4000` sends API calls to `localhost:4000` inside the web container, where nothing listens | The Dockerfile declares `ARG API_ORIGIN` with that default, and `.dockerignore` keeps the dev `.env` out | Phase 11 (row 3 posts a query through port 3000) |
| TypeScript runs in the image | The API runs through `tsx`, so development tools stay in the image and the code is compiled at start-up | Accepted for a demo. The healthcheck waits until the server answers | Phase 11 |
| Ports already taken | The dev servers or another program hold port 3000, so `docker compose up` fails | Stop the dev servers first. Phase 0's before-you-start table and the README say so | Phase 0, Phase 11 (row 6) |
| MySQL and Docker steps were never run | Neither was available while the plan was checked, so an authentication setting, a healthcheck delay or a path may need adjusting on the first run | Phases 7 and 11 carry a "Not dry-run" notice, and each has rows that fail loudly | Phase 7, Phase 11 |
| Fuzzy search is not used | The spec asks for an exact, case-insensitive match on a Food Type name, and a name with no match creates a new Food Type. A fuzzy matcher such as fuse.js would silently merge "Tomato" and "Tomatoes" | fuse.js is not installed. If the spec ever asks for suggestions, add them to the form and keep `FoodTypeResolver` exact | Phase 5 (resolver tests) |

## Appendix: which phase builds what

The blueprint's 83 modules (75 pure modules and 8 gateways) and its 11 coordinators make 94 manifest entries, and each one is built in exactly one phase. `tools/manifest.txt` lists all 94 with their phase and error codes, and `node tools/verify-manifest.mjs N` checks the ones due by phase N. Phases 0 to 2 build no entry: they make the project, the folders and the contracts. Phases 10 and 11 add tests and packaging only.

| Phase | What is built | Count | IDs |
| :-- | :-- | :-- | :-- |
| 3 | Backend modules: parsing, state and foundation | 13 | BP-01 to BP-04, BS-01, BC-01 to BC-08 |
| 4 | Backend modules: derive and engine | 20 | BC-09 to BC-19, BC-36 to BC-44 |
| 5 | Backend modules: decide | 16 | BC-20 to BC-35 |
| 6 | Backend coordinators | 5 | BX-01 to BX-05 |
| 7 | Backend gateways | 5 | BG-01 to BG-05 |
| 8 | Frontend modules: parsers, computations, slices and views | 26 | FP-01, FP-02, FC-01, FC-02, FS-01 to FS-06, FU-01 to FU-16 |
| 9 | Frontend coordinators and gateways | 9 | FX-06 to FX-11, FG-01 to FG-03 |
|  | **Total** | **94** | 75 modules, 8 gateways, 11 coordinators |

The 19 messages (13 commands and 6 queries) reach the backend through `BackendCoordinator` (BX-01), which parses each request with BP-01 or BP-02 and hands the message to exactly one of the other four coordinators. All 19 are built in Phase 6, reach HTTP in Phase 7, are sent by the frontend from Phase 9 and are exercised together in Phase 10.

| Backend coordinator | Messages | Sent by the frontend from |
| :-- | :-- | :-- |
| BX-02 `ReferenceCommandCoordinator` | SaveCategory, DeleteCategory, SetCategoryThreshold, SaveFoodType, DeleteFoodType, SetSimulatedToday | Taxonomy: saveCategory, deleteCategory, setThreshold, saveFoodType, deleteFoodType. Shell: submitSimulatedToday |
| BX-03 `InventoryCommandCoordinator` | ChangeFoodTypeUnit, InboundBatch, EditBatchQuantity, RemoveBatch | Taxonomy: changeUnit. Inventory: addBatch, editBatchQuantity, removeBatch |
| BX-04 `RecipeCommandCoordinator` | SaveRecipe, DeleteRecipe, CookRecipes | RecipeBook: saveRecipe, deleteRecipe. Cooking: runCook |
| BX-05 `QueryCoordinator` | GetReferenceData, GetInventoryList, GetFoodTypeDetail, GetWarningPanel, GetRecommendations, GetCatalog | Shell: loadReferenceData. Inventory: loadList, refresh, openDetail, loadWarnings. RecipeBook: loadRecommendations, loadCatalog |

*Sources.* Package versions were resolved from the npm registry on 2026-11-12. The module, coordinator and message names come from the System Architecture Blueprint and from specification v1.3.
