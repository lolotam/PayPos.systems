import { expect, it } from 'vitest';
import { attendanceMonthlyReportQuery } from './attendance-monthly-report.js';

it('report query carries only a calendar month; branch and business are route parameters', () => {
  expect(attendanceMonthlyReportQuery.parse({ month: '2026-10' })).toEqual({ month: '2026-10' });
});
it.each(['2026-1', '2026-00', '2026-13', '0000-10', '2026-10-01', '2026-10 '])('rejects invalid month %s', (month) => {
  expect(attendanceMonthlyReportQuery.safeParse({ month }).success).toBe(false);
});
it.each(['branch_id', 'business_id', 'company_id', 'permission'])('does not accept query scope or claims: %s', (key) => {
  expect(attendanceMonthlyReportQuery.safeParse({ month: '2026-10', [key]: 'all' }).success).toBe(false);
});
