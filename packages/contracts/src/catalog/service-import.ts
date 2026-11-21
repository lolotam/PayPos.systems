import { z } from 'zod';
import { responseObject } from '../response-object.js';

import { page } from '../pagination/cursor.js';
import { id } from '../scalars/id.js';
import {
  serviceCommissionRuleView,
  serviceDurationMinutes,
  servicePrice,
  serviceNameAr,
  serviceNameEn,
} from './service.js';

// ترتيب الأعمدة الإنجليزي هو المرجع؛ عمودا المدة والتصنيف اختياريان في العنوان نفسه (FR-001).
export const serviceImportColumn = z
  .enum([
    'name_en',
    'name_ar',
    'price',
    'duration_minutes',
    'category',
    'commission_rule',
    'commission_value',
    'counts_toward_threshold',
    'unexpected_column',
  ])
  .meta({ id: 'ServiceImportColumn' });

// رموز أخطاء الصف الاثنا عشر في مواصفة 072؛ الـ UI يترجمها من مفاتيح i18n مع رقم الصف والعمود.
export const serviceImportErrorCode = z
  .enum([
    'IMPORT_REQUIRED_CELL',
    'IMPORT_NAME_INVALID',
    'IMPORT_PRICE_INVALID',
    'IMPORT_COMMISSION_RULE_INVALID',
    'IMPORT_COMMISSION_VALUE_INVALID',
    'IMPORT_BOOLEAN_INVALID',
    'IMPORT_DURATION_INVALID',
    'IMPORT_CATEGORY_NOT_FOUND',
    'IMPORT_CELL_INVALID',
    'IMPORT_COLUMN_UNEXPECTED',
    'IMPORT_DUPLICATE_IN_FILE',
    'IMPORT_SERVICE_EXISTS',
  ])
  .meta({ id: 'ServiceImportErrorCode' });

export const serviceImportRowError = responseObject({
    row: z.number().int().min(2),
    column: serviceImportColumn,
    code: serviceImportErrorCode,
  })
  .meta({ id: 'ServiceImportRowError' });

export const serviceImportTemplate = responseObject({
    file_name: z.string().min(1).max(255),
    content_type: z.literal('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    content_base64: z.string().min(1),
  })
  .meta({ id: 'ServiceImportTemplate' });

export const previewServiceImportInput = z
  .strictObject({ file_id: id })
  .meta({ id: 'PreviewServiceImportInput' });

// الصف المطبّع (D-9/FR-014): المال نص ثلاثي الخانات وقيمة القاعدة عدد صحيح bps أو نص مبلغ، فلا رقم جافاسكربت يحمل مالاً،
// والقيمة بترتبط بنوع القاعدة وقت التحقق نفسه: PCT بنفس الـ bps، وFIXED بنفس النص، وFOLLOW_PLAN وZERO بلا قيمة.
export const serviceImportRow = responseObject({
    row: z.number().int().min(2),
    name_en: serviceNameEn,
    name_ar: serviceNameAr.nullable(),
    price: servicePrice,
    duration_minutes: serviceDurationMinutes.nullable(),
    category_id: id.nullable(),
    category_name_en: z.string().nullable(),
    commission_rule: serviceCommissionRuleView,
    commission_value: z.union([z.number().int().min(0).max(10_000), servicePrice]).nullable(),
    commission_rule_defaulted: z.boolean(),
    counts_toward_threshold: z.boolean(),
  })
  .superRefine((row, ctx) => {
    const kind = row.commission_rule.kind;
    const value = row.commission_value;
    if (kind === 'FOLLOW_PLAN' || kind === 'ZERO') {
      if (value !== null) ctx.addIssue({ code: 'custom', path: ['commission_value'], message: 'rule carries no value' });
      return;
    }
    if (value === null || value !== row.commission_rule.value)
      ctx.addIssue({ code: 'custom', path: ['commission_value'], message: 'value does not match the rule' });
  })
  .meta({ id: 'ServiceImportRow' });

export const serviceImportPreview = responseObject({
    preview_id: id,
    row_count: z.number().int().min(0).max(500),
    error_count: z.number().int().min(0),
    errors: z.array(serviceImportRowError).max(5000),
    rows: z.array(serviceImportRow).max(100),
    next_cursor: z.string().nullable(),
  })
  .meta({ id: 'ServiceImportPreview' });

export const serviceImportRowsQuery = z
  .strictObject({
    cursor: id.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'ServiceImportRowsQuery' });

export const serviceImportRowsPage = page(serviceImportRow).meta({ id: 'ServiceImportRowsPage' });

export const commitServiceImportInput = z
  .strictObject({ preview_id: id })
  .meta({ id: 'CommitServiceImportInput' });

export const serviceImportCommit = z
  .strictObject({
    preview_id: id,
    created_count: z.number().int().min(0).max(500),
    service_ids: z.array(id).max(500),
  })
  .meta({ id: 'ServiceImportCommit' });

// الطلب يقبل مرة واحدة؛ النتيجة النهائية تقرأ من حالة المعاينة بعد تنفيذ الوظيفة.
export const serviceImportCommitAccepted = responseObject({ preview_id: id })
  .meta({ id: 'ServiceImportCommitAccepted' });

export const serviceImportStatus = responseObject({
    preview_id: id,
    status: z.enum(['ready', 'commit_requested', 'committed', 'failed']),
    created_count: z.number().int().min(0).max(500),
    error_code: z
      .enum([
        'IMPORT_SERVICE_EXISTS',
        'IMPORT_CATEGORY_NOT_FOUND',
        'IMPORT_PREVIEW_EXPIRED',
        'IMPORT_PREVIEW_HAS_ERRORS',
        'IMPORT_COMMIT_FAILED',
      ])
      .nullable(),
  })
  .meta({ id: 'ServiceImportStatus' });

// سكيما الاستيراد بلا مسارات: كل مسار بيسجله الـ PR اللي بيفتحه (32b-2 و32b-5)، ومسار منشور بلا route بيجاوب 404.
export const serviceImportSchemas = [
  serviceImportColumn,
  serviceImportErrorCode,
  serviceImportRowError,
  serviceImportTemplate,
  previewServiceImportInput,
  serviceImportRow,
  serviceImportPreview,
  serviceImportRowsQuery,
  serviceImportRowsPage,
  commitServiceImportInput,
  serviceImportCommit,
  serviceImportCommitAccepted,
  serviceImportStatus,
];

export type ServiceImportColumn = z.infer<typeof serviceImportColumn>;
export type ServiceImportErrorCode = z.infer<typeof serviceImportErrorCode>;
export type ServiceImportRowError = z.infer<typeof serviceImportRowError>;
export type ServiceImportTemplate = z.infer<typeof serviceImportTemplate>;
export type PreviewServiceImportInput = z.infer<typeof previewServiceImportInput>;
export type ServiceImportRow = z.infer<typeof serviceImportRow>;
export type ServiceImportPreview = z.infer<typeof serviceImportPreview>;
export type ServiceImportRowsQuery = z.infer<typeof serviceImportRowsQuery>;
export type ServiceImportRowsPage = z.infer<typeof serviceImportRowsPage>;
export type CommitServiceImportInput = z.infer<typeof commitServiceImportInput>;
export type ServiceImportCommit = z.infer<typeof serviceImportCommit>;
export type ServiceImportCommitAccepted = z.infer<typeof serviceImportCommitAccepted>;
export type ServiceImportStatus = z.infer<typeof serviceImportStatus>;
