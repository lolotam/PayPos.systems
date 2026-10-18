import { expect, it } from 'vitest';
import { withSavedNumber } from './company-numbers-saved-page';

const heba = {
  employee_id: '01920000-0000-7000-8000-0000000000d1',
  name_ar: null,
  name_en: 'Heba 12',
  business_id: '01920000-0000-7000-8000-0000000000d2',
  business_name_ar: null,
  business_name_en: 'Synthetic salon',
  employee_number: 4,
};
const sara = {
  ...heba,
  employee_id: '01920000-0000-7000-8000-0000000000d3',
  name_en: 'Sara',
  employee_number: 5,
};
const page = { items: [heba, sara], next_cursor: null };

it('updates the row on an unfiltered page and on a name search page', () => {
  expect(withSavedNumber(page, null, heba.employee_id, 7).items[0]?.employee_number).toBe(7);
  expect(withSavedNumber(page, 'Heba', heba.employee_id, 7).items[0]?.employee_number).toBe(7);
});

it('keeps the row on a digit search that still matches the new number or the name', () => {
  expect(
    withSavedNumber(page, '007', heba.employee_id, 7).items.map((item) => item.employee_number),
  ).toEqual([7, 5]);
  expect(
    withSavedNumber(page, '12', heba.employee_id, 7).items.map((item) => item.employee_number),
  ).toEqual([7, 5]);
});

it('drops the row from a digit search it no longer matches and leaves other rows alone', () => {
  expect(withSavedNumber(page, '4', heba.employee_id, 7).items).toEqual([sara]);
});
