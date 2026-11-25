import {
  appendOutboxEvent,
  lockStatementPeriods,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { commissionStatementNoticeGroupSize } from '@pospay/contracts';
import { sql } from 'drizzle-orm';

import type {
  LockedReminderStatement,
  NoticeEventInput,
  ReminderLedgerInput,
  StatementReminderAlertRulesReader,
  StatementReminderBusinessesReader,
  StatementReminderFeatureReader,
  StatementReminderRecipientsReader,
  StatementReminderScope,
  StatementReminderSwitchReader,
  StatementReminderTransactions,
} from '../ports/statement-reminder.port.ts';

/** القراء اللي بتبني نطاق التذكير على معاملة الشركة. */
export interface StatementReminderReaders {
  readonly businesses: StatementReminderBusinessesReader<Tx>;
  readonly feature: StatementReminderFeatureReader<Tx>;
  readonly recipients: StatementReminderRecipientsReader<Tx>;
  readonly alertRules: StatementReminderAlertRulesReader<Tx>;
  readonly switch: StatementReminderSwitchReader<Tx>;
}

/**
 * يبني حد معاملة التذكير: أنشطة الشركة بتتقرأ في معاملة، وكل نشاط مستحق ليه معاملة
 * لوحده (FR-053). قراءات النطاق كلها بتتنفذ على نفس المعاملة.
 *
 * @param database واجهات الداتابيز
 * @param ids      مولّد الهوية
 * @param readers  القراء المحقونة من الجذر
 * @returns حد معاملة التذكير
 */
export function createStatementReminderTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  readers: StatementReminderReaders,
): StatementReminderTransactions {
  return {
    businesses: async (companyId) =>
      database.withTenant(companyId, (tx) => readers.businesses(tx, companyId)),
    run: async (companyId, work) =>
      database.withTenant(companyId, async (tx) => work(scopeOf(tx, companyId, ids, readers))),
  };
}

/** يبني نطاق العمل على معاملة الشركة. */
function scopeOf(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  readers: StatementReminderReaders,
): StatementReminderScope {
  return {
    featureEnabled: () => readers.feature(tx, companyId),
    decisionTime: () => decisionTime(tx),
    alertRule: (businessId, kind) =>
      readers.alertRules(tx, companyId, { businessId, branchId: null }, kind),
    switchEnabled: (flag, at) => readers.switch(tx, companyId, flag, at),
    recipients: (businessId, permission, at) =>
      readers.recipients(tx, companyId, businessId, permission, at),
    lockPeriod: (businessId, period) => lockPeriod(tx, ids, businessId, period),
    insertLedger: (input) => insertReminderLedger(tx, ids, input),
    appendNoticeEvents: (input) => appendNoticeEvents(tx, ids, input),
  };
}

/**
 * يقفل كشف الشهر ويقرأ حالته: القفل بيشيء صف DRAFT لو النشاط هادي (CM-57c)، والمغلق
 * (APPROVED أو PAID) بيرجع بحالته بدون أي كتابة (FR-053).
 */
async function lockPeriod(
  tx: Tx,
  ids: IdGenerator,
  businessId: string,
  period: string,
): Promise<LockedReminderStatement | null> {
  const locked = await lockStatementPeriods(tx, { businessId, periods: [period], ids });
  const statement = locked[0];
  if (statement === undefined) return null;
  return { statementId: statement.statementId, status: statement.status };
}

/**
 * يكتب سطر دفتر التذكيرات: التكرار أيام الاستحقاق متمنوع بالمفتاح الفريد، فالسطر الجديد
 * وحده هو اللي بيرجع معرّفه. السطر بصفر مستلمين قرار دائم: الشطب بيقول «اتبعت ومحدش»،
 * فالتشغيل التاني في نفس اليوم ما بيكرّرش (FR-053).
 */
async function insertReminderLedger(
  tx: Tx,
  ids: IdGenerator,
  input: ReminderLedgerInput,
): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`
    INSERT INTO commission_statement_reminders(
      company_id, id, business_id, statement_id, kind, reminder_date, recipient_count)
    VALUES (app_company_id(), ${ids.newId()}::uuid, ${input.businessId}::uuid,
      ${input.statementId}::uuid, ${input.kind}, ${input.reminderDate}::date, ${input.recipientCount}::integer)
    ON CONFLICT (company_id, statement_id, kind, reminder_date) DO NOTHING
    RETURNING id`);
  return rows.length > 0;
}

/** صف جرس داخل التطبيق: المستلم والقالب والشهر وحده (FR-030، FR-055). */
interface NoticeRecipient {
  readonly channel: 'IN_APP';
  readonly user_id: string;
  readonly locale: 'ar';
  readonly template_key: 'statement_awaiting_approval' | 'statement_awaiting_review';
  readonly template_revision: 1;
  readonly safe_parameters: readonly {
    readonly name: 'period';
    readonly type: 'text';
    readonly value: string;
  }[];
}

/**
 * يقسّم المستلمين لمجموعات متتالية ما تتجاوز مية، بعد حذف التكرار والترتيب التصاعدي
 * (ADR-0037 §5، FR-030).
 */
export function groupNoticeRecipients(
  userIds: readonly string[],
): readonly (readonly string[])[] {
  const unique = [...new Set(userIds)].sort();
  const groups: string[][] = [];
  for (let index = 0; index < unique.length; index += commissionStatementNoticeGroupSize) {
    groups.push(unique.slice(index, index + commissionStatementNoticeGroupSize));
  }
  return groups;
}

/** يبني صفوف الجرس لمجموعة واحدة: هوية المستخدم والقالب والشهر وحده. */
function noticeRecipients(
  userIds: readonly string[],
  period: string,
  templateKey: NoticeEventInput['templateKey'],
): readonly NoticeRecipient[] {
  return userIds.map((user_id) => ({
    channel: 'IN_APP',
    user_id,
    locale: 'ar',
    template_key: templateKey,
    template_revision: 1,
    safe_parameters: [{ name: 'period', type: 'text', value: period }],
  }));
}

/**
 * يكتب أحداث الجرس لمجموعات المستلمين في نفس معاملة الكاتب: حدث لكل مجموعة، مرتب تصاعديًا.
 */
async function appendNoticeEvents(
  tx: Tx,
  ids: IdGenerator,
  input: NoticeEventInput,
): Promise<number> {
  const groups = groupNoticeRecipients(input.recipients);
  for (const [index, group] of groups.entries()) {
    await appendOutboxEvent(tx, ids.newId(), {
      aggregateType: 'commission_statement',
      aggregateId: input.statementId,
      eventType:
        input.templateKey === 'statement_awaiting_approval'
          ? 'StatementAwaitingApproval'
          : 'StatementAwaitingReview',
      payload: {
        schema_version: 1,
        business_id: input.businessId,
        statement_id: input.statementId,
        period: input.period,
        group_index: index,
        notification_recipients: noticeRecipients(group, input.period, input.templateKey),
      },
    });
  }
  return groups.length;
}

/** لحظة القرار من ساعة PostgreSQL بعد الأقفال (ADR-0054 §9). */
async function decisionTime(tx: Tx): Promise<Date> {
  const [row] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (row === undefined) throw new Error('The database clock is unavailable');
  return new Date(row.at);
}
