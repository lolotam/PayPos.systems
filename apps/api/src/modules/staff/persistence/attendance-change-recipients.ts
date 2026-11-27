import type { AttendanceChangeRequest } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import {
  needsTeamAlertContacts,
  type AlertChannel,
  type TeamAlertContact,
} from '@pospay/domain';
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

/** المستلمون وقنوات الإشعار وجهات اتصالهم اللي بتتكتب في حدث طلب تعديل الحضور أو قراره. */
export interface AttendanceChangeNotice {
  /** معرّفات المستلمين؛ الفرز وإزالة التكرار في attendanceChangeRecipientGroups. */
  readonly users: string[];
  /** قنوات الإشعار المفعّلة؛ فاضية = الحدث بلا إشعار. */
  readonly channels: readonly AlertChannel[];
  /** جهات الاتصال للإيميل والواتساب (AL-Q6)؛ فاضية لقاعدة جرس وحده. */
  readonly contacts: ReadonlyMap<string, TeamAlertContact>;
}

/**
 * بيحسب مستلمي الحدث وقناته من القاعدة الفعلية للنوع: المستلم الثابت (حازمو صلاحية القرار أو صاحب الطلب)
 * وأدوار القاعدة اللي بتزود مستلمين فوقيه. كل واحد بيتحسب لوحده: القاعدة اللي ما جابتش المستلم الثابت
 * ما بتقراش حازمين القرار، والقاعدة المقفولة ما بتقراش حاجة خالص، والحدث بيفضل موجود.
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
  const fixed = plan.fixed ? await fixedRecipients(tx, actor, row, now, employeeUserId) : [];
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
  const users = [...fixed, ...attendanceChangeRoleRecipients(holders, actor.userId, employeeUserId)];
  return {
    users,
    channels: plan.channels,
    contacts: await readContacts(tx, actor.companyId, users, plan.channels, now, alertRules),
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

/**
 * جهات اتصال المستلمين للإيميل والواتساب، وبس لما قناة خارجية مفعّلة ويكون في مستلمين.
 * غياب القارئ مع قناة خارجية خطأ تركيب ظاهر مش إيميل بيضيع في صمت.
 *
 * @param tx         معاملة الشركة
 * @param companyId  الشركة
 * @param users      المستلمين
 * @param channels   القنوات المفعّلة
 * @param now        لحظة سريان العضوية
 * @param alertRules بورت قواعد التنبيه
 * @returns جهة اتصال لكل مستخدم عنده وجهة صالحة
 */
async function readContacts(
  tx: Tx,
  companyId: string,
  users: readonly string[],
  channels: readonly AlertChannel[],
  now: Date,
  alertRules: AlertRulesPort,
): Promise<ReadonlyMap<string, TeamAlertContact>> {
  if (!needsTeamAlertContacts(channels) || users.length === 0) return new Map();
  if (alertRules.contacts === undefined) throw new Error('TEAM_ALERT_CONTACTS_UNAVAILABLE');
  return alertRules.contacts(tx, companyId, [...new Set(users)], now);
}
