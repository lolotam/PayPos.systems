import { expect, it } from 'vitest';
import {
  EMPLOYEE_DETAIL_TABS,
  EMPLOYEE_DETAIL_TAB_LABELS,
  employeeDetailHref,
  employeeDetailQueryTab,
} from './employee-detail-tabs';

it.each([
  ['pay', 'pay'],
  ['hours', 'hours'],
  ['documents', 'documents'],
  ['leave', 'data'],
  ['data', 'data'],
  ['PAY', 'data'],
  ['unknown', 'data'],
  ['', 'data'],
  [null, 'data'],
  [undefined, 'data'],
] as const)('reads ?tab=%s as the %s tab', (value, tab) => {
  expect(employeeDetailQueryTab(value)).toBe(tab);
});

it('addresses every tab, keeping the old Leave path', () => {
  expect(EMPLOYEE_DETAIL_TABS.map((tab) => employeeDetailHref('e1', tab))).toEqual([
    '/staff/e1',
    '/staff/e1?tab=pay',
    '/staff/e1?tab=hours',
    '/staff/e1?tab=documents',
    '/staff/e1/leave',
  ]);
});

it('encodes an identifier that is not a plain id and labels every tab', () => {
  expect(employeeDetailHref('a/b?c', 'pay')).toBe('/staff/a%2Fb%3Fc?tab=pay');
  expect(Object.keys(EMPLOYEE_DETAIL_TAB_LABELS)).toEqual([...EMPLOYEE_DETAIL_TABS]);
});
