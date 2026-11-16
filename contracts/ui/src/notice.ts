import type { UiNamespace } from './events';

/** How serious a notice is. */
export const SEVERITIES = ['error', 'warning', 'info'] as const;

export type Severity = (typeof SEVERITIES)[number];

/**
 * A message for the person (blueprint 1.7): what ErrorNoticeMapper makes of an error. `fieldHints`
 * maps a form field to the hint shown beside it, and is empty when the error is not about a field.
 */
export type NoticeModel = {
  readonly severity: Severity;
  readonly text: string;
  readonly fieldHints: Readonly<Record<string, string>>;
};

/**
 * What a confirmation dialog shows. The dialog is one view for four confirmations (remove a batch,
 * delete a Food Type, a category or a recipe), so the model names the namespace of the form that
 * the Confirm and Cancel buttons send their events to.
 */
export type ConfirmModel = {
  readonly ns: UiNamespace;
  readonly title: string;
  readonly lines: readonly string[];
  readonly confirmLabel: string;
};
