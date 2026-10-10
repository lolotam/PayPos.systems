// صلاحيات PR 22 المقصودة؛ لا حذف للحضور ولا إعادة كتابة لسياق التحدي.
import type { Sql } from 'postgres';
import { expect, it } from 'vitest';

export const ATTENDANCE_TABLE_GRANTS = [
  'attendance_states:SELECT',
  'attendance_states:INSERT',
  'attendance_states:UPDATE',
  'attendance_sessions:SELECT',
  'attendance_sessions:INSERT',
  'attendance_sessions:UPDATE',
  'attendance_exceptions:SELECT',
  'attendance_exceptions:INSERT',
  'attendance_exceptions:UPDATE',
  'attendance_clock_challenges:SELECT',
  'attendance_clock_challenges:INSERT',
  'attendance_corrections:SELECT',
  'attendance_corrections:INSERT',
  // بند 21b: محاولات الرفض لا تُعدل ولا تُحذف.
  'attendance_device_refusals:SELECT',
  'attendance_device_refusals:INSERT',
  'attendance_change_requests:INSERT',
  'attendance_change_requests:SELECT',
  'attendance_device_signals:INSERT',
  'attendance_device_signals:SELECT',
  'attendance_not_clocked_in_notices:INSERT',
  'attendance_not_clocked_in_notices:SELECT',
].sort();

export const ATTENDANCE_CHANGE_COLUMN_GRANTS = [
  'status',
  'decided_by',
  'decided_at',
  'decision_reason',
  'cancelled_by',
  'cancelled_at',
  'session_id',
  'revision',
].map((column) => `attendance_change_requests.${column}:pospay_app:UPDATE`);

export function testAttendanceDecisionPrivileges(database: () => Sql) {
  it('attendance decision migration grants only the global owner default', async () => {
    const owner = database();
    const rows = await owner`SELECT r.code FROM role_permissions rp JOIN roles r
      ON r.id=rp.role_id AND r.owner_key=rp.role_owner_key
      WHERE rp.permission_code='decide:attendance-change:company'
        AND rp.role_owner_key='global' AND rp.company_id IS NULL ORDER BY r.code`;
    expect(rows.map((row) => row['code'])).toEqual(['owner']);
  });
}
