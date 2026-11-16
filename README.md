# FreshRescue

FreshRescue is a smart refrigerator inventory and recipe assistant that helps a household waste less food. It
tracks every batch of food with its own shelf life, warns about food that is about to expire, recommends the
recipes that use that food first, and deducts what a cooked recipe uses from the oldest batches first
(First-Expired, First-Out). It is a single-user software demo: there is no hardware, no account and no sync.

The rules are in [docs/FreshRescue_MVP.md](docs/FreshRescue_MVP.md) (specification v1.3), the design in
[docs/FreshRescue_System_Architecture_Blueprint.md](docs/FreshRescue_System_Architecture_Blueprint.md), and the
order in which it was built and checked in [docs/FreshRescue_Implementation_Plan.md](docs/FreshRescue_Implementation_Plan.md).

## How it is put together

The code is one npm workspace with 13 packages. Nine read-only contract packages (`contracts/`) hold the types
and constants that everything else shares. The backend (`packages/backend`) and the frontend
(`packages/frontend`) are built from small modules that import nothing but contracts, and a few thin
coordinators that call the modules in order. Two apps run them: `apps/api` serves the backend over HTTP
(Express, with MySQL as the store), and `apps/web` is a Next.js page that mounts the frontend. The page talks to
the API through two JSON routes, `POST /api/command` and `POST /api/query`. The tools that check the layout and
run the gates are in `tools/`.

## Run it on this machine

You need Node.js 22.22.2 or newer in the 22 line, 24.15 or newer in the 24 line, or 26 and later; npm 10 or
newer; MySQL 8.0.19 or newer with an admin login; and nothing listening on ports 3000 and 4000.

1. Create the two databases (`freshrescue` and `freshrescue_test`) and their user. Use your own admin user if
   it is not `root`:

   ```bash
   mysql -u root -p < tools/sql/init-dev.sql
   ```

2. Create your settings file. The development password in it is public on purpose, because this is a demo:

   ```bash
   cp .env.example .env
   ```

3. Install the dependencies, and start the API and the web app together:

   ```bash
   npm install
   npm run dev
   ```

4. Open http://localhost:3000. The API listens on port 4000, and the page forwards `/api/*` to it. The first
   start creates the tables and loads the sample data of the specification's Appendix A: 8 Food Types with no
   stock, and 6 recipes.

## Run it in Docker

You need only Docker with Compose. Stop the development servers first, or port 3000 is taken.

```bash
docker compose up --build -d --wait
```

The command returns once all three services are healthy: `db` (MySQL 8.4, with its data in a named volume),
`api` (the API, reachable only inside the stack) and `web` (the page, published on port 3000). Then open
http://localhost:3000. To stop the stack and erase its data:

```bash
docker compose down -v
```

Leave out `-v` to keep the data for the next start.

## The time zone

The API decides what "today" is from the clock of the machine it runs on, and every freshness status follows
from that date. With `npm run dev` it uses the local time zone of this machine. In Docker, the API container
takes the `TZ` variable of the shell that starts the stack, and UTC when the shell has none. On a machine west
of UTC, a container on UTC is already on tomorrow in the evening. So start the stack with your time zone:

```bash
TZ=America/New_York docker compose up --build -d --wait
```

or export `TZ` in your shell profile (on Debian or Ubuntu, `export TZ=$(cat /etc/timezone)`). The Simulated
Today control of the page sets a demo date the same way in either case.

## Checks

```bash
npm run gate -- 11
```

runs every check of the implementation plan in order, from phase 0 to phase 11 (25 checks), and stops at the
first one that fails: the dependency tree, typecheck, lint, the unit and jsdom tests, the production build, the
development smoke check, the MySQL tests, the HTTP and end-to-end tests, the layout, manifest and error-code
checks, and the Docker build with its smoke check. It needs MySQL with the two databases of step 1, Docker,
and nothing on ports 3000 and 4000. The Docker smoke check starts its own stack and always takes it down with
its volume, so it refuses to run while a container or the data volume of the stack exists. `npm run gate -- N`
runs the checks up to phase N.

The test suites can also run on their own: `npm test` (unit and jsdom), `npm run test:db` (MySQL) and
`npm run test:e2e` (real HTTP and MySQL, and the page on the real API).
