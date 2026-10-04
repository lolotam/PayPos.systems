import { DocumentError, type DocumentTypeRecord } from './document-types.ts';
import { scheduleToday } from './schedule-calendar.ts';

/** وثيقة موظف كما تحفظها staff: مفتاح النسخة الموثقة فقط، دون أي محتوى. */
export type EmployeeDocumentRecord = {
  id: string;
  business_id: string;
  employee_id: string;
  type_code: string;
  object_key: string;
  expires_on: string | null;
  uploaded_by: string;
  recorded_at: string;
  replaced_at: string | null;
};

/** ما تعرفه staff عن ملف مرفوع قبل ربطه؛ يأتي من files داخل نفس معاملة الشركة. */
export interface DocumentFileFacts {
  business_id: string;
  branch_id: string | null;
  owner_module: string;
  owner_entity_id: string;
  required_permission: string;
  created_by: string;
  status: 'PENDING' | 'VERIFYING' | 'READY' | 'REJECTED';
  storage_key: string | null;
  purged: boolean;
}

/** حالة الوثيقة كما تظهر في شارة الشاشة وكما سيقرؤها job الانتهاء. */
export type DocumentStatus = 'NO_EXPIRY' | 'VALID' | 'EXPIRING' | 'EXPIRED';

const DAY_MS = 86_400_000;

/**
 * يقبل فقط ملفاً رفعه نفس المسجل لهذا الموظف بنفس النشاط وبصلاحية القراءة المحفوظة؛
 * أي اختلاف يُعامل كأنه غير موجود حتى لا يكشف وجود ملفات غيره.
 *
 * @param file حقائق الملف من files أو null إن لم يوجد في الشركة
 * @param expected النشاط والموظف والمستخدم الموثقون
 * @param expected.businessId نشاط الموظف المحفوظ
 * @param expected.employeeId الموظف المقفول
 * @param expected.userId المسجل الموثق من الجلسة
 * @returns مفتاح النسخة الموثقة الذي ستحفظه staff
 */
export function requireDocumentFile(
  file: DocumentFileFacts | null,
  expected: { businessId: string; employeeId: string; userId: string },
): string {
  // قرار المالك 2026-10-04 (DOC-Q4، الخيار الموصى به): الربط مقصور على من رفع الملف؛ ملف أعده شخص آخر لا يُسجل باسم غيره.
  if (
    file === null ||
    file.purged ||
    file.owner_module !== 'staff' ||
    file.owner_entity_id !== expected.employeeId ||
    file.business_id !== expected.businessId ||
    file.branch_id !== null ||
    file.required_permission !== 'read:files:business' ||
    file.created_by !== expected.userId
  )
    throw new DocumentError('NOT_FOUND');
  if (file.status !== 'READY' || file.storage_key === null)
    throw new DocumentError('FILE_NOT_READY');
  return file.storage_key;
}

function realDate(value: string): boolean {
  const at = new Date(`${value}T00:00:00Z`);
  return (
    /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(at.getTime()) &&
    at.toISOString().slice(0, 10) === value
  );
}

/**
 * يتحقق من صلاحية النوع للتسجيل وتاريخ الانتهاء؛ التاريخ الماضي مقبول وتسجل الوثيقة منتهية.
 *
 * @param type نوع الوثيقة بالكود المطلوب أو null
 * @param expiresOn تاريخ الانتهاء أو null
 * @returns النوع المفعل وتاريخ الانتهاء بعد التحقق
 */
export function validateDocumentRecord(
  type: DocumentTypeRecord | null,
  expiresOn: string | null,
): { type: DocumentTypeRecord; expiresOn: string | null } {
  if (type === null || !type.active) throw new DocumentError('DOCUMENT_TYPE_UNAVAILABLE');
  if (expiresOn === null) {
    if (type.requires_expiry) throw new DocumentError('DOCUMENT_EXPIRY_REQUIRED');
    return { type, expiresOn: null };
  }
  if (!realDate(expiresOn)) throw new DocumentError('VALIDATION_FAILED');
  return { type, expiresOn };
}

/**
 * وثيقة حالية واحدة لكل نوع: الجديدة تستبدل الحالية ويبقى سجل القديمة للتاريخ.
 *
 * @param current الوثيقة الحالية المقفولة لنفس الموظف والنوع أو null
 * @param next الوثيقة الجديدة قبل الحفظ
 * @returns السجل القديم بعد الاستبدال (أو null) والسجل الجديد الحالي
 */
export function replaceCurrentDocument(
  current: EmployeeDocumentRecord | null,
  next: EmployeeDocumentRecord,
): { replaced: EmployeeDocumentRecord | null; recorded: EmployeeDocumentRecord } {
  // قرار المالك 2026-10-04 (DOC-Q3، الخيار الموصى به): الاستبدال يحفظ التاريخ ويقبل انتهاءً ماضياً؛ عرض السجل القديم في الإدارة ينتظر شريحة لاحقة.
  if (current !== null && current.object_key === next.object_key)
    throw new DocumentError('DOCUMENT_FILE_ALREADY_RECORDED');
  return {
    replaced: current === null ? null : { ...current, replaced_at: next.recorded_at },
    recorded: { ...next, replaced_at: null },
  };
}

/**
 * تاريخ اليوم بتوقيت النشاط من الساعة المحقونة، فلا تتغير الشارة مع مكان الخادم أو المدير.
 *
 * @param now اللحظة المحقونة
 * @param timeZone منطقة النشاط
 * @returns اليوم المحلي YYYY-MM-DD
 */
export function documentToday(now: Date, timeZone: string): string {
  return scheduleToday(now, timeZone);
}

/**
 * حالة الوثيقة: منتهية بعد يوم انتهائها، وتقترب من الانتهاء خلال أيام تنبيه نوعها،
 * وإلا سارية. صفر أيام تنبيه يعني يوم الانتهاء نفسه فقط.
 *
 * @param expiresOn تاريخ الانتهاء أو null
 * @param alertDays أيام التنبيه الحالية للنوع
 * @param today اليوم المحلي للنشاط
 * @returns حالة الشارة
 */
export function documentStatus(
  expiresOn: string | null,
  alertDays: number,
  today: string,
): DocumentStatus {
  // قرار المالك 2026-10-04 (DOC-Q5، الخيار الموصى به): صفر أيام تنبيه يظهر "تقترب من الانتهاء" يوم الانتهاء نفسه فقط.
  if (expiresOn === null) return 'NO_EXPIRY';
  if (!realDate(today) || !realDate(expiresOn)) throw new DocumentError('VALIDATION_FAILED');
  const left = (Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS;
  if (left < 0) return 'EXPIRED';
  return left <= alertDays ? 'EXPIRING' : 'VALID';
}

/**
 * شكل الوثيقة في الرد: اسم النوع وحالته الحالية بجانب المفتاح الذي يفتح به المدير الملف عبر files.
 *
 * @param record الوثيقة الحالية
 * @param type نوعها
 * @param today اليوم المحلي للنشاط
 * @returns الوثيقة مع اسم النوع وحالة الشارة
 */
export function documentView(
  record: EmployeeDocumentRecord,
  type: DocumentTypeRecord,
  today: string,
) {
  return {
    id: record.id,
    employee_id: record.employee_id,
    type_code: record.type_code,
    type_name_en: type.name_en,
    type_name_ar: type.name_ar,
    object_key: record.object_key,
    expires_on: record.expires_on,
    uploaded_by: record.uploaded_by,
    recorded_at: record.recorded_at,
    status: documentStatus(record.expires_on, type.alert_days, today),
  };
}
