import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './identity-auth.ts';
import { employees } from './staff.ts';
import { companies } from './tenancy.ts';

export const documentTypes = pgTable(
  'document_types',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    // كود ثابت لا يتغير بعد الإنشاء؛ الوثائق تشير إليه حتى لو تغير الاسم.
    code: text('code').notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar'),
    // عدد الأيام قبل الانتهاء التي تبدأ فيها الوثيقة بالظهور كقاربت على الانتهاء.
    alertDays: integer('alert_days').notNull(),
    requiresExpiry: boolean('requires_expiry').notNull(),
    active: boolean('active').notNull().default(true),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'document_types_pkey', columns: [t.companyId, t.id] }),
    unique('document_types_company_code_key').on(t.companyId, t.code),
    index('document_types_company_active_name_idx').on(t.companyId, t.active, t.nameEn, t.id),
    check('document_types_code_format', sql`${t.code} ~ '^[a-z][a-z0-9_]{1,63}$'`),
    check('document_types_alert_days', sql`${t.alertDays} BETWEEN 0 AND 365`),
    check('document_types_revision_positive', sql`${t.revision} > 0`),
    check(
      'document_types_names',
      sql`char_length(${t.nameEn}) BETWEEN 1 AND 255 AND ${t.nameEn}=btrim(${t.nameEn}) AND (${t.nameAr} IS NULL OR (char_length(${t.nameAr}) BETWEEN 1 AND 255 AND ${t.nameAr}=btrim(${t.nameAr})))`,
    ),
  ],
);

export const employeeDocuments = pgTable(
  'employee_documents',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    typeCode: text('type_code').notNull(),
    // مفتاح النسخة الموثقة في files فقط؛ لا تُحفظ أي بايتات أو روابط هنا.
    objectKey: text('object_key').notNull(),
    expiresOn: date('expires_on'),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => user.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    // الوثيقة الأحدث من نفس النوع تستبدلها؛ السجل يبقى للتاريخ.
    replacedAt: timestamp('replaced_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'employee_documents_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'employee_documents_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    foreignKey({
      name: 'employee_documents_type_fk',
      columns: [t.companyId, t.typeCode],
      foreignColumns: [documentTypes.companyId, documentTypes.code],
    }),
    unique('employee_documents_company_object_key_key').on(t.companyId, t.objectKey),
    uniqueIndex('employee_documents_current_key')
      .on(t.companyId, t.employeeId, t.typeCode)
      .where(sql`${t.replacedAt} IS NULL`),
    index('employee_documents_company_expires_idx')
      .on(t.companyId, t.expiresOn)
      .where(sql`${t.replacedAt} IS NULL AND ${t.expiresOn} IS NOT NULL`),
    // فحص وظيفة الانتهاء لكل نشاط؛ نفس شرط الجزئية حتى لا يقرأ الصفوف المستبدلة أو بلا تاريخ.
    index('employee_document_expiry_scan_idx')
      .on(t.companyId, t.businessId, t.expiresOn)
      .where(sql`${t.replacedAt} IS NULL AND ${t.expiresOn} IS NOT NULL`),
    index('employee_documents_company_employee_idx').on(
      t.companyId,
      t.employeeId,
      t.typeCode,
      t.recordedAt,
    ),
    index('employee_documents_company_business_idx').on(t.companyId, t.businessId),
    index('employee_documents_company_type_idx').on(t.companyId, t.typeCode),
    index('employee_documents_uploaded_by_idx').on(t.uploadedBy),
    check(
      'employee_documents_replaced_after_record',
      sql`${t.replacedAt} IS NULL OR ${t.replacedAt} >= ${t.recordedAt}`,
    ),
  ],
);

export const employeeDocumentExpiryNotices = pgTable(
  'employee_document_expiry_notices',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    // الوثيقة الحالية التي أُرسل تنبيهها؛ مع تاريخ الانتهاء يشكّلان مفتاح منع التكرار.
    documentId: uuid('document_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    businessId: uuid('business_id').notNull(),
    typeCode: text('type_code').notNull(),
    expiresOn: date('expires_on').notNull(),
    // لحظة الإشعار من الـ Clock المحقون، لا ساعة الخادم.
    notifiedAt: timestamp('notified_at', { withTimezone: true }).notNull(),
    // NULL يبقي التنبيه بلا مستلمين قابلاً لإعادة الإصدار مرة في PR 62 لو الوثيقة حالية وداخل النافذة؛ يثبت الوقت مع الحدث في نفس المعاملة.
    recipientsAttachedAt: timestamp('recipients_attached_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'employee_document_expiry_notices_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'employee_document_expiry_notices_document_fk',
      columns: [t.companyId, t.documentId],
      foreignColumns: [employeeDocuments.companyId, employeeDocuments.id],
    }),
    // مفتاح الإصدار الأول لكل وثيقة وتاريخ انتهاء؛ إرفاق مستلمين لاحقاً تحكمه recipients_attached_at.
    unique('employee_document_expiry_notices_key').on(t.companyId, t.documentId, t.expiresOn),
  ],
);
