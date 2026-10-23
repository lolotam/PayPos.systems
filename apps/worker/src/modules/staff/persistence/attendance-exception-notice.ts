import type { Tx } from '@pospay/db';
import { inAppAlertRoles } from '../domain/alert-rule-plan.ts';
import {
  attendanceExceptionParameters,
  type AttendanceExceptionParameter,
} from '../domain/attendance-exception-notice.ts';
import type { NameFallback } from '../domain/not-clocked-in.ts';
import { withoutAbsentEmployee } from '../domain/not-clocked-in.ts';
import type { LockedMissedOutSession } from '../ports/missed-out.port.ts';
import { alertRules } from './alert-rule.adapter.ts';
import { branchManagerRecipientsAdapter } from './branch-manager-recipients.adapter.ts';
import { branchPlaceAdapter } from './branch-place.adapter.ts';

/** مستلمو جرس استثناء الحضور ومعاملاته كما تخرج من القواعد. */
export interface AttendanceExceptionRecipients {
  readonly userIds: readonly string[];
  readonly parameters: readonly AttendanceExceptionParameter[];
}

/**
 * من يصل جرس استثناء الحضور: مديرو فرع البصمة بالأدوار التي تختارها قاعدة نوع ATTENDANCE_EXCEPTION،
 * إلا الموظفة نفسها. والقاعدة المقفولة أو بلا قناة داخل التطبيق أو بلا مديرين معناها ولا جرس (issue #457).
 *
 * @param tx معاملة الشركة بعد قفل State
 * @param companyId الشركة
 * @param session الجلسة المقفولة
 * @param at لحظة القرار من الساعة المحقونة
 * @param fallback الأسماء العامة لجرس الاستثناء
 * @returns المستلمون ومعاملاتهم، أو null لما ما يجيش حد
 */
export async function attendanceExceptionRecipients(
  tx: Tx,
  companyId: string,
  session: LockedMissedOutSession,
  at: Date,
  fallback: NameFallback,
): Promise<AttendanceExceptionRecipients | null> {
  if (!(await branchManagerRecipientsAdapter.companyOpen(tx, companyId))) return null;
  const rule = await alertRules(tx).rule(
    companyId,
    { businessId: session.businessId, branchId: session.branchId },
    'ATTENDANCE_EXCEPTION',
  );
  const roles = inAppAlertRoles(rule);
  if (roles.length === 0) return null;
  const place = await branchPlaceAdapter.forBranch(
    tx,
    companyId,
    session.businessId,
    session.branchId,
  );
  if (place === null) return null;
  const managers = await branchManagerRecipientsAdapter.forBranch(
    tx,
    companyId,
    session.businessId,
    session.branchId,
    at,
    roles,
  );
  const userIds = withoutAbsentEmployee(managers, session.employeeUserId);
  if (userIds.length === 0) return null;
  const parameters = attendanceExceptionParameters(
    session.employeeNameAr,
    session.employeeNameEn,
    place.nameAr,
    place.nameEn,
    session.clockIn,
    session.timeZone,
    fallback,
  );
  if (parameters === null) return null;
  return { userIds, parameters };
}
