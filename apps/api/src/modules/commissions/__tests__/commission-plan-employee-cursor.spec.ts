import {
  COMMISSION_PLAN_EMPLOYEE_CURSOR_MAX,
  commissionPlanEmployeeList,
  commissionPlanEmployeeListQuery,
} from '@pospay/contracts';
import { employeeNameMatchKey } from '@pospay/domain';
import { expect, it } from 'vitest';

import {
  decodeCommissionPlanEmployeeCursor,
  encodeCommissionPlanEmployeeCursor,
} from '../queries/commission-plan-employee-cursor.ts';

const context = {
  companyId: '01920000-0000-7000-8000-000000000401',
  businessId: '01920000-0000-7000-8000-000000000402',
};
const employeeId = '01920000-0000-7000-8000-0000000004ab';

// المؤشر بيحمل المفتاح المخزّن نفسه، فطوله تابع لأطول مفتاح يطلع من اسم 255 code unit.
// U+FDFA بيتفك بـ NFKC لـ 18 حرف: أكبر توسّع لنقطة واحدة في مسح كل نقاط Unicode، ومؤشره 11411 حرف.
it.each([
  ['ASCII', 'a'.repeat(255), 531],
  ['Arabic', 'س'.repeat(255), 871],
  ['CJK', '汉'.repeat(255), 1211],
  ['non-BMP', '😀'.repeat(127), 868],
  ['U+FDFA', 'ﷺ'.repeat(255), 11_411],
])('a %s name of the longest length round-trips under the cap', (_label, name, length) => {
  const key = employeeNameMatchKey(name);
  const cursor = encodeCommissionPlanEmployeeCursor(context, { key, id: employeeId });
  expect(cursor).toHaveLength(length);
  expect(cursor.length).toBeLessThanOrEqual(COMMISSION_PLAN_EMPLOYEE_CURSOR_MAX);
  expect(decodeCommissionPlanEmployeeCursor(cursor, context)).toEqual({
    kind: 'valid',
    after: { key, id: employeeId },
  });
  expect(commissionPlanEmployeeListQuery.safeParse({ cursor }).success).toBe(true);
  const page = { time_zone: 'Asia/Kuwait', items: [], next_cursor: cursor };
  expect(commissionPlanEmployeeList.safeParse(page).success).toBe(true);
});

it('a cursor one character past the cap is refused before it is decoded', () => {
  const valid = encodeCommissionPlanEmployeeCursor(context, { key: 'sara', id: employeeId });
  const oversized = valid.padEnd(COMMISSION_PLAN_EMPLOYEE_CURSOR_MAX + 1, 'A');
  expect(decodeCommissionPlanEmployeeCursor(oversized, context)).toEqual({ kind: 'invalid' });
  expect(commissionPlanEmployeeListQuery.safeParse({ cursor: oversized }).success).toBe(false);
});

const { companyId: c, businessId: b } = context;
const raw = (json: string) => Buffer.from(json, 'utf8').toString('base64url');

// كل شكل هنا بيعدّي فك الـ JSON، وبيترفض لأنه مش المؤشر اللي السيرفر كان هيصدره بالظبط.
it.each([
  ['the id-only form of the first release', JSON.stringify({ v: 1, c, b, i: employeeId })],
  ['a NUL inside the key', JSON.stringify({ v: 1, c, b, k: 'sa\u0000ra', i: employeeId })],
  [
    'an upper-case employee id',
    JSON.stringify({ v: 1, c, b, k: 'sara', i: employeeId.toUpperCase() }),
  ],
  ['reordered keys', JSON.stringify({ v: 1, c, b, i: employeeId, k: 'sara' })],
  ['an extra key', JSON.stringify({ v: 1, c, b, k: 'sara', i: employeeId, x: 1 })],
  ['a duplicated key', `{"v":1,"c":"${c}","b":"${b}","k":"sara","i":"${employeeId}","i":"${c}"}`],
  ['an escaped key', `{"v":1,"c":"${c}","b":"${b}","k":"\\u0073ara","i":"${employeeId}"}`],
  ['another business', JSON.stringify({ v: 1, c, b: employeeId, k: 'sara', i: employeeId })],
  ['another version', JSON.stringify({ v: 2, c, b, k: 'sara', i: employeeId })],
])('%s is refused', (_label, json) => {
  expect(decodeCommissionPlanEmployeeCursor(raw(json), context)).toEqual({ kind: 'invalid' });
});

it('the encoder keeps the stored key byte for byte', () => {
  const key = '  Sara\tAli ';
  const cursor = encodeCommissionPlanEmployeeCursor(context, { key, id: employeeId });
  expect(decodeCommissionPlanEmployeeCursor(cursor, context)).toEqual({
    kind: 'valid',
    after: { key, id: employeeId },
  });
});
