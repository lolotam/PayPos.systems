import {
  businessLocalMoment,
  previousPeriod,
  reminderDate,
  reminderDayFor,
} from '../../domain/statement-reminder-date.ts';
import type {
  ReminderLedgerKind,
  StatementReminderScope,
  StatementReminderTransactions,
} from '../../ports/statement-reminder.port.ts';
import type { Clock } from '../../ports/commission-line-projection.port.ts';

/** مفتاح الاعتماد الصريح للشركة: الاعتماد المقفول يخلّي المطالبة بلا معنى (ADR-0054 §9). */
const APPROVAL_SWITCH_FLAG = 'commission_statement_approval';

/** كل ما حالة التذكير تحتاجه: حد المعاملة والساعة. */
export interface RemindCommissionStatementsDeps {
  readonly transactions: StatementReminderTransactions;
  readonly clock: Clock;
}

/** نتيجة تشغيل التذكيرات لشركة واحدة: كم نشاط وكم سطر دفتر اتكتب. */
export interface RemindCommissionStatementsResult {
  readonly businesses: number;
  readonly reminders: number;
}

/**
 * مهمة تذكير كشف العمولة لكل شركة (FR-053، FR-055، CM-57، CM-58):
 * تقرأ أنشطة الشركة مع مناطقها الزمنية، وتشغّل لكل نشاط مستحق التذكير
 * (اليوم الثالث أو الخامس بعد التاسعة بالتوقيت المحلي) على الشهر السابق.
 *
 * لكل نشاط في معاملة واحدة: ميزة العمولات تُقرأ الأول، ولو مقفولة تنتهي المعاملة
 * من غير أي كتابة (CM-57). بعدين يُقفل كشف الشهر (وبالتالي ينشئ لو النشاط هادي)،
 * وتُقرأ حالته تحت القفل، والمغلق ما بياخدش تذكير.
 *
 * @param deps حد المعاملة والساعة
 * @param companyId الشركة المجدولة
 * @returns نتيجة التشغيل
 */
export async function remindCommissionStatements(
  deps: RemindCommissionStatementsDeps,
  companyId: string,
): Promise<RemindCommissionStatementsResult> {
  const businesses = await deps.transactions.businesses(companyId);
  let reminders = 0;
  for (const business of businesses) {
    const local = businessLocalMoment(deps.clock.now(), business.timeZone);
    const day = reminderDayFor(local);
    if (day === null) continue;
    const period = previousPeriod(local.year, local.month);
    const date = reminderDate(local);
    const written = await deps.transactions.run(companyId, (scope) =>
      remindBusiness(scope, business.id, period, date, day),
    );
    reminders += written;
  }
  return { businesses: businesses.length, reminders };
}

/**
 * تذكير نشاط واحد داخل معاملة الشركة: قفل الشهر، ثم تذكير الاعتماد، ثم تذكير المراجعة.
 *
 * @param scope      نطاق العمل على معاملة الشركة
 * @param businessId النشاط
 * @param period     الشهر السابق
 * @param date       تاريخ التذكير
 * @param day        يوم التذكير (3 أو 5)
 * @returns عدد سطور الدفتر المكتوبة
 */
async function remindBusiness(
  scope: StatementReminderScope,
  businessId: string,
  period: string,
  date: string,
  day: 3 | 5,
): Promise<number> {
  if (!(await scope.featureEnabled())) return 0;
  const statement = await scope.lockPeriod(businessId, period);
  if (statement === null) return 0;
  if (statement.status === 'APPROVED' || statement.status === 'PAID') return 0;
  let written = 0;
  if (statement.status === 'DRAFT' || statement.status === 'REVIEWED') {
    written += await emitApprovalReminder(scope, businessId, statement.statementId, period, date, day);
  }
  if (day === 3 && statement.status === 'DRAFT') {
    written += await emitReviewReminder(scope, businessId, statement.statementId, period, date);
  }
  return written;
}

/**
 * تذكير الاعتماد: قاعدة التنبيه لازم تكون مفعّلة بقناة الجرس، ومفتاح الاعتماد الصريح لازم
 * يكون مفتوحًا (53-2-B2a-FR030-1)، والمستلمون هم أصحاب صلاحية الاعتماد القارئين للنشاط كله.
 *
 * @param scope       نطاق العمل على معاملة الشركة
 * @param businessId  النشاط
 * @param statementId الكشف المقفول
 * @param period      الشهر السابق
 * @param date        تاريخ التذكير
 * @param day         يوم التذكير (3 أو 5)
 * @returns عدد سطور الدفتر المكتوبة
 */
async function emitApprovalReminder(
  scope: StatementReminderScope,
  businessId: string,
  statementId: string,
  period: string,
  date: string,
  day: 3 | 5,
): Promise<number> {
  const rule = await scope.alertRule(businessId, 'STATEMENT_AWAITING_APPROVAL');
  if (!rule.enabled || !rule.channels.includes('IN_APP')) return 0;
  const decisionAt = await scope.decisionTime();
  if (!(await scope.switchEnabled(APPROVAL_SWITCH_FLAG, decisionAt))) return 0;
  const recipients = await scope.recipients(businessId, 'approve:commissions:business', decisionAt);
  const kind: ReminderLedgerKind = day === 3 ? 'APPROVAL_DAY3' : 'APPROVAL_DAY5';
  const inserted = await scope.insertLedger({
    businessId,
    statementId,
    kind,
    reminderDate: date,
    recipientCount: recipients.length,
  });
  if (!inserted) return 0;
  // صفر مستلمين قرار دائم: السطر مكتوب وبيقول «اتبعت ومحدش»، فالتشغيل التاني ما بيعيدش.
  if (recipients.length === 0) return 1;
  await scope.appendNoticeEvents({
    statementId,
    businessId,
    period,
    recipients,
    templateKey: 'statement_awaiting_approval',
  });
  return 1;
}

/**
 * تذكير المراجعة: يوم الثالث بس، والكشف لسه مسودة، ومفتاح الاعتماد مش شرط هنا (FR-055).
 *
 * @param scope       نطاق العمل على معاملة الشركة
 * @param businessId  النشاط
 * @param statementId الكشف المقفول
 * @param period      الشهر السابق
 * @param date        تاريخ التذكير
 * @returns عدد سطور الدفتر المكتوبة
 */
async function emitReviewReminder(
  scope: StatementReminderScope,
  businessId: string,
  statementId: string,
  period: string,
  date: string,
): Promise<number> {
  const rule = await scope.alertRule(businessId, 'STATEMENT_AWAITING_REVIEW');
  if (!rule.enabled || !rule.channels.includes('IN_APP')) return 0;
  const decisionAt = await scope.decisionTime();
  const recipients = await scope.recipients(businessId, 'review:commissions:business', decisionAt);
  const inserted = await scope.insertLedger({
    businessId,
    statementId,
    kind: 'REVIEW_DAY3',
    reminderDate: date,
    recipientCount: recipients.length,
  });
  if (!inserted) return 0;
  if (recipients.length === 0) return 1;
  await scope.appendNoticeEvents({
    statementId,
    businessId,
    period,
    recipients,
    templateKey: 'statement_awaiting_review',
  });
  return 1;
}
