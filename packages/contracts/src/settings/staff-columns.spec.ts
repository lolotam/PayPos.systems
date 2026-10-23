import { expect, it } from 'vitest';

import { replaceStaffColumnsInput, staffColumnsSettings } from './staff-columns.js';

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

it('months back: any whole number reaches the domain, a fraction does not', () => {
  for (const months_back of [9007199254740992, -9007199254740992]) {
    expect(replaceStaffColumnsInput.safeParse({ columns: null, months_back }).success).toBe(true);
  }
  expect(replaceStaffColumnsInput.safeParse({ columns: null, months_back: 1.5 }).success).toBe(
    false,
  );
});

// المدى في الرد هو 1..12 (MY-Q9، D-A14)، فالرد اللي فيه قيمة برّه المدى بيرجع خطأ مش رد ناقص.
it('months_back in the GET response is a whole number from 1 to 12', () => {
  const base = {
    business_id: '01920000-0000-7000-8000-0000000000a1',
    columns: ['date'],
    columns_default: true,
    months_back_default: true,
  };
  for (const months_back of [1, 2, 12]) {
    expect(staffColumnsSettings.safeParse({ ...base, months_back }).success).toBe(true);
  }
  for (const months_back of [0, 13, 24]) {
    expect(staffColumnsSettings.safeParse({ ...base, months_back }).success).toBe(false);
  }
});
