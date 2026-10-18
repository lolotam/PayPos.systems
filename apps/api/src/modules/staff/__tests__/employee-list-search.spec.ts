import { expect, it } from 'vitest';
import { employeeListSearch } from '../persistence/employee-list-search.ts';

it('trims the staff-list search once and parses digits from that same text', () => {
  expect(employeeListSearch(undefined)).toBeUndefined();
  expect(employeeListSearch('  Heba  ')).toEqual({ text: 'Heba', number: null });
  expect(employeeListSearch('0880007')).toEqual({ text: '0880007', number: 880007 });
  expect(employeeListSearch('007')).toEqual({ text: '007', number: 7 });
  expect(employeeListSearch('880041x')).toEqual({ text: '880041x', number: null });
});
