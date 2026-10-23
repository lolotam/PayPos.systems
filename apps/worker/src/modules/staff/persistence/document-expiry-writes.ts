import { appendAuditLog, appendOutboxEvents, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type {
  DocumentExpiryParameter,
  DocumentNameFallback,
} from '../domain/document-expiry-notice.ts';
import { daysUntilExpiry } from '../domain/document-expiry.ts';
import { inAppRecipientGroups } from '../domain/not-clocked-in.ts';
import type { LockedDocumentExpiry } from '../ports/document-expiry.port.ts';
import { documentExpiryRecipientsFor } from './document-expiry-recipients.ts';

/** حقائق الحدث كما تخرج من القفل؛ هي نفسها اللي بتتحفظ في سطر التدقيق. */
interface DocumentExpiryFacts {
  readonly document_id: string;
  readonly employee_id: string;
  readonly business_id: string;
  readonly type_code: string;
  readonly expires_on: string;
  readonly days_remaining: number | null;
  readonly alert_days: number;
  readonly today: string;
  readonly detected_at: string;
}

/**
 * يسجل تنبيه انتهاء المستند ويفرز مستلميه مرة واحدة (عقد spec 033 في بند 62).
 * الترتيب: سطر الدفتر أولًا، ثم قفله، ثم المستلمون، ثم الحدث والتدقيق وعلامة الإرفاق.
 * سطر مُرفق بالفعل (العلامة غير NULL) ما بياخدش حدث تاني، وإرفاق بلا مستلمين بيسيب العلامة NULL
 * عشان تشغيل تاني يرفقهم طول ما الوثيقة حالية وداخل نافذتها.
 *
 * @param tx معاملة الشركة
 * @param ids مولّد المعرفات
 * @param companyId الشركة
 * @param locked الوثيقة المقفولة
 * @param today يوم النشاط المحلي
 * @param at لحظة الإشعار من الـ Clock
 * @param fallback الأسماء العامة لجرس المستند
 * @returns true لو اتسجل الإشعار أو اتفرق مستلموه
 */
export async function notifyDocumentExpiry(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  locked: LockedDocumentExpiry,
  today: string,
  at: Date,
  fallback: DocumentNameFallback,
): Promise<boolean> {
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO employee_document_expiry_notices(company_id,id,document_id,employee_id,business_id,type_code,expires_on,notified_at)
    VALUES(${companyId},${ids.newId()},${locked.documentId},${locked.employeeId},${locked.businessId},${locked.typeCode},${locked.expiresOn}::date,${at.toISOString()})
    ON CONFLICT (company_id, document_id, expires_on) DO NOTHING RETURNING id`);
  const facts: DocumentExpiryFacts = {
    document_id: locked.documentId,
    employee_id: locked.employeeId,
    business_id: locked.businessId,
    type_code: locked.typeCode,
    expires_on: locked.expiresOn,
    days_remaining: daysUntilExpiry(locked.expiresOn, today),
    alert_days: locked.alertDays,
    today,
    detected_at: at.toISOString(),
  };
  if (inserted.length === 1)
    await appendAuditLog(tx, ids.newId(), {
      entity: 'employee_document',
      entityId: locked.documentId,
      action: 'document_expiring.notified',
      after: facts,
    });
  const notice = await lockNotice(tx, companyId, locked.documentId, locked.expiresOn);
  if (notice === null || notice.recipientsAttachedAt !== null) return inserted.length === 1;
  const recipients = await documentExpiryRecipientsFor(tx, companyId, locked, at, fallback);
  if (recipients === null) return inserted.length === 1;
  await appendExpiryEvents(tx, ids, locked, facts, recipients);
  await appendAuditLog(tx, ids.newId(), {
    entity: 'employee_document',
    entityId: locked.documentId,
    action: 'document_expiring.recipients_attached',
    after: { ...facts, recipient_user_ids: recipients.userIds },
  });
  const updated = await tx.execute<{ id: string }>(sql`
    UPDATE employee_document_expiry_notices SET recipients_attached_at=${at.toISOString()}
    WHERE company_id=${companyId} AND id=${notice.id} AND recipients_attached_at IS NULL
    RETURNING id`);
  if (updated.length !== 1) throw new Error('DOCUMENT_EXPIRY_ATTACH_LOST');
  return true;
}

/** سطر الدفتر تحت القفل: العلامة غير NULL معناها أن المستلمين اتفرقوا قبل كده. */
async function lockNotice(
  tx: Tx,
  companyId: string,
  documentId: string,
  expiresOn: string,
): Promise<{ id: string; recipientsAttachedAt: Date | null } | null> {
  const [row] = await tx.execute<{ id: string; recipients_attached_at: Date | string | null }>(sql`
    SELECT id, recipients_attached_at FROM employee_document_expiry_notices
    WHERE company_id=${companyId} AND document_id=${documentId} AND expires_on=${expiresOn}::date
    FOR UPDATE`);
  if (row === undefined) return null;
  return {
    id: row.id,
    recipientsAttachedAt:
      row.recipients_attached_at === null ? null : new Date(row.recipients_attached_at),
  };
}

/** حدث لكل مجموعة مستلمين (سقف العقد مئة)؛ المجموعات كلها نفس aggregates فالقفل واحد. */
async function appendExpiryEvents(
  tx: Tx,
  ids: IdGenerator,
  locked: LockedDocumentExpiry,
  facts: DocumentExpiryFacts,
  recipients: { userIds: readonly string[]; parameters: readonly DocumentExpiryParameter[] },
): Promise<void> {
  const groups = inAppRecipientGroups(recipients.userIds);
  await appendOutboxEvents(
    tx,
    groups.map((group) => ({
      id: ids.newId(),
      event: {
        aggregateType: 'employee',
        aggregateId: locked.employeeId,
        eventType: 'DocumentExpiring',
        payload: {
          ...facts,
          notification_recipients: recipientsFor(group, recipients.parameters),
        },
      },
    })),
  );
}

function recipientsFor(userIds: readonly string[], parameters: readonly DocumentExpiryParameter[]) {
  return userIds.map((userId) => ({
    channel: 'IN_APP' as const,
    user_id: userId,
    locale: 'ar' as const,
    template_key: 'document_expiring' as const,
    template_revision: 1 as const,
    safe_parameters: parameters,
  }));
}
