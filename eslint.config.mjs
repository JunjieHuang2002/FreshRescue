import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { guardRails } from './eslint.guards.mjs';

// eslint-config-next ships entries that match every file. Scope each one to apps/web,
// and keep its global ignore entry as it is.
const webFiles = ['apps/web/**/*.{js,jsx,mjs,ts,tsx,mts,cts}'];
const nextRulesForWeb = nextCoreWebVitals.map((entry) =>
  Object.keys(entry).every((key) => key === 'ignores') ? entry : { ...entry, files: webFiles },
);

export default defineConfig([
  globalIgnores(['**/node_modules/**', '**/.next/**', '**/coverage/**', '**/dist/**', '**/next-env.d.ts']),

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    rules: {
      // a leading underscore marks a parameter that is required by a signature but unused
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // plain JavaScript files (tool scripts, config files) run on Node
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },

  // the Next.js rules apply to the web app only
  ...nextRulesForWeb,
  {
    files: webFiles,
    settings: { next: { rootDir: 'apps/web' } },
  },

  // the blueprint's four rules (phase 1): imports, clock and IO, size, contract shape
  ...guardRails,
]);
