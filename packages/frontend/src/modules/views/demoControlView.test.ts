import { describe, expect, it } from 'vitest';
import { CLOSED_FORM, REFERENCE, REFERENCE_SIMULATED, formOf } from '../../testing/fixtures';
import { eventsOf, findButton, nodesOf, problemsOf, renderText } from '../../testing/render';
import { formPrefillBuilder } from '../computation/formPrefillBuilder';
import { demoControlView } from './demoControlView';

const opened = (reference = REFERENCE, mode: 'editing' | 'submitting' = 'editing', hints = {}) =>
  formOf('settingsForm', formPrefillBuilder('settingsForm', {}, reference).values, {}, mode, hints);

describe('FU-03 DemoControlView', () => {
  describe('closed', () => {
    it('shows the date that the backend worked out, with a button that opens the form', () => {
      const tree = demoControlView(CLOSED_FORM, REFERENCE);

      expect(problemsOf(tree)).toEqual([]);
      expect(renderText(tree)).toContain('text: Today: 2026-10-02 (muted)');
      expect(findButton(tree, 'Set Simulated Today')?.event).toEqual({ ns: 'settings', name: 'open', payload: {} });
      expect(renderText(tree)).not.toContain('Simulated (warn)');
    });

    it('says when the date is a Simulated Today', () => {
      const text = renderText(demoControlView(CLOSED_FORM, REFERENCE_SIMULATED));

      expect(text).toContain('Today: 2026-10-05');
      expect(text).toContain('text: Simulated (warn)');
    });

    it('draws before the reference data has arrived, with a dash for the date', () => {
      const tree = demoControlView(CLOSED_FORM, null);

      expect(problemsOf(tree)).toEqual([]);
      expect(renderText(tree)).toContain('Today: —');
    });
  });

  describe('open', () => {
    it('shows a date field that starts at the current Simulated Today, with Save and Cancel', () => {
      const tree = demoControlView(opened(REFERENCE_SIMULATED), REFERENCE_SIMULATED);
      const input = nodesOf(tree).find((node) => node.kind === 'input');

      expect(problemsOf(tree)).toEqual([]);
      expect(input).toMatchObject({ label: 'Simulated Today', value: '2026-10-05', inputType: 'date', event: { ns: 'settings', name: 'edit', payload: { field: 'date' } } });
      expect(findButton(tree, 'Save')?.event).toEqual({ ns: 'settings', name: 'submit', payload: {} });
      expect(findButton(tree, 'Cancel')?.event).toEqual({ ns: 'settings', name: 'cancel', payload: {} });
    });

    it('starts empty when there is no Simulated Today, and says that empty means the date of the device', () => {
      const tree = demoControlView(opened(REFERENCE), REFERENCE);

      expect(nodesOf(tree).find((node) => node.kind === 'input')).toMatchObject({ value: '' });
      expect(renderText(tree)).toContain('Leave it empty to use the date of this device.');
    });

    it('shows the hint of the date field', () => {
      const tree = demoControlView(opened(REFERENCE, 'editing', { date: 'That date does not exist.' }), REFERENCE);

      expect(nodesOf(tree).find((node) => node.kind === 'input')).toMatchObject({ hint: 'That date does not exist.' });
    });

    it('disables the field and the buttons while the form is submitting', () => {
      const tree = demoControlView(opened(REFERENCE, 'submitting'), REFERENCE);

      expect(nodesOf(tree).find((node) => node.kind === 'input')).toMatchObject({ disabled: true });
      expect(findButton(tree, 'Saving…')).toMatchObject({ disabled: true });
      expect(findButton(tree, 'Cancel')).toMatchObject({ disabled: true });
    });

    it('sends every event to the settings namespace', () => {
      expect(new Set(eventsOf(demoControlView(opened(), REFERENCE)).map((event) => event.ns))).toEqual(new Set(['settings']));
    });

    it('stays closed for a form that is not the settings form', () => {
      const other = formOf('batchQty', { quantity: '1' });

      expect(renderText(demoControlView(other, REFERENCE))).toContain('Set Simulated Today');
    });
  });
});
