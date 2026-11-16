import { defineConfig } from 'vitest/config';

const notSource = ['**/node_modules/**', '**/.next/**', '**/dist/**'];

// Four projects, told apart by the file name:
//   name.test.ts      node  pure code; the time zone is pinned so dates mean the same everywhere
//   name.dom.test.ts  dom   jsdom, for the browser-side gateways and coordinators; the time zone is
//                           pinned too, so a local midnight is the same instant on every machine
//   name.db.test.ts   db    needs MySQL; runs on request:  npm run test:db
//   name.e2e.test.ts  e2e   needs MySQL and real HTTP; runs on request:  npm run test:e2e
// `npm test` runs node and dom only.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['**/*.test.ts'],
          exclude: [...notSource, '**/*.dom.test.ts', '**/*.db.test.ts', '**/*.e2e.test.ts'],
          env: { TZ: 'America/New_York' },
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['**/*.dom.test.ts'],
          exclude: notSource,
          env: { TZ: 'America/New_York' },
        },
      },
      {
        test: {
          name: 'db',
          environment: 'node',
          include: ['**/*.db.test.ts'],
          exclude: notSource,
          globalSetup: ['./tools/vitest.db-setup.ts'],
          // one MySQL database: test files must not run side by side
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['**/*.e2e.test.ts'],
          exclude: notSource,
          globalSetup: ['./tools/vitest.db-setup.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
});
