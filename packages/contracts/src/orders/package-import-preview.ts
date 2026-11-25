import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';

// عناوين ورقة بيانات المصنف بترتيبها المرجعي: ستة أعمدة ثابتة ثم عشرون مجموعة خدمات؛ مرجع واحد للقالب والمعاينة والشاشة.
export const PACKAGE_IMPORT_HEADERS: readonly string[] = [
  'customer_phone',
  'name_en',
  'name_ar',
  'price_paid',
  'expires_on',
  'external_ref',
  ...Array.from({ length: 20 }, (_, index) => [
    `service_${index + 1}`,
    `sessions_${index + 1}`,
    `remaining_${index + 1}`,
  ]).flat(),
];

export const requestPackageImportPreviewInput = z
  .strictObject({ file_id: id })
  .meta({ id: 'RequestPackageImportPreviewInput' });
export const packageImportPreviewAccepted = responseObject({ preview_id: id }).meta({
  id: 'PackageImportPreviewAccepted',
});
// القالب يُنزَّل مصنفاً مشفراً بـ base64 كما في استيراد الخدمات؛ لا يحمل بيانات عملاء ولا هواتف.
export const packageImportTemplate = responseObject({
  file_name: z.string().min(1).max(255),
  content_type: z.literal('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  content_base64: z.string().min(1),
}).meta({ id: 'PackageImportTemplate' });
export const packageImportPreviewRequested = z
  .strictObject({ preview_id: id })
  .meta({ id: 'PackageImportPreviewRequested' });
export const packageImportPreviewRowError = responseObject({
  row: z.number().int().min(2),
  column: z.string().min(1).max(100),
  code: z.enum([
    'IMPORT_CELL_INVALID',
    'IMPORT_PHONE_INVALID',
    'IMPORT_NAME_INVALID',
    'INVALID_PRICE',
    'IMPORT_DATE_INVALID',
    'IMPORT_EXTERNAL_REF_INVALID',
    'IMPORT_REQUIRED_CELL',
    'IMPORT_SERVICE_AMBIGUOUS',
    'IMPORT_SERVICE_NOT_FOUND',
    'INVALID_COMPONENTS',
    'DUPLICATE_SERVICE',
    'INVALID_SESSIONS',
    'INVALID_REMAINING_SESSIONS',
    'IMPORT_CUSTOMER_NOT_FOUND',
    'IMPORT_EXTERNAL_REF_DUPLICATE',
  ]),
}).meta({ id: 'PackageImportPreviewRowError' });
const pending = responseObject({ preview_id: id, status: z.literal('pending') });
const ready = responseObject({
  preview_id: id,
  status: z.literal('ready'),
  row_count: z.number().int().min(0).max(500),
  error_count: z.number().int().min(0),
  skipped_count: z.number().int().min(0).max(500),
  errors: z.array(packageImportPreviewRowError).max(40000),
});
const commitRequested = responseObject({
  preview_id: id,
  status: z.literal('commit_requested'),
});
const committed = responseObject({
  preview_id: id,
  status: z.literal('committed'),
  created_count: z.number().int().min(0).max(500),
  skipped_count: z.number().int().min(0).max(500),
});
// رموز فشل المعاينة الثمانية؛ عامل المعاينة يقيّد بها ما يثبّته، ولا يقبل رموز التثبيت.
export const packageImportPreviewFailureCode = z.enum([
  'IMPORT_FILE_NOT_FOUND',
  'IMPORT_FILE_NOT_READY',
  'IMPORT_FILE_TYPE_INVALID',
  'IMPORT_FILE_SIZE_INVALID',
  'IMPORT_FILE_CONTENT_INVALID',
  'IMPORT_HEADER_INVALID',
  'IMPORT_ROW_LIMIT_EXCEEDED',
  'STORAGE_UNAVAILABLE',
]);
// رموز فشل التثبيت التي يثبتها عامل التثبيت أو الاسترداد على صف المعاينة (47-2b/c).
const commitFailureCodes = [
  'IMPORT_PREVIEW_EXPIRED',
  'IMPORT_PREVIEW_HAS_ERRORS',
  'IMPORT_COMMIT_FAILED',
  'IMPORT_SERVICE_NOT_FOUND',
] as const;
const failed = responseObject({
  preview_id: id,
  status: z.literal('failed'),
  error_code: z.enum([...packageImportPreviewFailureCode.options, ...commitFailureCodes]),
});
export const packageImportPreviewStatus = z
  .discriminatedUnion('status', [pending, ready, commitRequested, committed, failed])
  .meta({ id: 'PackageImportPreviewStatus' });
export type PackageImportTemplate = z.infer<typeof packageImportTemplate>;
export type RequestPackageImportPreviewInput = z.infer<typeof requestPackageImportPreviewInput>;
export type PackageImportPreviewRequested = z.infer<typeof packageImportPreviewRequested>;
export type PackageImportPreviewStatus = z.infer<typeof packageImportPreviewStatus>;
export const packageImportPreviewSchemas = [
  requestPackageImportPreviewInput,
  packageImportPreviewAccepted,
  packageImportPreviewRequested,
  packageImportPreviewRowError,
  packageImportPreviewStatus,
  packageImportTemplate,
];

export const packageImportPreviewJob = z.strictObject({ companyId: id, previewId: id });
