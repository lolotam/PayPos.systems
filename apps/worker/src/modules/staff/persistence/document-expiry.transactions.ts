import {
  appendAuditLog,
  appendOutboxEvent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';
import { businessTimeZone } from '../../tenancy/index.ts';
import { daysUntilExpiry, documentExpiryCandidate } from '../domain/document-expiry.ts';
import type {
  DocumentExpiryCandidate,
  DocumentExpiryCursor,
  DocumentExpiryTransactions,
} from '../ports/document-expiry.port.ts';

// أطول من قراءة صفحة عادية لأن الكتابة قد تنتظر أقفال الموظف من مسار آخر، وكل وثيقة في معاملة قصيرة.
export const DOCUMENT_EXPIRY_TRANSACTION_TIMEOUT_MS = 15_000;

// الافتراضي يطابق default عمود businesses.timezone؛ غياب الصف لا يوقف الدورة.
const DEFAULT_TIME_ZONE = 'Asia/Kuwait';

type NoticeRow = {
  id: string;
  employee_id: string;
  business_id: string;
  type_code: string;
  expires_on: string;
  alert_days: number;
};

export function documentExpiryCandidatesStatement(
  companyId: string,
  businessId: string,
  timeZone: string,
  now: Date,
  after: DocumentExpiryCursor | null,
  limit: number,
) {
  const page =
    after === null
      ? sql``
      : sql`AND (d.expires_on, d.id) > (${after.expiresOn}::date, ${after.documentId}::uuid)`;
  // اليوم المحلي يُحسب من الـ Clock المحقون ومنطقة النشاط؛ قاعدة spec 028 نفسها، ونافذة التنبيه شاملة الطرفين.
  return sql`SELECT d.id, d.employee_id, d.business_id, d.type_code,
      to_char(d.expires_on,'YYYY-MM-DD') AS expires_on, t.alert_days
    FROM employee_documents d
    JOIN document_types t ON t.company_id = d.company_id AND t.code = d.type_code
    LEFT JOIN employee_document_expiry_notices n
      ON n.company_id = d.company_id AND n.document_id = d.id AND n.expires_on = d.expires_on
    WHERE d.company_id = ${companyId} AND d.business_id = ${businessId}
      AND d.replaced_at IS NULL AND d.expires_on IS NOT NULL
      AND d.expires_on >= (${now.toISOString()}::timestamptz AT TIME ZONE ${timeZone})::date
      AND d.expires_on <= (${now.toISOString()}::timestamptz AT TIME ZONE ${timeZone})::date + t.alert_days
      AND n.id IS NULL ${page}
    ORDER BY d.expires_on, d.id LIMIT ${limit}`;
}

function toCandidate(row: NoticeRow): DocumentExpiryCandidate {
  return {
    documentId: row.id,
    employeeId: row.employee_id,
    businessId: row.business_id,
    typeCode: row.type_code,
    expiresOn: row.expires_on,
    alertDays: row.alert_days,
  };
}

export function documentExpiryTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
): DocumentExpiryTransactions {
  return {
    businesses: (companyId, after, limit) =>
      database.withTenant(
        companyId,
        async (tx) => {
          const rows = await tx.execute<{ business_id: string }>(sql`
            SELECT DISTINCT business_id FROM employee_documents
            WHERE company_id = ${companyId} AND replaced_at IS NULL AND expires_on IS NOT NULL
              ${after === null ? sql`` : sql`AND business_id > ${after}::uuid`}
            ORDER BY business_id LIMIT ${limit}`);
          return rows.map((row) => row.business_id);
        },
        { timeoutMs: DOCUMENT_EXPIRY_TRANSACTION_TIMEOUT_MS },
      ),
    timeZone: (companyId, businessId) =>
      database.withTenant(
        companyId,
        async (tx) => (await businessTimeZone(tx, companyId, businessId)) ?? DEFAULT_TIME_ZONE,
        { timeoutMs: DOCUMENT_EXPIRY_TRANSACTION_TIMEOUT_MS },
      ),
    candidates: (companyId, businessId, timeZone, now, after, limit) =>
      database.withTenant(
        companyId,
        async (tx) => {
          const rows = await tx.execute<NoticeRow>(
            documentExpiryCandidatesStatement(companyId, businessId, timeZone, now, after, limit),
          );
          return rows.map(toCandidate);
        },
        { timeoutMs: DOCUMENT_EXPIRY_TRANSACTION_TIMEOUT_MS },
      ),
    notify: (companyId, candidate, today, at) =>
      database.withTenant(
        companyId,
        async (tx) => {
          const current = await lockedCandidate(tx, companyId, candidate.documentId);
          if (
            current === null ||
            !documentExpiryCandidate(current.expiresOn, current.alertDays, today)
          )
            return false;
          return notifyOnce(tx, ids, companyId, current, today, at);
        },
        { timeoutMs: DOCUMENT_EXPIRY_TRANSACTION_TIMEOUT_MS },
      ),
  };
}

async function lockedCandidate(
  tx: Tx,
  companyId: string,
  documentId: string,
): Promise<DocumentExpiryCandidate | null> {
  // قفل المشاركة يمنع الاستبدال وتعديل قاعدة النوع حتى يثبت الإشعار؛ الصفحة السابقة مجرد ترشيح.
  const [row] = await tx.execute<NoticeRow>(sql`
    SELECT d.id, d.employee_id, d.business_id, d.type_code,
      to_char(d.expires_on,'YYYY-MM-DD') AS expires_on, t.alert_days
    FROM employee_documents d
    JOIN document_types t ON t.company_id=d.company_id AND t.code=d.type_code
    WHERE d.company_id=${companyId} AND d.id=${documentId}
      AND d.replaced_at IS NULL AND d.expires_on IS NOT NULL
    FOR SHARE OF d, t`);
  return row === undefined ? null : toCandidate(row);
}

async function notifyOnce(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  candidate: DocumentExpiryCandidate,
  today: string,
  at: Date,
): Promise<boolean> {
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO employee_document_expiry_notices(company_id,id,document_id,employee_id,business_id,type_code,expires_on,notified_at)
    VALUES(${companyId},${ids.newId()},${candidate.documentId},${candidate.employeeId},${candidate.businessId},${candidate.typeCode},${candidate.expiresOn}::date,${at.toISOString()})
    ON CONFLICT (company_id, document_id, expires_on) DO NOTHING RETURNING id`);
  // الصف المدرج وحده يكتب التدقيق والحدث، فإعادة الدورة أو تعديل alert_days لا ينتج إشعاراً ثانياً.
  if (inserted.length !== 1) return false;
  const payload = {
    document_id: candidate.documentId,
    employee_id: candidate.employeeId,
    business_id: candidate.businessId,
    type_code: candidate.typeCode,
    expires_on: candidate.expiresOn,
    days_remaining: daysUntilExpiry(candidate.expiresOn, today),
    alert_days: candidate.alertDays,
    today,
    detected_at: at.toISOString(),
  };
  await appendAuditLog(tx, ids.newId(), {
    entity: 'employee_document',
    entityId: candidate.documentId,
    action: 'document_expiring.notified',
    after: payload,
  });
  await appendOutboxEvent(tx, ids.newId(), {
    aggregateType: 'employee',
    aggregateId: candidate.employeeId,
    eventType: 'DocumentExpiring',
    payload,
  });
  return true;
}
