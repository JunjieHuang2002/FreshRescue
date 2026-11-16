import { describe, expect, it } from 'vitest';
import { ERROR_FAMILIES, ERROR_FAMILY_OF } from '@freshrescue/contract-errors';
import type { DomainError, ErrorCode } from '@freshrescue/contract-errors';
import { COMMAND_TYPES, QUERY_TYPES } from '@freshrescue/contract-messages';
import type { MessageType } from '@freshrescue/contract-messages';
import { SEVERITIES } from '@freshrescue/contract-ui';
import type { FieldError, FormErrorCode } from '@freshrescue/contract-ui';
import { errorNoticeMapper } from './errorNoticeMapper';

const CODES = Object.keys(ERROR_FAMILY_OF) as ErrorCode[];
const FORM_CODES = CODES.filter((code) => ERROR_FAMILY_OF[code] === 'form') as FormErrorCode[];

describe('FC-01 ErrorNoticeMapper', () => {
  describe('every one of the 58 codes has a notice', () => {
    it('walks the whole catalog: a severity from the contract, and text that says something', () => {
      expect(CODES).toHaveLength(58);
      expect(ERROR_FAMILIES).toHaveLength(5);

      for (const code of CODES) {
        const notice = errorNoticeMapper({ code }, null);

        expect(SEVERITIES, code).toContain(notice.severity);
        expect(notice.text.trim().length, code).toBeGreaterThan(8);
        expect(notice.fieldHints, code).toEqual({});
      }
    });

    it('gives each code a text of its own, so no two causes read the same', () => {
      const texts = CODES.map((code) => errorNoticeMapper({ code }, null).text);

      expect(new Set(texts).size).toBe(58);
    });

    it('does not show a person the name of a code that they can fix, and shows the name of a fault', () => {
      for (const code of CODES) {
        const notice = errorNoticeMapper({ code }, null);

        if (notice.severity === 'error') expect(notice.text, code).toContain(`(${code})`);
        else expect(notice.text, code).not.toContain(code);
      }
    });

    it('calls a fault of the server an error, and a value or a rule that the person can put right a warning', () => {
      for (const code of ['NETWORK_ERROR', 'TIMEOUT', 'BAD_JSON', 'BAD_RESPONSE', 'HTTP_STATUS', 'INVARIANT_BROKEN', 'STORE_WRITE_FAILED', 'CORRUPT_STORE'] as const) {
        expect(errorNoticeMapper({ code }, null).severity, code).toBe('error');
      }
      for (const code of ['NAME_EMPTY', 'CAP_EXCEEDED', 'PAST_EXPIRY', 'HAS_BATCHES', 'NAME_DUPLICATE', 'FIELD_REQUIRED', 'FOOD_TYPE_NOT_FOUND'] as const) {
        expect(errorNoticeMapper({ code }, null).severity, code).toBe('warning');
      }
    });

    it('puts the detail of a fault in its text, and leaves the detail of a value that can be fixed out', () => {
      const fault = errorNoticeMapper({ code: 'INVARIANT_BROKEN', detail: 'rule 7 is broken' }, null);
      const value = errorNoticeMapper({ code: 'QTY_NOT_POSITIVE', detail: 'a quantity is at least 1 thousandth (0.001), and this is 0' }, null);

      expect(fault.text).toContain('rule 7 is broken');
      expect(value.text).not.toContain('thousandth');
    });

    it('reads a code that is not in the catalog as an unreadable reply, and never fails', () => {
      const notice = errorNoticeMapper({ code: 'NOT_A_CODE' as ErrorCode }, { message: 'InboundBatch' });

      expect(notice.severity).toBe('error');
      expect(notice.text).toContain('expected shape');
    });
  });

  describe('the messages that the specification words out', () => {
    it('says "Remove all N batches first" for a Food Type that still has batches (exception 15)', () => {
      expect(errorNoticeMapper({ code: 'HAS_BATCHES' }, { message: 'DeleteFoodType', batchCount: 3 }).text).toBe('Remove all 3 batches first.');
      expect(errorNoticeMapper({ code: 'HAS_BATCHES' }, { batchCount: 12 }).text).toBe('Remove all 12 batches first.');
    });

    it('takes N from the detail that the backend sent, when the caller does not tell it', () => {
      expect(errorNoticeMapper({ code: 'HAS_BATCHES', detail: 'Remove all 3 batches first' }, null).text).toBe('Remove all 3 batches first.');
      expect(errorNoticeMapper({ code: 'HAS_BATCHES', detail: 'Remove all 25 batches first' }, { message: 'DeleteFoodType' }).text).toBe(
        'Remove all 25 batches first.',
      );
    });

    it('prefers the count that the caller knows, and says "the 1 batch" for a single batch', () => {
      expect(errorNoticeMapper({ code: 'HAS_BATCHES', detail: 'Remove all 3 batches first' }, { batchCount: 5 }).text).toBe('Remove all 5 batches first.');
      expect(errorNoticeMapper({ code: 'HAS_BATCHES' }, { batchCount: 1 }).text).toBe('Remove the 1 batch first.');
      expect(errorNoticeMapper({ code: 'HAS_BATCHES', detail: 'Remove the 1 batch first' }, null).text).toBe('Remove the 1 batch first.');
    });

    it('still asks for the batches to go first when no count is known', () => {
      expect(errorNoticeMapper({ code: 'HAS_BATCHES' }, null).text).toBe('Remove all batches first.');
      expect(errorNoticeMapper({ code: 'HAS_BATCHES', detail: 'no number here' }, { batchCount: 0 }).text).toBe('Remove all batches first.');
    });

    it('says that the name is empty for NAME_EMPTY (exception 3)', () => {
      expect(errorNoticeMapper({ code: 'NAME_EMPTY' }, null).text).toContain('name is empty');
    });

    it('names the 500,000 limit for CAP_EXCEEDED (exception 2) and the past date for PAST_EXPIRY (exception 1)', () => {
      expect(errorNoticeMapper({ code: 'CAP_EXCEEDED' }, null).text).toContain('500,000');
      expect(errorNoticeMapper({ code: 'PAST_EXPIRY' }, null).text).toContain('on or after today');
    });
  });

  describe('field hints for the codes of the backend', () => {
    it('points CAP_EXCEEDED at the quantity of an inbound and of a quantity edit, and says nothing about a field for a unit change', () => {
      for (const message of ['InboundBatch', 'EditBatchQuantity'] as const) {
        const notice = errorNoticeMapper({ code: 'CAP_EXCEEDED' }, { message });

        expect(Object.keys(notice.fieldHints)).toEqual(['quantity']);
        expect(notice.fieldHints.quantity).toBe(notice.text);
      }
      expect(errorNoticeMapper({ code: 'CAP_EXCEEDED' }, { message: 'ChangeFoodTypeUnit' }).fieldHints).toEqual({});
    });

    it('points a name error at the name field of the form that sent the message', () => {
      expect(Object.keys(errorNoticeMapper({ code: 'NAME_EMPTY' }, { message: 'InboundBatch' }).fieldHints)).toEqual(['foodName']);
      for (const message of ['SaveFoodType', 'SaveCategory', 'SaveRecipe'] as const) {
        expect(Object.keys(errorNoticeMapper({ code: 'NAME_DUPLICATE' }, { message }).fieldHints)).toEqual(['name']);
        expect(Object.keys(errorNoticeMapper({ code: 'NAME_TOO_LONG' }, { message }).fieldHints)).toEqual(['name']);
      }
    });

    it('points PAST_EXPIRY at both ends of the expiry, because the form shows only the one that was chosen', () => {
      expect(Object.keys(errorNoticeMapper({ code: 'PAST_EXPIRY' }, { message: 'InboundBatch' }).fieldHints).sort()).toEqual(['expiry.date', 'expiry.days']);
    });

    it('points each other code at its field', () => {
      const field = (code: ErrorCode, message: MessageType): string[] => Object.keys(errorNoticeMapper({ code }, { message }).fieldHints);

      expect(field('DAYS_INVALID', 'InboundBatch')).toEqual(['expiry.days']);
      expect(field('THRESHOLD_INVALID', 'SetCategoryThreshold')).toEqual(['thresholdDays']);
      expect(field('THRESHOLD_INVALID', 'SaveFoodType')).toEqual(['thresholdDays']);
      expect(field('UNIT_UNKNOWN', 'SaveFoodType')).toEqual(['unit']);
      expect(field('UNIT_UNCHANGED', 'ChangeFoodTypeUnit')).toEqual(['unit']);
      expect(field('DATE_INVALID', 'SetSimulatedToday')).toEqual(['date']);
      expect(field('NO_INGREDIENTS', 'SaveRecipe')).toEqual(['draft.rows']);
      expect(field('NAME_RESERVED', 'SaveCategory')).toEqual(['name']);
      expect(field('QTY_TOO_LARGE', 'EditBatchQuantity')).toEqual(['quantity']);
    });

    it('has no field for a message that the code does not belong to, for no context, and for a code that is about no field', () => {
      expect(errorNoticeMapper({ code: 'CAP_EXCEEDED' }, { message: 'SaveRecipe' }).fieldHints).toEqual({});
      expect(errorNoticeMapper({ code: 'CAP_EXCEEDED' }, null).fieldHints).toEqual({});
      expect(errorNoticeMapper({ code: 'CAP_EXCEEDED' }, { message: null }).fieldHints).toEqual({});
      expect(errorNoticeMapper({ code: 'NETWORK_ERROR' }, { message: 'InboundBatch' }).fieldHints).toEqual({});
      expect(errorNoticeMapper({ code: 'HAS_BATCHES' }, { message: 'DeleteFoodType' }).fieldHints).toEqual({});
    });

    it('can find a field for a message of every kind without failing', () => {
      for (const message of [...COMMAND_TYPES, ...QUERY_TYPES]) {
        for (const code of CODES) expect(() => errorNoticeMapper({ code }, { message })).not.toThrow();
      }
    });
  });

  describe('the field errors of a form', () => {
    it('turns each one into the hint of its field, and says that fields need attention', () => {
      const errors: readonly FieldError[] = [
        { field: 'quantity', code: 'QTY_DECIMALS' },
        { field: 'expiry.days', code: 'INT_FORMAT' },
        { field: 'draft.rows.1.unit', code: 'CHOICE_UNKNOWN' },
      ];

      const notice = errorNoticeMapper(errors, null);

      expect(notice.severity).toBe('warning');
      expect(notice.text).toContain('Some fields need attention');
      expect(notice.fieldHints).toEqual({
        quantity: errorNoticeMapper({ code: 'QTY_DECIMALS' }, null).text,
        'expiry.days': errorNoticeMapper({ code: 'INT_FORMAT' }, null).text,
        'draft.rows.1.unit': errorNoticeMapper({ code: 'CHOICE_UNKNOWN' }, null).text,
      });
    });

    it('has a hint for each of the six codes of a form', () => {
      expect(FORM_CODES).toHaveLength(6);

      for (const code of FORM_CODES) {
        const notice = errorNoticeMapper([{ field: 'quantity', code }], null);

        expect(notice.fieldHints.quantity, code).toBe(errorNoticeMapper({ code }, null).text);
        expect(notice.fieldHints.quantity?.length, code).toBeGreaterThan(8);
      }
    });

    it('words the hints that a person reads while typing a quantity', () => {
      const hint = (code: FormErrorCode): string => errorNoticeMapper([{ field: 'quantity', code }], null).fieldHints.quantity ?? '';

      expect(hint('QTY_FORMAT')).toContain('decimal point');
      expect(hint('QTY_DECIMALS')).toContain('3 decimal places');
      expect(hint('FIELD_REQUIRED')).toContain('required');
    });

    it('answers a list with no error as a notice with no hint', () => {
      expect(errorNoticeMapper([], null).fieldHints).toEqual({});
    });
  });

  it('does not change the error that it is given', () => {
    const error: DomainError = Object.freeze({ code: 'HAS_BATCHES', detail: 'Remove all 3 batches first' });
    const errors: readonly FieldError[] = Object.freeze([Object.freeze({ field: 'quantity', code: 'QTY_FORMAT' } as const)]);

    expect(() => errorNoticeMapper(error, Object.freeze({ message: 'DeleteFoodType' }))).not.toThrow();
    expect(() => errorNoticeMapper(errors, null)).not.toThrow();
  });
});
