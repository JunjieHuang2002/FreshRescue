import type { Id, QtyMilli } from '@freshrescue/contract-primitives';
import type { CookOutcome, SkipReason } from '@freshrescue/contract-rules';

/** An ingredient that was deducted. */
export type DeductedLine = {
  readonly foodTypeId: Id;
  readonly name: string;
  readonly quantity: QtyMilli;
  readonly unit: string;
};

/** An ingredient that was skipped as missing: the recipe needed more than was available (spec 4.5). */
export type MissingLine = {
  readonly foodTypeId: Id;
  readonly name: string;
  readonly needed: QtyMilli;
  readonly available: QtyMilli;
  readonly unit: string;
};

/** What happened to one queued recipe (spec 4.5, "Execution Result Summary"). */
export type CookReportEntry = {
  readonly recipeId: Id;
  readonly recipeName: string;
  readonly outcome: CookOutcome;
  /** Why the recipe was skipped. null when it was cooked. */
  readonly reason: SkipReason | null;
  readonly deducted: readonly DeductedLine[];
  readonly missing: readonly MissingLine[];
};

/** The reply to CookRecipes: one entry for each queued recipe, in queue order. */
export type CookReportDto = {
  readonly reports: readonly CookReportEntry[];
};
