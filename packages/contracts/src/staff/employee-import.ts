import { z } from 'zod';

import { id } from '../scalars/id.js';

// ترتيب الأعمدة الإنجليزي هو المرجع؛ صف العناوين العربي الثاني للقراءة فقط ولا يُقرأ.
export const employeeImportColumn = z
  .enum(['name_en', 'name_ar', 'role_code', 'hire_date', 'contract_end', 'primary_branch'])
  .meta({ id: 'EmployeeImportColumn' });
// رموز أخطاء الصف: الـ UI يترجمها من مفاتيح i18n مع رقم الصف والعمود.
export const employeeImportErrorCode = z
  .enum([
    'IMPORT_REQUIRED_CELL',
    'IMPORT_NAME_INVALID',
    'IMPORT_ROLE_INVALID',
    'IMPORT_DATE_INVALID',
    'IMPORT_CELL_INVALID',
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
    content_type: z.literal(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ),
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

export type EmployeeImportColumn = z.infer<typeof employeeImportColumn>;
export type EmployeeImportErrorCode = z.infer<typeof employeeImportErrorCode>;
export type EmployeeImportRowError = z.infer<typeof employeeImportRowError>;
export type PreviewEmployeeImportInput = z.infer<typeof previewEmployeeImportInput>;
export type EmployeeImportPreview = z.infer<typeof employeeImportPreview>;
export type EmployeeImportTemplate = z.infer<typeof employeeImportTemplate>;
export type CommitEmployeeImportInput = z.infer<typeof commitEmployeeImportInput>;
export type EmployeeImportCommit = z.infer<typeof employeeImportCommit>;
