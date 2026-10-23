import {
  arabicDisplayName,
  DEFAULT_NAME_FALLBACK,
  englishDisplayName,
  type NameFallback,
} from './not-clocked-in.ts';

/**
 * جرس انتهاء المستند (spec 060 §B.4، AL-Q8 وAL-Q7): الموظفة ونوع المستند وتاريخ الانتهاء بالظبط.
 * المستلمون: الدور يختار المرشحين من مديري فرع الموظفة الأصلي، والصلاحية (read:files:business) تفلترهم.
 */

/** الأسماء العامة لجرس المستند: الموظفة والفرع ونوع المستند. */
export interface DocumentNameFallback extends NameFallback {
  readonly documentAr: string;
  readonly documentEn: string;
}

/** الأسماء العامة الافتراضية لجرس المستند: أسماء الأجراس العامة ونوع المستند. */
export const SAFE_DOCUMENT_NAME_FALLBACK: DocumentNameFallback = {
  ...DEFAULT_NAME_FALLBACK,
  documentAr: 'Document',
  documentEn: 'Document',
};

/** معامل جرس انتهاء المستند: الموظفة ونوع المستند وتاريخ الانتهاء ومعرّف المستند. */
export interface DocumentExpiryParameter {
  readonly name:
    | 'employee_name_ar'
    | 'employee_name_en'
    | 'document_type_ar'
    | 'document_type_en'
    | 'expires_on'
    | 'document_id';
  readonly type: 'text';
  readonly value: string;
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DOCUMENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * من يصل جرس انتهاء المستند: الدور يختار المرشحين والصلاحية تفلترهم (AL-Q7).
 * القاعدة بلا أدوار (الافتراضي) توصل لكل من يملك صلاحية read:files:business على النشاط.
 * وبأدوار توصل للمرشحين منهم فقط: مدير الفرع بلا صلاحية لا يستلم، وصاحب الصلاحية خارج الأدوار لا يستلم.
 *
 * @param roles أدوار القاعدة الفعلية؛ فارغة تعني كل أصحاب الصلاحية
 * @param candidates المرشحون بالأدوار (مديرو فرع الموظفة الأصلي)
 * @param holders أصحاب صلاحية read:files:business على النشاط
 * @returns معرّفات المستلمين مرتبة بلا تكرار
 */
export function documentExpiryRecipients(
  roles: readonly string[],
  candidates: readonly string[],
  holders: readonly string[],
): readonly string[] {
  const unique = [...new Set(holders)];
  if (roles.length === 0) return unique.sort();
  const allowed = new Set(candidates);
  return unique.filter((userId) => allowed.has(userId)).sort();
}

/**
 * معاملات جرس انتهاء المستند: الموظفة ونوع المستند وتاريخ الانتهاء بالظبط ومعرّف المستند.
 * اسم مرفوض لا يُسقط الجرس، وتاريخ أو معرّف مش بصيغتيهما يوقف الجرس كله.
 *
 * @param employeeNameAr اسم الموظف العربي أو null
 * @param employeeNameEn اسم الموظف الإنجليزي
 * @param typeNameAr اسم نوع المستند العربي أو null
 * @param typeNameEn اسم نوع المستند الإنجليزي
 * @param expiresOn تاريخ الانتهاء بصيغة YYYY-MM-DD
 * @param documentId معرّف المستند
 * @param fallback الأسماء العامة من كتالوج اللغتين
 * @returns المعاملات بالترتيب، أو null إذا لم يخرج تاريخ أو معرّف بصيغتيهما
 */
export function documentExpiringParameters(
  employeeNameAr: string | null,
  employeeNameEn: string,
  typeNameAr: string | null,
  typeNameEn: string,
  expiresOn: string,
  documentId: string,
  fallback: DocumentNameFallback = SAFE_DOCUMENT_NAME_FALLBACK,
): readonly DocumentExpiryParameter[] | null {
  if (!realDate(expiresOn) || !DOCUMENT_UUID.test(documentId)) return null;
  return [
    named(
      'employee_name_ar',
      arabicDisplayName(employeeNameAr, employeeNameEn, fallback.employeeAr),
    ),
    named('employee_name_en', englishDisplayName(employeeNameEn, fallback.employeeEn)),
    named('document_type_ar', arabicDisplayName(typeNameAr, typeNameEn, fallback.documentAr)),
    named('document_type_en', englishDisplayName(typeNameEn, fallback.documentEn)),
    named('expires_on', expiresOn),
    named('document_id', documentId),
  ];
}

function named(name: DocumentExpiryParameter['name'], value: string): DocumentExpiryParameter {
  return { name, type: 'text', value };
}

function realDate(value: string): boolean {
  if (!LOCAL_DATE.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(at.getTime()) && at.toISOString().slice(0, 10) === value;
}
