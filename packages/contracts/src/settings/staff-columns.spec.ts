import { expect, it } from 'vitest';

import { replaceStaffColumnsInput } from './staff-columns.js';

// مفيش حد أقصى لطول مصفوفة الأعمدة: أي طول أكبر من قائمة الأكواد (11 كود) فيه أكواد غلط أو مكررة،
// والقرار لازم يبقى للدومين (422) مش للـ schema (400).
it('accepts a columns array of any length so the domain answers 422', () => {
  expect(
    replaceStaffColumnsInput.safeParse({
      columns: Array.from({ length: 33 }, () => 'date'),
      months_back: 5,
    }).success,
  ).toBe(true);
});

it('still accepts both values null to return them to their defaults', () => {
  expect(replaceStaffColumnsInput.safeParse({ columns: null, months_back: null }).success).toBe(
    true,
  );
});
