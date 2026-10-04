import { z } from 'zod';

import { id } from '../scalars/id.js';

// ترتيب الأعمدة الإنجليزي هو المرجع؛ التسميات العربية تعليقات على العناوين وليست صف بيانات.
export const employeeImportColumn = z
  .enum([
    'name_en',
    'name_ar',
    'role_code',
    'hire_date',
    'contract_end',
    'primary_branch',
    'unexpected_column',
  ])
  .meta({ id: 'EmployeeImportColumn' });
// رموز أخطاء الصف: الـ UI يترجمها من مفاتيح i18n مع رقم الصف والعمود.
export const employeeImportErrorCode = z
  .enum([
    'IMPORT_REQUIRED_CELL',
    'IMPORT_NAME_INVALID',
    'IMPORT_ROLE_INVALID',
    'IMPORT_DATE_INVALID',
    'IMPORT_CELL_INVALID',
    'IMPORT_COLUMN_UNEXPECTED',
    'IMPORT_BRANCH_NOT_FOUND',
    'IMPORT_CONTRACT_END_BEFORE_HIRE',
  ])
  .meta({ id: 'EmployeeImportErrorCode' });
export const employeeImportRowError = z
  .strictObject({
    row: z.number().int().min(2),
    column: employeeImportColumn,
    code: employeeImportErrorCode,
  })
  .meta({ id: 'EmployeeImportRowError' });

export const employeeImportTemplate = z
  .strictObject({
    file_name: z.string().min(1).max(255),
    content_type: z.literal('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    content_base64: z.string().min(1),
  })
  .meta({ id: 'EmployeeImportTemplate' });

export const previewEmployeeImportInput = z
  .strictObject({ file_id: id })
  .meta({ id: 'PreviewEmployeeImportInput' });

export const employeeImportPreview = z
  .strictObject({
    preview_id: id,
    row_count: z.number().int().min(0).max(500),
    error_count: z.number().int().min(0),
    errors: z.array(employeeImportRowError).max(5000),
  })
  .meta({ id: 'EmployeeImportPreview' });

export const commitEmployeeImportInput = z
  .strictObject({ preview_id: id })
  .meta({ id: 'CommitEmployeeImportInput' });

export const employeeImportCommit = z
  .strictObject({
    preview_id: id,
    created_count: z.number().int().min(0).max(500),
    employee_ids: z.array(id).max(500),
  })
  .meta({ id: 'EmployeeImportCommit' });

// الطلب يقبل مرة واحدة؛ النتيجة النهائية تقرأ من حالة المعاينة بعد تنفيذ الوظيفة.
export const employeeImportCommitAccepted = z
  .strictObject({ preview_id: id })
  .meta({ id: 'EmployeeImportCommitAccepted' });
export const employeeImportStatus = z
  .strictObject({
    preview_id: id,
    status: z.enum(['ready', 'commit_requested', 'committed', 'failed']),
    created_count: z.number().int().min(0).max(500),
    error_code: z
      .enum([
        'EMPLOYEE_BRANCH_NOT_FOUND',
        'IMPORT_PREVIEW_HAS_ERRORS',
        'IMPORT_PREVIEW_EXPIRED',
        'EMPLOYEE_CONTRACT_END_BEFORE_HIRE',
        'IMPORT_COMMIT_FAILED',
      ])
      .nullable(),
  })
  .meta({ id: 'EmployeeImportStatus' });
export const employeeImportCommitJob = z
  .strictObject({ companyId: id, previewId: id })
  .meta({ id: 'EmployeeImportCommitJob' });

export type EmployeeImportColumn = z.infer<typeof employeeImportColumn>;
export type EmployeeImportErrorCode = z.infer<typeof employeeImportErrorCode>;
export type EmployeeImportRowError = z.infer<typeof employeeImportRowError>;
export type PreviewEmployeeImportInput = z.infer<typeof previewEmployeeImportInput>;
export type EmployeeImportPreview = z.infer<typeof employeeImportPreview>;
export type EmployeeImportTemplate = z.infer<typeof employeeImportTemplate>;
export type CommitEmployeeImportInput = z.infer<typeof commitEmployeeImportInput>;
export type EmployeeImportCommit = z.infer<typeof employeeImportCommit>;
export type EmployeeImportCommitAccepted = z.infer<typeof employeeImportCommitAccepted>;
export type EmployeeImportStatus = z.infer<typeof employeeImportStatus>;
