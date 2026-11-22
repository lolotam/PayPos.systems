import { z } from 'zod';
import { responseObject } from '../response-object.js';
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
export const documentType = responseObject({
  id,
  code: documentTypeCode,
  name_en: z.string(),
  name_ar: z.string().nullable(),
  alert_days: z.number().int().min(0).max(365),
  requires_expiry: z.boolean(),
  active: z.boolean(),
  revision,
}).meta({ id: 'DocumentType' });
export const documentTypeList = responseObject({ items: z.array(documentType) }).meta({
  id: 'DocumentTypeList',
});

// رقم المستند اختياري: نص مقتطع من 1 إلى 64 نقطة يونيكود، وبدون أي حرف تحكم خام قبل القص (AL-Q8c).
// الشكل المحفوظ نفسه هو حكم القارئ: مقطّط الطرفين، بلا تحكم، ومن 1 إلى 64 نقطة — نفس قيد قاعدة البيانات.
const isControlCodePoint = (codePoint: number) =>
  codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
const hasInputControl = (value: string) =>
  /\p{Bidi_Control}/u.test(value) ||
  [...value].some((character) => isControlCodePoint(character.codePointAt(0) as number));
const isDocumentNumberCodePoint = (character: string) => {
  const point = character.codePointAt(0);
  return point !== undefined && !isControlCodePoint(point) && (point < 0xd800 || point > 0xdfff);
};
const documentNumberShape = (value: string) => {
  const codePoints = [...value];
  return (
    codePoints.every(isDocumentNumberCodePoint) &&
    value.trim() === value &&
    value.length > 0 &&
    codePoints.length <= 64
  );
};
export const documentNumberInput = z
  .string()
  .refine((value) => !hasInputControl(value), { message: 'DOCUMENT_NUMBER_CONTROL_CHARACTER' })
  .transform((value) => value.trim())
  .pipe(z.string().refine(documentNumberShape, { message: 'DOCUMENT_NUMBER_INVALID' }));
export const documentNumber = z
  .string()
  .refine(documentNumberShape, { message: 'DOCUMENT_NUMBER_INVALID' });

export const recordEmployeeDocumentInput = z
  .strictObject({
    type_code: documentTypeCode,
    file_id: id,
    expires_on: documentDate.nullable(),
    document_number: documentNumberInput.nullable().optional(),
  })
  .meta({ id: 'RecordEmployeeDocumentInput' });
export const employeeDocument = responseObject({
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
}).meta({ id: 'EmployeeDocument' });
export const employeeDocumentListItem = employeeDocument
  .extend({ document_number: documentNumber.nullable() })
  .meta({ id: 'EmployeeDocumentListItem' });
export const employeeDocumentNumbersQuery = z
  .strictObject({
    ids: z
      .string()
      .transform((value) => value.split(',').map((value) => value.trim().toLowerCase()))
      .pipe(z.array(z.uuid()).min(1).max(20))
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'DOCUMENT_NUMBER_IDS_DUPLICATE',
      }),
  })
  .meta({ id: 'EmployeeDocumentNumbersQuery' });
export const employeeDocumentNumber = z
  .strictObject({ document_id: id, document_number: documentNumber })
  .meta({ id: 'EmployeeDocumentNumber' });
export const employeeDocumentNumbers = responseObject({
  items: z.array(employeeDocumentNumber),
}).meta({ id: 'EmployeeDocumentNumbers' });
export const employeeDocumentsView = responseObject({
  today: documentDate,
  items: z.array(employeeDocumentListItem),
  types: z.array(documentType),
  can_manage: z.boolean(),
}).meta({ id: 'EmployeeDocumentsView' });

// نموذج الإدارة قبل الرفع: الملف يمر عبر files، والتاريخ الفارغ يعني وثيقة بلا انتهاء،
// والرقم الفارغ أو مسافات فقط يعني بلا رقم قبل الإرسال.
export const employeeDocumentFormInput = z.strictObject({
  type_code: documentTypeCode,
  expires_on: z.union([z.literal(''), documentDate]),
  document_number: z
    .union([
      documentNumberInput,
      z.string().refine((value) => value.trim() === '' && !hasInputControl(value)),
    ])
    .optional(),
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
  employeeDocumentListItem,
  employeeDocumentNumbersQuery,
  employeeDocumentNumber,
  employeeDocumentNumbers,
  employeeDocumentsView,
];
export type CreateDocumentTypeInput = z.infer<typeof createDocumentTypeInput>;
export type UpdateDocumentTypeInput = z.infer<typeof updateDocumentTypeInput>;
export type DocumentTypeRevisionInput = z.infer<typeof documentTypeRevisionInput>;
export type DocumentType = z.infer<typeof documentType>;
export type DocumentTypeList = z.infer<typeof documentTypeList>;
export type RecordEmployeeDocumentInput = z.infer<typeof recordEmployeeDocumentInput>;
export type EmployeeDocument = z.infer<typeof employeeDocument>;
export type EmployeeDocumentListItem = z.infer<typeof employeeDocumentListItem>;
export type EmployeeDocumentNumbersQuery = z.infer<typeof employeeDocumentNumbersQuery>;
export type EmployeeDocumentNumber = z.infer<typeof employeeDocumentNumber>;
export type EmployeeDocumentNumbers = z.infer<typeof employeeDocumentNumbers>;
export type EmployeeDocumentStatus = z.infer<typeof documentStatus>;
export type EmployeeDocumentsView = z.infer<typeof employeeDocumentsView>;
