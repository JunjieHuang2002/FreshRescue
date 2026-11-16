import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Brand, DateISO, Empty, Id, Named, QtyMilli, Result, ValidName, ValidQty, ValidThreshold, ValidUnit } from './index';

// The `expectTypeOf` assertions are checked by `tsc` (npm run typecheck) and by nothing else:
// Vitest treats them as no-ops at run time.

describe('primitives', () => {
  it('keeps ids, dates and quantities as plain values', () => {
    expectTypeOf<Id>().toEqualTypeOf<number>();
    expectTypeOf<QtyMilli>().toEqualTypeOf<number>();
    expectTypeOf<DateISO>().toEqualTypeOf<string>();
    expectTypeOf<Named>().toEqualTypeOf<{ readonly id: Id; readonly name: string }>();
    expectTypeOf<Empty>().toEqualTypeOf<Readonly<Record<string, never>>>();

    const milk: Named = { id: 3, name: 'Milk' };
    const nothing: Empty = {};
    expect(milk).toEqual({ id: 3, name: 'Milk' });
    expect(nothing).toEqual({});
  });

  it('writes a Result as a tagged union that narrows on ok', () => {
    const read = (result: Result<number, string>): string | number => (result.ok ? result.value : result.err);
    const good: Result<number, string> = { ok: true, value: 7 };
    const bad: Result<number, string> = { ok: false, err: 'nope' };

    expect(read(good)).toBe(7);
    expect(read(bad)).toBe('nope');
    expectTypeOf<Result<number, string>>().toEqualTypeOf<
      { readonly ok: true; readonly value: number } | { readonly ok: false; readonly err: string }
    >();
  });

  it('brands validated values so that a plain value cannot stand in for one', () => {
    expectTypeOf<ValidName>().toExtend<string>();
    expectTypeOf<ValidQty>().toExtend<number>();
    expectTypeOf<string>().not.toExtend<ValidName>();
    expectTypeOf<number>().not.toExtend<ValidQty>();
    expectTypeOf<ValidName>().not.toEqualTypeOf<ValidUnit>();
    expectTypeOf<ValidQty>().not.toEqualTypeOf<ValidThreshold>();
    expectTypeOf<Brand<string, 'A'>>().not.toEqualTypeOf<Brand<string, 'B'>>();

    // a brand adds nothing at run time: a validator hands out the plain value
    const name = 'Milk' as ValidName;
    expect(name.length).toBe(4);
  });
});
