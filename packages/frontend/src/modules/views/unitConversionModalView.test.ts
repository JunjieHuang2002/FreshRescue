import { describe, expect, it } from 'vitest';
import type { FormValues } from '@freshrescue/contract-ui';
import type { FoodTypeDetailDto } from '@freshrescue/contract-views';
import { CLOSED_FORM, DETAIL_CHICKEN, DETAIL_EMPTY, REFERENCE, formOf } from '../../testing/fixtures';
import { editedFieldsOf, findButton, nodesOf, problemsOf, renderText } from '../../testing/render';
import { formPrefillBuilder } from '../computation/formPrefillBuilder';
import { unitConversionModalView } from './unitConversionModalView';

// Chicken: 100 g and 200 g, the example of spec 4.2.2
const CHICKEN = DETAIL_CHICKEN;

const modal = (typed: FormValues = {}, mode: 'editing' | 'submitting' = 'editing', foodType: FoodTypeDetailDto = CHICKEN, hints = {}) => {
  const { values, options } = formPrefillBuilder('unitChange', { foodType }, REFERENCE);
  return unitConversionModalView(formOf('unitChange', { ...values, ...typed }, options, mode, hints));
};

const FILLED: FormValues = { unit: 'pieces', 'batches.0.quantity': '0.5', 'batches.1.quantity': '1' };

describe('FU-08 UnitConversionModalView', () => {
  it('draws nothing for a form that is closed, and for a form that another view draws', () => {
    expect(unitConversionModalView(CLOSED_FORM)).toEqual({ kind: 'box', layout: 'stack', children: [] });
    expect(unitConversionModalView(formOf('batchAdd', {}))).toEqual({ kind: 'box', layout: 'stack', children: [] });
  });

  it('asks for the new unit and for the new quantity of every batch, each labelled with what it holds now (spec 4.2.2)', () => {
    const tree = modal();
    const text = renderText(tree);

    expect(problemsOf(tree)).toEqual([]);
    expect(text).toContain('text: Change unit of Chicken (title)');
    expect(text).toContain('text: Now in grams. (muted)');
    expect(text).toContain('input 100 grams, expires 2026-10-04: ');
    expect(text).toContain('input 200 grams, expires 2026-10-09: ');
  });

  it('offers the other five units for the new unit, never the one that it has', () => {
    const unit = nodesOf(modal()).find((node) => node.kind === 'select');

    expect(unit?.kind === 'select' ? unit.choices.map((choice) => choice.value) : []).toEqual(['', 'kg', 'ml', 'liters', 'pieces', 'cartons']);
  });

  it('asks for a field for every batch, whatever its status: an Expired batch is in the list too', () => {
    const rows = nodesOf(modal()).filter((node) => node.kind === 'input');

    expect(rows).toHaveLength(2);
    expect(editedFieldsOf(modal())).toEqual(['unit', 'batches.0.quantity', 'batches.1.quantity']);
  });

  describe('Save stays disabled until every field is valid', () => {
    const saveOf = (typed: FormValues) => findButton(modal(typed), 'Save');

    it('is disabled when nothing is filled in', () => {
      expect(saveOf({})).toMatchObject({ disabled: true });
    });

    it('is disabled while the unit is not chosen, or one quantity is missing', () => {
      expect(saveOf({ 'batches.0.quantity': '0.5', 'batches.1.quantity': '1' })).toMatchObject({ disabled: true });
      expect(saveOf({ unit: 'pieces', 'batches.0.quantity': '0.5' })).toMatchObject({ disabled: true });
      expect(saveOf({ unit: 'pieces', 'batches.0.quantity': '0.5', 'batches.1.quantity': '   ' })).toMatchObject({ disabled: true });
    });

    it('is disabled for a quantity that is not valid: text, zero, too many decimals, a sign, more than 500,000', () => {
      for (const bad of ['abc', '0', '0.000', '-1', '1,5', '1e3', '1.2345', '500000.001', '600000', '.', '1.2.3']) {
        expect(saveOf({ ...FILLED, 'batches.1.quantity': bad }), bad).toMatchObject({ disabled: true });
      }
    });

    it('is enabled when the unit is chosen and every quantity is valid', () => {
      expect(saveOf(FILLED)).toMatchObject({ disabled: false });
      expect(saveOf({ ...FILLED, 'batches.0.quantity': '0.001', 'batches.1.quantity': '500000' })).toMatchObject({ disabled: false });
      expect(saveOf({ ...FILLED, 'batches.0.quantity': ' .5 ', 'batches.1.quantity': '5.' })).toMatchObject({ disabled: false });
    });

    it('sends the submit event to the unitConversion namespace', () => {
      expect(saveOf(FILLED)?.event).toEqual({ ns: 'unitConversion', name: 'submit', payload: {} });
    });
  });

  it('asks only for the unit when the Food Type has no batch', () => {
    const tree = modal({ unit: 'kg' }, 'editing', DETAIL_EMPTY);

    expect(nodesOf(tree).filter((node) => node.kind === 'input')).toHaveLength(0);
    expect(renderText(tree)).not.toContain('Enter the quantity of every batch');
    expect(findButton(tree, 'Save')).toMatchObject({ disabled: false });
    expect(findButton(modal({}, 'editing', DETAIL_EMPTY), 'Save')).toMatchObject({ disabled: true });
  });

  it('puts the hints beside the fields, by batch', () => {
    const tree = modal(FILLED, 'editing', CHICKEN, { 'batches.1.quantity': 'Use at most 3 decimal places.', unit: 'Choose one of the units in the list.' });
    const text = renderText(tree);

    expect(text).toContain('input 200 grams, expires 2026-10-09: 1 [Use at most 3 decimal places.]');
    expect(text).toContain('[Choose one of the units in the list.]');
  });

  it('can be cancelled, and cannot be while it is submitting', () => {
    expect(findButton(modal(), 'Cancel')).toMatchObject({ event: { ns: 'unitConversion', name: 'cancel', payload: {} }, disabled: false });

    const submitting = modal(FILLED, 'submitting');

    expect(findButton(submitting, 'Saving…')).toMatchObject({ disabled: true });
    expect(findButton(submitting, 'Cancel')).toMatchObject({ disabled: true });
    for (const node of nodesOf(submitting)) {
      if (node.kind === 'input' || node.kind === 'select') expect(node.disabled).toBe(true);
    }
  });
});
