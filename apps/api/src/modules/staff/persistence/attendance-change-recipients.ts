import type { AttendanceChangeRequest } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import {
  attendanceChangeAlertPlan,
  attendanceChangeRoleRecipients,
  type AttendanceChangeAlertKind,
} from '../domain/attendance-change-alert-rule.ts';
import {
  attendanceChangeRecipients,
  attendanceDecisionRecipients,
} from '../domain/attendance-change-request.ts';
import type { AttendanceChangeActor } from '../ports/attendance-change-transactions.port.ts';
import type { AlertRulesPort } from '../ports/alert-rules.port.ts';
import {
  attendanceChangeApprovers,
  attendanceChangeAuthority,
} from './attendance-change-context.adapter.ts';

/** المستلمون وقناة الإشعار اللي بتتكتب في حدث طلب تعديل الحضور أو قراره. */
export interface AttendanceChangeNotice {
  /** معرّفات المستلمين؛ الفرز وإزالة التكرار في attendanceChangeRecipientGroups. */
  readonly users: string[];
  /** قناة الإشعار؛ null = الحدث بلا إشعار. */
  readonly channel: 'IN_APP' | null;
}

/**
 * بيحسب مستلمي الحدث وقناته من القاعدة الفعلية للنوع: المستلم الثابت (حازمو صلاحية القرار أو صاحب الطلب)
 * وأدوار القاعدة اللي بتزود مستلمين فوقيه. القاعدة المقفولة ما بتقراش سلطة خالص، والحدث بيفضل موجود.
 *
 * @param tx              معاملة الشركة بتاعة المُرسِل
 * @param actor           الفاعل بتاع الحدث
 * @param row             صف الطلب المحفوظ
 * @param now             لحظة قراءة السلطة
 * @param employeeUserId  حساب الموظفة أو null
 * @param alertRules      بورت قواعد التنبيه
 * @returns المستلمون وقناة الإشعار
 */
export async function attendanceChangeNoticeRecipients(
  tx: Tx,
  actor: AttendanceChangeActor,
  row: AttendanceChangeRequest,
  now: Date,
  employeeUserId: string | null,
  alertRules: AlertRulesPort,
): Promise<AttendanceChangeNotice> {
  const kind: AttendanceChangeAlertKind =
    row.status === 'PENDING' ? 'ATTENDANCE_CHANGE_REQUESTED' : 'ATTENDANCE_CHANGE_DECIDED';
  const rule = await alertRules.rule(
    tx,
    actor.companyId,
    { businessId: row.business_id, branchId: row.branch_id },
    kind,
  );
  const plan = attendanceChangeAlertPlan(rule, kind);
  if (!plan.resolveRecipients) return { users: [], channel: plan.channel };
  const fixed = await fixedRecipients(tx, actor, row, now, employeeUserId);
  const holders =
    plan.roles.length === 0
      ? []
      : await alertRules.roleHolders(
          tx,
          actor.companyId,
          { businessId: row.business_id, branchId: row.branch_id },
          plan.roles,
          now,
        );
  return {
    users: [...fixed, ...attendanceChangeRoleRecipients(holders, actor.userId, employeeUserId)],
    channel: plan.channel,
  };
}

/**
 * المستلم الثابت للنوع: حازمو صلاحية القرار في طلب التعديل، وصاحب الطلب في قراره (ADR-0040).
 *
 * @param tx             معاملة الشركة
 * @param actor          الفاعل بتاع الحدث
 * @param row            صف الطلب المحفوظ
 * @param now            لحظة قراءة السلطة
 * @param employeeUserId حساب الموظفة أو null
 * @returns معرّفات المستلمين الثابتين
 */
async function fixedRecipients(
  tx: Tx,
  actor: AttendanceChangeActor,
  row: AttendanceChangeRequest,
  now: Date,
  employeeUserId: string | null,
): Promise<string[]> {
  if (row.status === 'PENDING')
    return attendanceChangeRecipients(
      await attendanceChangeApprovers(
        tx,
        actor.companyId,
        row.business_id,
        row.branch_id,
        now,
      ),
      actor.userId,
      employeeUserId,
    );
  if (row.requested_by === actor.userId) return [];
  const requester = await attendanceChangeAuthority(
    tx,
    actor.companyId,
    row.requested_by,
    row.business_id,
    row.branch_id,
    now,
  );
  return attendanceDecisionRecipients(
    { ...requester, userId: row.requested_by },
    actor.userId,
    employeeUserId,
  );
}
