import type { EmployeeRecord } from '@pospay/domain';

/** معاينة موظفين محفوظة بعد التحقق، بلا أعمدة رواتب أو ربط مستخدم. */
export interface ImportCommitPreview {
  readonly id: string;
  readonly business_id: string;
  readonly created_by: string;
  readonly status: string;
  readonly expires_at: Date | string;
  readonly errors: readonly unknown[];
  readonly rows: readonly Omit<EmployeeRecord, 'id' | 'business_id' | 'user_id' | 'created_at'>[];
}

/** رفض ثابت يحفظ في الحالة بعد تراجع معاملة الإنشاء بالكامل. */
export class ImportCommitError extends Error {
  /** ينشئ سبب رفض لا يحتوي على صفوف الموظفين أو معاملات قاعدة البيانات. */
  constructor(
    readonly code:
      'EMPLOYEE_BRANCH_NOT_FOUND' | 'IMPORT_PREVIEW_HAS_ERRORS' | 'IMPORT_PREVIEW_EXPIRED',
  ) {
    super(code);
  }
}
