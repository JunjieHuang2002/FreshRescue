import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_TABLES } from '@freshrescue/contract-changeset';
import { SNAPSHOT_LISTS } from '@freshrescue/contract-entities';
import { ERROR_FAMILY_OF } from '@freshrescue/contract-errors';
import { COMMAND_TYPES, QUERY_TYPES } from '@freshrescue/contract-messages';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Facts that span contract packages (plan, phase 2). A package cannot pin these in its own test,
// because it may not import the package on the other side of the fact.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Compiles `source` as a file in tools/ and returns its type errors. tools/ is not a workspace, so
 * `npm run typecheck` never reaches it: an `expectTypeOf` here would be a no-op. This runs the
 * compiler itself, so a type-level fact is really checked.
 */
function typeErrors(source: string): string[] {
  const probe = resolve(root, 'tools/contracts.probe.ts');
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noUncheckedIndexedAccess: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.getSourceFile = (fileName, languageVersionOrOptions, ...rest) =>
    fileName === probe
      ? ts.createSourceFile(fileName, source, languageVersionOrOptions)
      : getSourceFile.call(host, fileName, languageVersionOrOptions, ...rest);
  host.fileExists = (fileName) => fileName === probe || fileExists.call(host, fileName);
  host.readFile = (fileName) => (fileName === probe ? source : readFile.call(host, fileName));

  const program = ts.createProgram([probe], options, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

describe('contracts across packages', { timeout: 120_000 }, () => {
  it('names the 19 messages: 13 commands and 6 queries', () => {
    const commands = [
      'SaveCategory',
      'DeleteCategory',
      'SetCategoryThreshold',
      'SaveFoodType',
      'ChangeFoodTypeUnit',
      'DeleteFoodType',
      'InboundBatch',
      'EditBatchQuantity',
      'RemoveBatch',
      'SaveRecipe',
      'DeleteRecipe',
      'CookRecipes',
      'SetSimulatedToday',
    ];
    const queries = ['GetReferenceData', 'GetInventoryList', 'GetFoodTypeDetail', 'GetWarningPanel', 'GetRecommendations', 'GetCatalog'];

    expect([...COMMAND_TYPES]).toEqual(commands);
    expect([...QUERY_TYPES]).toEqual(queries);
    expect(new Set([...commands, ...queries]).size).toBe(19);
  });

  it('promises only error codes that exist', () => {
    const lines = readFileSync(resolve(root, 'tools/manifest.txt'), 'utf8').split('\n').filter(Boolean);
    const promised = lines.flatMap((line) => {
      const codes = line.trim().split(/\s+/)[3] ?? '-';
      return codes === '-' ? [] : codes.split(',');
    });
    const catalog = new Set(Object.keys(ERROR_FAMILY_OF));

    expect(lines).toHaveLength(94);
    expect(promised.length).toBeGreaterThan(0);
    expect(promised.filter((code) => !catalog.has(code))).toEqual([]);
  });

  it('has two more store tables than snapshot lists: the settings and the counters', () => {
    const lists: readonly string[] = SNAPSHOT_LISTS;
    const tables: readonly string[] = STORE_TABLES;

    expect(tables).toHaveLength(lists.length + 2);
    expect(lists.every((list) => tables.includes(list))).toBe(true);
    expect(tables.filter((table) => !lists.includes(table))).toEqual(['settings', 'counters']);
  });

  it('keeps BatchView an extension of Batch', () => {
    const imports =
      "import type { Batch } from '@freshrescue/contract-entities';\n" +
      "import type { BatchView } from '@freshrescue/contract-views';\n";
    const same = 'type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;\n';

    // a view can stand wherever a batch is wanted, and what it adds is only the derived fields
    expect(typeErrors(`${imports}declare const view: BatchView;\nexport const batch: Batch = view;\n`)).toEqual([]);
    expect(typeErrors(`${imports}${same}export const unchanged: Same<Omit<BatchView, 'daysLeft' | 'status'>, Batch> = true;\n`)).toEqual([]);
    // the check can fail: a plain batch lacks the derived fields, so it is not a view
    expect(typeErrors(`${imports}declare const batch: Batch;\nexport const view: BatchView = batch;\n`)).not.toEqual([]);
  });
});
