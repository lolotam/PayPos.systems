import type { IdGenerator } from '@pospay/db';
import type postgres from 'postgres';
import type { NoticeWrite, NotClockedInTransactions } from '../ports/not-clocked-in.port.ts';

/** أدوات مشتركة لاختباري قواعد التنبيه: الكتابة كلها عبر اتصال المالك. */
export interface RuleContext {
  readonly owner: postgres.Sql;
  readonly ids: IdGenerator;
  readonly userId: string;
}

/** نطاق القاعدة: النشاط، والفرع اللي بيغيّر قاعدته (null = قاعدة النشاط). */
export interface RuleTarget {
  readonly company: string;
  readonly business: string;
  readonly branchId?: string | null;
}

/** الأدوار الأربعة اللي في الافتراضي. */
export const MANAGER_ROLES = ['owner', 'general_manager', 'business_manager', 'branch_manager'];

/** يحفظ قاعدة نوع واحد: فرع null = قاعدة النشاط. */
export async function saveRule(
  context: RuleContext,
  target: RuleTarget,
  kind: string,
  values: {
    enabled: boolean;
    roles: readonly string[];
    delayMinutes?: number | null;
    leadMinutes?: number | null;
    channels?: readonly string[];
  },
): Promise<void> {
  // 1009 هو OID ‎_text؛ بتمريره صريحًا تبقى المصفوفة الفاضية نصًا صحيحًا مش سلسلة فاضية.
  const channels = values.channels ?? ['IN_APP'];
  await context.owner`INSERT INTO alert_rules (company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,
      delay_minutes,lead_minutes,updated_by,revision)
    VALUES(${target.company},${context.ids.newId()},${target.business},${target.branchId ?? null},${kind},
      ${values.enabled},${context.owner.array([...values.roles], 1009)},${context.owner.array([...channels], 1009)},
      ${values.delayMinutes ?? null},${values.leadMinutes ?? null},${context.userId},1)`;
}

/** يمسح قواعد النوع في النطاق ده: الفرع يرجع لقاعدة النشاط. */
export async function clearRules(
  context: RuleContext,
  target: RuleTarget,
  kind: string,
): Promise<void> {
  await context.owner`DELETE FROM alert_rules
    WHERE company_id=${target.company} AND business_id=${target.business} AND kind=${kind}
      AND branch_id IS NOT DISTINCT FROM ${target.branchId ?? null}`;
}

/** المفتاح العام للنشاط: null = شغّال. */
export async function setMaster(
  context: RuleContext,
  target: RuleTarget,
  enabled: boolean | null,
): Promise<void> {
  await context.owner`INSERT INTO business_settings (company_id,business_id,alerts_enabled)
    VALUES(${target.company},${target.business},${enabled})
    ON CONFLICT (company_id,business_id) DO UPDATE SET alerts_enabled=${enabled}`;
}

/** سطور دفتر عدم الحضور: المستلمون وعلامة الكبح. */
export async function notClockedInLedger(context: RuleContext, company: string, employeeId: string) {
  return context.owner`SELECT id, recipient_count, suppressed_at, notified_at, shift_starts_at, alert_due_at
    FROM attendance_not_clocked_in_notices
    WHERE company_id=${company} AND employee_id=${employeeId} ORDER BY shift_starts_at`;
}

/** سطور دفتر عدم الرجوع من البريك: المستلمون وعلامة الكبح ونوعه. */
export async function breakLedger(context: RuleContext, company: string, employeeId: string) {
  return context.owner`SELECT id, recipient_count, suppressed_at, suppressed_kind, notified_at, shift_starts_at, break_ends_at, alert_due_at
    FROM attendance_break_not_returned_notices
    WHERE company_id=${company} AND employee_id=${employeeId} ORDER BY shift_starts_at`;
}

/** أحداث الأوتبوكس لنوع واحد. */
export async function outboxRows(context: RuleContext, company: string, eventType: string) {
  return context.owner`SELECT id, payload FROM outbox
    WHERE company_id=${company} AND event_type=${eventType} ORDER BY seq`;
}

/** سطور التدقيق كلها للنشاط. */
export async function auditRows(context: RuleContext, company: string) {
  return context.owner`SELECT id, entity, entity_id, action, after FROM audit_log
    WHERE company_id=${company} ORDER BY at, id`;
}

/** مستخدمو جرس الحدث الواحد. */
export function eventRecipients(row: postgres.Row | undefined) {
  const payload = row?.['payload'] as { notification_recipients?: { user_id: string }[] };
  return (payload.notification_recipients ?? []).map((item) => item.user_id);
}

/** قالب الجرس ومعاملاته كما هما في الحدث. */
export function eventBell(row: postgres.Row | undefined) {
  const payload = row?.['payload'] as
    | {
        notification_recipients?: {
          template_key: string;
          template_revision: number;
          locale: string;
          safe_parameters: { name: string; type: string; value: string }[];
        }[];
      }
    | undefined;
  return payload?.notification_recipients?.[0] ?? null;
}

/** سطور استثناءات الحضور للشركة. */
export async function attendanceExceptions(context: RuleContext, company: string) {
  return context.owner`SELECT id, kind, status, session_id FROM attendance_exceptions
    WHERE company_id=${company} ORDER BY id`;
}

/** سطور دفتر انتهاء المستندات: العلامة ووقت الإشعار. */
export async function documentExpiryLedger(context: RuleContext, company: string) {
  return context.owner`SELECT document_id, expires_on, notified_at, recipients_attached_at
    FROM employee_document_expiry_notices WHERE company_id=${company} ORDER BY id`;
}

/** يشوف الكتابة في الدفتر من غير ما يمسّ المعاملة. */
export function spyOnRecord(
  transactions: NotClockedInTransactions,
  written: NoticeWrite[],
): NotClockedInTransactions {
  return {
    candidates: transactions.candidates,
    run: (company, employeeId, sample, work) =>
      transactions.run(company, employeeId, sample, async (tx, at) =>
        work({ ...tx, record: async (notice) => {
          written.push(notice);
          return tx.record(notice);
        } }, at),
      ),
  };
}
