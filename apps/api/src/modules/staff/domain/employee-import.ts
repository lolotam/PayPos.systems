import type { EmployeeRecord } from './create-employee.ts';

// TODO(spec) IM-Q1: لا عمود user_id/هاتف هنا؛ ربط الموظف بمستخدم قائم يبقى تعديلاً صريحاً في spec 017.
// TODO(spec) IM-Q3: مدة الاحتفاظ بالمعاينات ووظيفة الحذف بصلاحيتها تُحسم في شريحة لاحقة؛ المقترح 30 يوماً بعد الانتهاء.
/** أعمدة قالب الموظفين بالترتيب المرجعي (PR 11 rule 3)؛ لا راتب ولا صلاحيات ولا ربط مستخدم. */
export const EMPLOYEE_IMPORT_HEADERS = [
  'name_en',
  'name_ar',
  'role_code',
  'hire_date',
  'contract_end',
  'primary_branch',
] as const;

/** أعمدة ورقة الموظفين كما يعرفها المستورد. */
export type EmployeeImportColumn = (typeof EMPLOYEE_IMPORT_HEADERS)[number] | 'unexpected_column';

/** أسباب رفض خلية أو صف، مطابقة لعقد الـ API (employeeImportErrorCode). */
export type EmployeeImportErrorCode =
  | 'IMPORT_REQUIRED_CELL'
  | 'IMPORT_NAME_INVALID'
  | 'IMPORT_ROLE_INVALID'
  | 'IMPORT_DATE_INVALID'
  | 'IMPORT_CELL_INVALID'
  | 'IMPORT_COLUMN_UNEXPECTED'
  | 'IMPORT_BRANCH_NOT_FOUND'
  | 'IMPORT_CONTRACT_END_BEFORE_HIRE';

/** خطأ صف/عمود مسمّى يعرضه الـ UI مترجماً من مفاتيح i18n. */
export interface EmployeeImportRowError {
  readonly row: number;
  readonly column: EmployeeImportColumn;
  readonly code: EmployeeImportErrorCode;
}

/** سجل موظف جاهز للإنشاء بعد التحقق، بلا أي حقل مالي أو اعتماد دخول. */
export interface EmployeeImportCandidate {
  readonly row: number;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly role_code: EmployeeRecord['role_code'];
  readonly hire_date: string;
  readonly contract_end: string | null;
  readonly primary_branch_id: string;
}

/** الحد الأقصى لحجم ملف الاستيراد (PR 11 rule 2). */
export const EMPLOYEE_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
/** حد صفوف الموظفين من قرار المالك؛ المستوردون الآخرون يمررون حدودهم للمحرك العام. */
export const IMPORT_MAX_ROWS = 500;
/** نوع محتوى مصنف الاستيراد الوحيد المقبول. */
export const EMPLOYEE_IMPORT_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** حقائق ملف الاستيراد الموثّق كما تقرأها files داخل معاملة الشركة. */
export interface EmployeeImportFileFacts {
  readonly business_id: string;
  readonly created_by: string;
  readonly content_type: string;
  readonly size_bytes: number;
  readonly status: 'PENDING' | 'VERIFYING' | 'READY' | 'REJECTED';
  readonly storage_key: string | null;
  readonly purged: boolean;
}

/** رفض استيراد آمن لا يحمل بيانات صفوف، ويترجم إلى الغلاف ثنائي اللغة في الـ controller. */
export class EmployeeImportError extends Error {
  /**
   * ينشئ رفضاً مسمّى للاستيراد دون كشف تفاصيل ملف أو شركة أخرى.
   *
   * @param code سبب الرفض الآمن
   */
  constructor(
    readonly code:
      | 'IMPORT_FILE_NOT_FOUND'
      | 'IMPORT_FILE_NOT_READY'
      | 'IMPORT_FILE_TYPE_INVALID'
      | 'IMPORT_FILE_SIZE_INVALID'
      | 'IMPORT_FILE_CONTENT_INVALID'
      | 'STORAGE_UNAVAILABLE'
      | 'IMPORT_HEADER_INVALID'
      | 'IMPORT_ROW_LIMIT_EXCEEDED'
      | 'IMPORT_PREVIEW_NOT_FOUND'
      | 'IMPORT_PREVIEW_EXPIRED'
      | 'IMPORT_PREVIEW_HAS_ERRORS'
      | 'EMPLOYEE_BRANCH_NOT_FOUND'
      | 'FEATURE_DISABLED'
      | 'FORBIDDEN'
      | 'TRANSACTION_RETRY_REQUIRED',
  ) {
    super(code);
    this.name = 'EmployeeImportError';
  }
}

/**
 * يتأكد أن الملف موثّق وREADY ورفعه المستدعي نفسه لنشاط الاستيراد، وأن نوعه وحجمه داخل حدود الاستيراد.
 * كل رفض للملكية أو الوجود يظهر كـ IMPORT_FILE_NOT_FOUND واحد حتى لا يكشف وجود ملف شركة أخرى.
 *
 * @param facts حقائق الملف من files
 * @param businessId النشاط المستهدف
 * @param userId المستورد
 * @returns لا شيء عند الصلاحية أو رفض مسمّى
 */
export function validateEmployeeImportFile(
  facts: EmployeeImportFileFacts | null,
  businessId: string,
  userId: string,
): void {
  if (
    facts === null ||
    facts.purged ||
    facts.business_id !== businessId ||
    facts.created_by !== userId
  )
    throw new EmployeeImportError('IMPORT_FILE_NOT_FOUND');
  if (facts.status !== 'READY') throw new EmployeeImportError('IMPORT_FILE_NOT_READY');
  if (facts.content_type !== EMPLOYEE_IMPORT_CONTENT_TYPE)
    throw new EmployeeImportError('IMPORT_FILE_TYPE_INVALID');
  // bigint قد يعود كنص من السائق؛ الحد الحقيقي هنا لا يتجاوز 2 MiB.
  const size = Number(facts.size_bytes);
  if (!Number.isSafeInteger(size) || size <= 0 || size > EMPLOYEE_IMPORT_MAX_BYTES)
    throw new EmployeeImportError('IMPORT_FILE_SIZE_INVALID');
  if (facts.storage_key === null) throw new EmployeeImportError('IMPORT_FILE_NOT_FOUND');
}

/**
 * يبني خريطة اسم الفرع (إنجليزي أو عربي) إلى معرفه؛ الاسم المكرر أو الفارغ لا يُخمّن.
 *
 * @param branches فروع النشاط من describeWorkspaces
 * @returns خريطة بحروف صغيرة للأسماء الفريدة فقط
 */
export function branchNameIndex(
  branches: readonly {
    readonly id: string;
    readonly name_en: string;
    readonly name_ar: string | null;
  }[],
): Map<string, string> {
  const index = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const branch of branches) {
    for (const name of [branch.name_en, branch.name_ar]) {
      const key = name?.trim().toLowerCase();
      if (key === undefined || key === '') continue;
      if (index.has(key) || ambiguous.has(key)) {
        index.delete(key);
        ambiguous.add(key);
        continue;
      }
      index.set(key, branch.id);
    }
  }
  return index;
}
