/** سجل الملف المعزول وحالته قبل إصدار قدرة التنزيل. */
export interface FileRecord {
  id: string;
  businessId: string;
  branchId: string | null;
  createdBy: string;
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
 * يثبت صلاحية القراءة المحفوظة على الملف حتى لا يُرفع بهوية أوسع من قراءة مالكه.
 * وثائق الموظفين تبقى على read:files:business (PR 7a)، وملفات الإعدادات على read:settings:business (spec 052).
 *
 * @param ownerModule الوحدة المالكة
 * @param permission الصلاحية التي سيحفظها الملف
 * @returns لا شيء؛ FORBIDDEN إذا خالفت الصلاحية نوع المالك المعروف
 */
export function validateStoredPermission(ownerModule: string, permission: string): void {
  if (ownerModule === 'staff' && permission !== 'read:files:business')
    throw new FileError('FORBIDDEN');
  if (ownerModule === 'settings' && permission !== 'read:settings:business')
    throw new FileError('FORBIDDEN');
}
