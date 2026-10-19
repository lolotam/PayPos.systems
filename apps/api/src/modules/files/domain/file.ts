/** سجل الملف المعزول وحالته قبل إصدار قدرة التنزيل. */
export interface FileRecord {
  id: string;
  businessId: string;
  branchId: string | null;
  createdBy: string;
  ownerModule: string;
  requiredPermission: string;
  stagingKey: string;
  storageKey: string | null;
  contentType: string;
  sizeBytes: number;
  status: 'PENDING' | 'VERIFYING' | 'READY' | 'REJECTED';
}
/** رفض آمن مستقل عن HTTP وتفاصيل مزود التخزين. */
export class FileError extends Error {
  /**
   * رمز رفض مستقل عن تفاصيل HTTP والمزود.
   *
   * @param code سبب الرفض
   */
  constructor(
    readonly code:
      'FILE_NOT_FOUND' | 'FILE_NOT_READY' | 'FORBIDDEN' | 'FILE_TYPE_INVALID' | 'FILE_SIZE_INVALID',
  ) {
    super(code);
  }
}
/**
 * النسخة المؤقتة لا تصبح قابلة للقراءة حتى نشر العامل لها.
 *
 * @param file سجل موثق من شركة المستدعي
 * @returns مفتاح النسخة الصالحة فقط
 */
export function readyKey(file: FileRecord): string {
  if (file.status !== 'READY' || file.storageKey === null) throw new FileError('FILE_NOT_READY');
  return file.storageKey;
}

/**
 * صلاحية فتح رفع ملف. شعار النشاط بقى على إدارة هوية النشاط لوحدها (BI-Q5)،
 * لأن قرار المالك يلغي تثبيت 27h-2 على قراءة الإعدادات؛ باقي الأنواع تفضل على إدارة الملفات.
 *
 * @param ownerModule الوحدة المالكة
 * @returns صلاحية الطلب: manage:business-identity:business لملفات الإعدادات، وإلا manage:files:business
 */
export function uploadAuthority(ownerModule: string): string {
  return ownerModule === 'settings' ? 'manage:business-identity:business' : 'manage:files:business';
}

/**
 * صلاحية قراءة الملف وقت الحالة والتنزيل. ملفات الإعدادات دايمًا على إدارة هوية النشاط (BI-Q5)،
 * حتى الصفوف القديمة المخزّنة قبل 27h-5 بصلاحية قراءة الإعدادات، من غير ترحيل للبيانات.
 *
 * @param ownerModule الوحدة المالكة
 * @param storedPermission الصلاحية المحفوظة على الصف
 * @returns صلاحية القراءة الفعالة: manage:business-identity:business للإعدادات، وإلا القيمة المحفوظة
 */
export function effectiveReadPermission(ownerModule: string, storedPermission: string): string {
  return ownerModule === 'settings' ? uploadAuthority(ownerModule) : storedPermission;
}

/** حقائق طلب الرفع اللي بتحدد شكل ملف الإعدادات. */
export interface SettingsUploadFacts {
  ownerModule: string;
  ownerEntityId: string;
  branchId: string | null;
  contentType: string;
}

/**
 * ملف الإعدادات الوحيد هو شعار النشاط، فطلب رفعه لازم يكون على شكل الشعار.
 * من غير الفحص ده صلاحية هوية النشاط لوحدها كانت هتخزّن أي ملف أو PDF على فرع أو كيان تاني (BI-Q5).
 *
 * @param input وحدة المالك وكيانه والفرع ونوع المحتوى في طلب الرفع
 * @param businessId النشاط في المسار
 * @returns لا شيء؛ FORBIDDEN لو الكيان مش النشاط أو فيه فرع، وFILE_TYPE_INVALID لو النوع مش PNG أو JPEG
 */
export function validateSettingsUpload(input: SettingsUploadFacts, businessId: string): void {
  if (input.ownerModule !== 'settings') return;
  if (input.branchId !== null || input.ownerEntityId.toLowerCase() !== businessId.toLowerCase())
    throw new FileError('FORBIDDEN');
  if (input.contentType !== 'image/png' && input.contentType !== 'image/jpeg')
    throw new FileError('FILE_TYPE_INVALID');
}

/**
 * يثبت الصلاحية المحفوظة على الملف حتى لا يخزّن نوع معروف بصلاحية غير صلاحيته.
 * وثائق الموظفين تبقى على read:files:business (PR 7a)، وملفات الإعدادات على manage:business-identity:business (BI-Q5).
 *
 * @param ownerModule الوحدة المالكة
 * @param permission الصلاحية التي سيحفظها الملف
 * @returns لا شيء؛ FORBIDDEN إذا خالفت الصلاحية نوع المالك المعروف
 */
export function validateStoredPermission(ownerModule: string, permission: string): void {
  if (ownerModule === 'staff' && permission !== 'read:files:business')
    throw new FileError('FORBIDDEN');
  if (ownerModule === 'settings' && permission !== uploadAuthority(ownerModule))
    throw new FileError('FORBIDDEN');
}
