import { sql } from 'drizzle-orm';
import type { LeaveHistoryContext } from './types.ts';
import type { HistoryScope } from './leave-history-days.sql.ts';
import { leaveListRecord } from './leave-list-record.sql.ts';

export function historyLeaveRecord(c: LeaveHistoryContext, s: HistoryScope) {
  // شاشة السجل تضيف هوية الموظف من غير تغيير عقد قائمة الطلبات.
  return sql`${leaveListRecord(c, s)} || jsonb_build_object('row_type','LEAVE','employee_number',subject.employee_number)`;
}
