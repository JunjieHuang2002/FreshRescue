import type { FormState, RenderTree } from '@freshrescue/contract-ui';
import type { ReferenceDataDto } from '@freshrescue/contract-views';

/**
 * FU-03 DemoControlView. Draws the Simulated Today control (spec 4.3.4, blueprint 1.8). Closed, it
 * shows the date that the backend worked out and whether it is a Simulated Today, with a button
 * that opens the form. Open, it shows a date field that starts at the current Simulated Today, with
 * Save and Cancel. An empty date clears Simulated Today and returns to the date of the device, and
 * the form says so. The form is `settingsForm`; while it is submitting its controls are disabled.
 */
export function demoControlView(form: FormState, reference: ReferenceDataDto | null): RenderTree {
  const open = form.value !== 'closed' && form.context.kind === 'settingsForm';
  const today: RenderTree = { kind: 'text', text: `Today: ${reference?.today ?? '—'}`, tone: 'muted', icon: 'calendar' };
  const simulated: RenderTree[] = reference?.simulatedToday == null ? [] : [{ kind: 'text', text: 'Simulated', tone: 'warn' }];

  if (!open) {
    return {
      kind: 'box',
      layout: 'clock',
      children: [
        today,
        ...simulated,
        { kind: 'button', label: 'Set Simulated Today', tone: 'soft', icon: 'history', event: { ns: 'settings', name: 'open', payload: {} } },
      ],
    };
  }

  const submitting = form.value === 'submitting';
  const hint = form.context.hints.date;
  return {
    kind: 'box',
    layout: 'popover',
    children: [
      { kind: 'box', layout: 'row', children: [today, ...simulated] },
      {
        kind: 'input',
        label: 'Simulated Today',
        value: form.context.values.date ?? '',
        inputType: 'date',
        event: { ns: 'settings', name: 'edit', payload: { field: 'date' } },
        ...(hint === undefined ? {} : { hint }),
        disabled: submitting,
      },
      { kind: 'text', text: 'Leave it empty to use the date of this device.', tone: 'muted' },
      {
        kind: 'box',
        layout: 'actions',
        children: [
          {
            kind: 'button',
            label: submitting ? 'Saving…' : 'Save',
            tone: 'primary',
            event: { ns: 'settings', name: 'submit', payload: {} },
            disabled: submitting,
          },
          { kind: 'button', label: 'Cancel', tone: 'quiet', event: { ns: 'settings', name: 'cancel', payload: {} }, disabled: submitting },
        ],
      },
    ],
  };
}
