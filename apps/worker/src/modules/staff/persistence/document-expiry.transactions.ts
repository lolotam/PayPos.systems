import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { businessTimeZone } from '../../tenancy/index.ts';
import { SAFE_DOCUMENT_NAME_FALLBACK } from '../domain/document-expiry-notice.ts';
import { documentExpiryCandidate } from '../domain/document-expiry.ts';
import type {
  DocumentExpiryCandidate,
  DocumentExpiryCursor,
  DocumentExpiryTransactions,
  LockedDocumentExpiry,
} from '../ports/document-expiry.port.ts';
import { notifyDocumentExpiry } from './document-expiry-writes.ts';

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
  // الموظفة المحذوفة ونوع المستند غير الفعّال ما يبعتوش تنبيه (MO-Q5)، وسطر الدفتر بلا إرفاق مستلمين يفضل مرشحًا.
  return sql`SELECT d.id, d.employee_id, d.business_id, d.type_code,
      to_char(d.expires_on,'YYYY-MM-DD') AS expires_on, t.alert_days
    FROM employee_documents d
    JOIN document_types t ON t.company_id = d.company_id AND t.code = d.type_code
    JOIN employees e ON e.company_id = d.company_id AND e.id = d.employee_id AND e.deleted_at IS NULL
    LEFT JOIN employee_document_expiry_notices n
      ON n.company_id = d.company_id AND n.document_id = d.id AND n.expires_on = d.expires_on
    WHERE d.company_id = ${companyId} AND d.business_id = ${businessId}
      AND d.replaced_at IS NULL AND d.expires_on IS NOT NULL
      AND d.expires_on >= (${now.toISOString()}::timestamptz AT TIME ZONE ${timeZone})::date
      AND d.expires_on <= (${now.toISOString()}::timestamptz AT TIME ZONE ${timeZone})::date + t.alert_days
      AND n.recipients_attached_at IS NULL ${page}
      AND t.active
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
  fallback = SAFE_DOCUMENT_NAME_FALLBACK,
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
          return notifyDocumentExpiry(tx, ids, companyId, current, today, at, fallback);
        },
        { timeoutMs: DOCUMENT_EXPIRY_TRANSACTION_TIMEOUT_MS },
      ),
  };
}

async function lockedCandidate(
  tx: Tx,
  companyId: string,
  documentId: string,
): Promise<LockedDocumentExpiry | null> {
  const [document] = await tx.execute<{ employee_id: string }>(sql`
    SELECT employee_id FROM employee_documents
    WHERE company_id=${companyId} AND id=${documentId}`);
  if (document === undefined) return null;
  const employee = await lockNoticeEmployee(tx, companyId, document.employee_id);
  if (employee === null) return null;
  // صف الموظفة بيتقفل أولًا بنفس ترتيب كتابة الوثائق في الـ API، فالحذف أو تغيير الفرع الأساسي ما يسبقوش إرفاق المستلمين؛ وقفل المشاركة على الوثيقة والنوع يمنع الاستبدال وتعديل أيام التنبيه.
  const [row] = await tx.execute<
    NoticeRow & {
      type_name_ar: string | null;
      type_name_en: string;
    }
  >(sql`
    SELECT d.id, d.employee_id, d.business_id, d.type_code,
      to_char(d.expires_on,'YYYY-MM-DD') AS expires_on, t.alert_days,
      t.name_ar AS type_name_ar, t.name_en AS type_name_en
    FROM employee_documents d
    JOIN document_types t ON t.company_id=d.company_id AND t.code=d.type_code
    WHERE d.company_id=${companyId} AND d.id=${documentId} AND d.employee_id=${document.employee_id}
      AND d.replaced_at IS NULL AND d.expires_on IS NOT NULL
      AND t.active
    FOR SHARE OF d, t`);
  if (row === undefined) return null;
  return {
    documentId: row.id,
    employeeId: row.employee_id,
    businessId: row.business_id,
    typeCode: row.type_code,
    expiresOn: row.expires_on,
    alertDays: row.alert_days,
    primaryBranchId: employee.primaryBranchId,
    employeeNameAr: employee.nameAr,
    employeeNameEn: employee.nameEn,
    typeNameAr: row.type_name_ar,
    typeNameEn: row.type_name_en,
  };
}

/** صف الموظفة تحت قفل المشاركة: لو اتحذف أو اتغيّر فرعه الأساسي ما يقدرش يسبق إرفاق المستلمين. */
async function lockNoticeEmployee(
  tx: Tx,
  companyId: string,
  employeeId: string,
): Promise<{ primaryBranchId: string; nameAr: string | null; nameEn: string } | null> {
  const [row] = await tx.execute<{
    primary_branch_id: string;
    name_ar: string | null;
    name_en: string;
  }>(sql`
    SELECT primary_branch_id, name_ar, name_en FROM employees
    WHERE company_id=${companyId} AND id=${employeeId} AND deleted_at IS NULL
    FOR SHARE`);
  if (row === undefined) return null;
  return {
    primaryBranchId: row.primary_branch_id,
    nameAr: row.name_ar,
    nameEn: row.name_en,
  };
}
