import { expect, it, describe } from 'vitest';

import {
  serviceImportDuplicateRows,
  serviceImportNameKey,
} from '../service-import-duplicates.ts';
import vectors from './service-import-key-vectors.json' with { type: 'json' };

describe('serviceImportNameKey (A-9)', () => {
  it.each(vectors.same_key as unknown as readonly [string, string][])(
    'gives %s and %s one key through the shared category normalizer',
    (first, second) => {
      expect(serviceImportNameKey(first)).toBe(serviceImportNameKey(second));
    },
  );

  it.each(vectors.different_keys as unknown as readonly [string, string][])(
    'keeps %s and %s on two keys with no Unicode folding',
    (first, second) => {
      expect(serviceImportNameKey(first)).not.toBe(serviceImportNameKey(second));
    },
  );
});

describe('serviceImportDuplicateRows (A-10)', () => {
  const keyed = (rows: readonly (readonly [number, string])[]) =>
    rows.map(([row, key]) => ({ row, key }));

  it('flags two rows sharing one key', () => {
    expect(serviceImportDuplicateRows(keyed([[2, 'hair cut'], [3, 'hair cut']]))).toEqual([2, 3]);
  });

  it('flags all three rows of one key group in sheet order', () => {
    expect(
      serviceImportDuplicateRows(keyed([[5, 'spa'], [6, 'nails'], [7, 'spa'], [8, 'spa']])),
    ).toEqual([5, 7, 8]);
  });

  it('collapses case and whitespace variants into one key group', () => {
    // الفحص المباشر بياخد المفاتيح الجاهزة؛ التطبيع نفسه بتغطيه اختبارات serviceImportNameKey فوق.
    expect(
      serviceImportDuplicateRows(
        keyed([
          [2, serviceImportNameKey('Hair Cut')],
          [3, serviceImportNameKey('hair  CUT')],
          [4, serviceImportNameKey('  hair cut ')],
        ]),
      ),
    ).toEqual([2, 3, 4]);
  });

  it('treats the same name under different categories as one duplicate group', () => {
    expect(serviceImportDuplicateRows(keyed([[2, 'hair cut'], [3, 'hair cut']]))).toEqual([2, 3]);
  });

  it('keeps distinct names and single rows out of the result', () => {
    expect(
      serviceImportDuplicateRows(keyed([[2, 'hair cut'], [3, 'nails'], [4, 'spa']])),
    ).toEqual([]);
    expect(serviceImportDuplicateRows(keyed([[2, 'hair cut']]))).toEqual([]);
  });

  it('includes a row whose other columns are wrong, as long as its name is valid', () => {
    // الصف 3 سعره غلط لكن اسمه سليم، فمفتاحه موجود وهو فرد في مجموعة التكرار (A-10).
    expect(
      serviceImportDuplicateRows(keyed([[2, 'hair cut'], [3, 'hair cut'], [4, 'nails']])),
    ).toEqual([2, 3]);
  });
});
