import { z } from 'zod';
import { nameAr, nameEn } from '../bilingual/names.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

// PostgreSQL لا يملك سنة صفر؛ تاريخ الانتهاء يقبل الماضي لأن الوثيقة قد تسجل وهي منتهية بالفعل.
const documentDate = z.iso.date().regex(/^(?!0000)/);
const revision = z.number().int().positive();
export const documentTypeCode = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
export const documentStatus = z
  .enum(['NO_EXPIRY', 'VALID', 'EXPIRING', 'EXPIRED'])
  .meta({ id: 'EmployeeDocumentStatus' });

const documentTypeTerms = {
  name_en: nameEn,
  name_ar: nameAr.nullable().optional(),
  alert_days: z.number().int().min(0).max(365),
  requires_expiry: z.boolean(),
};
export const createDocumentTypeInput = z
  .strictObject(documentTypeTerms)
  .meta({ id: 'CreateDocumentTypeInput' });
export const updateDocumentTypeInput = z
  .strictObject({ ...documentTypeTerms, expected_revision: revision })
  .meta({ id: 'UpdateDocumentTypeInput' });
export const documentTypeRevisionInput = z
  .strictObject({ expected_revision: revision })
  .meta({ id: 'DocumentTypeRevisionInput' });
export const documentType = z
  .strictObject({
    id,
    code: documentTypeCode,
    name_en: z.string(),
    name_ar: z.string().nullable(),
    alert_days: z.number().int().min(0).max(365),
    requires_expiry: z.boolean(),
    active: z.boolean(),
    revision,
  })
  .meta({ id: 'DocumentType' });
export const documentTypeList = z
  .strictObject({ items: z.array(documentType) })
  .meta({ id: 'DocumentTypeList' });

export const recordEmployeeDocumentInput = z
  .strictObject({
    type_code: documentTypeCode,
    file_id: id,
    expires_on: documentDate.nullable(),
  })
  .meta({ id: 'RecordEmployeeDocumentInput' });
export const employeeDocument = z
  .strictObject({
    id,
    employee_id: id,
    type_code: documentTypeCode,
    type_name_en: z.string(),
    type_name_ar: z.string().nullable(),
    object_key: z.string(),
    expires_on: documentDate.nullable(),
    uploaded_by: id,
    recorded_at: timestamp,
    status: documentStatus,
  })
  .meta({ id: 'EmployeeDocument' });
export const employeeDocumentsView = z
  .strictObject({
    today: documentDate,
    items: z.array(employeeDocument),
    types: z.array(documentType),
    can_manage: z.boolean(),
  })
  .meta({ id: 'EmployeeDocumentsView' });

// نموذج الإدارة قبل الرفع: الملف يمر عبر files، والتاريخ الفارغ يعني وثيقة بلا انتهاء.
export const employeeDocumentFormInput = z.strictObject({
  type_code: documentTypeCode,
  expires_on: z.union([z.literal(''), documentDate]),
});
export type EmployeeDocumentFormValues = z.infer<typeof employeeDocumentFormInput>;

export const employeeDocumentSchemas = [
  documentStatus,
  createDocumentTypeInput,
  updateDocumentTypeInput,
  documentTypeRevisionInput,
  documentType,
  documentTypeList,
  recordEmployeeDocumentInput,
  employeeDocument,
  employeeDocumentsView,
];
export type CreateDocumentTypeInput = z.infer<typeof createDocumentTypeInput>;
export type UpdateDocumentTypeInput = z.infer<typeof updateDocumentTypeInput>;
export type DocumentTypeRevisionInput = z.infer<typeof documentTypeRevisionInput>;
export type DocumentType = z.infer<typeof documentType>;
export type DocumentTypeList = z.infer<typeof documentTypeList>;
export type RecordEmployeeDocumentInput = z.infer<typeof recordEmployeeDocumentInput>;
export type EmployeeDocument = z.infer<typeof employeeDocument>;
export type EmployeeDocumentStatus = z.infer<typeof documentStatus>;
export type EmployeeDocumentsView = z.infer<typeof employeeDocumentsView>;
