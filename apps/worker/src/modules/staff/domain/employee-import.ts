/** صف ثابت تحقق منه API؛ لا يعيد العامل تفسير قواعد إنشاء الموظف. */
export interface ImportEmployeeRow {
  readonly primary_branch_id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly role_code: string;
  readonly hire_date: string;
  readonly contract_end: string | null;
}

/** بيانات الكتابة المضافة إلى الصف المحقق وقت الالتزام. */
export interface ImportedEmployeeRecord extends ImportEmployeeRow {
  readonly id: string;
  readonly business_id: string;
  readonly user_id: null;
  readonly created_at: string;
}

/** معاينة موظفين محفوظة بعد التحقق، بلا أعمدة رواتب أو ربط مستخدم. */
export interface ImportCommitPreview {
  readonly id: string;
  readonly business_id: string;
  readonly created_by: string;
  readonly status: string;
  readonly expires_at: Date | string;
  readonly requested_at: Date | string;
  readonly errors: readonly unknown[];
  readonly rows: readonly ImportEmployeeRow[];
}

/**
 * الطلب المقبول قبل انتهاء المعاينة يبقى صالحاً رغم تأخر العامل؛ المساواة منتهية.
 *
 * @param preview المعاينة ولحظة قبولها المحفوظة
 * @returns لا شيء عند صلاحية الطلب، وإلا رفض انتهاء مسمى
 */
export function requireAcceptedImportExpiry(preview: ImportCommitPreview): void {
  if (new Date(preview.expires_at).getTime() <= new Date(preview.requested_at).getTime())
    throw new ImportCommitError('IMPORT_PREVIEW_EXPIRED');
}

/**
 * لا يعيد العامل قواعد الصف الثابت؛ فقط يثبت وجود فرعه ضمن المفاتيح المقفلة للنشاط.
 *
 * @param rows الصفوف التي تحقق منها API
 * @param branches معرفات الفروع الحالية تحت KEY SHARE
 * @returns لا شيء عند وجود جميع الفروع، وإلا رفض موحد
 */
export function requireImportBranches(
  rows: readonly ImportEmployeeRow[],
  branches: ReadonlySet<string>,
): void {
  if (rows.some((row) => !branches.has(row.primary_branch_id)))
    throw new ImportCommitError('EMPLOYEE_BRANCH_NOT_FOUND');
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
