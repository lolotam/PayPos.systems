import { LogoFileRejected } from './errors.ts';

/**
 * حقائق الربط من غير الحجم ومفتاح التخزين: السعة اتفحصت قبل READY، والمفتاح ما يطلعش من settings.
 */
export interface LogoFileFacts {
  readonly businessId: string;
  readonly branchId: string | null;
  readonly ownerModule: string;
  readonly ownerEntityId: string;
  readonly requiredPermission: string;
  readonly createdBy: string;
  readonly contentType: string;
  readonly status: 'PENDING' | 'VERIFYING' | 'READY' | 'REJECTED';
  readonly purged: boolean;
  readonly purgeStarted: boolean;
}

const LOGO_PERMISSION = 'read:settings:business';

function matchesLogoIdentity(file: LogoFileFacts, businessId: string, actorId: string): boolean {
  return (
    file.purged === false &&
    file.purgeStarted === false &&
    file.ownerModule === 'settings' &&
    file.ownerEntityId === businessId &&
    file.businessId === businessId &&
    file.branchId === null &&
    file.createdBy === actorId &&
    file.requiredPermission === LOGO_PERMISSION &&
    (file.contentType === 'image/png' || file.contentType === 'image/jpeg')
  );
}

/**
 * بيقبل ملف شعار جاهز ملك النشاط والفاعل، ويرفض غيره من غير ما يميّز السبب.
 * أي اختلاف في الملكية أو النوع أو الحذف، أو حالة REJECTED، يجاوب زي ملف مجهول؛ PENDING و VERIFYING بس يجاوبوا إن الملف لسه بيتجهز، لأن المرفوض مش هيبقى READY أبداً.
 * مفيش فحص حجم هنا: الملف الجاهز عدّى سقف العشرة ميجا العام قبل ما يبقى READY.
 *
 * @param file حقائق الملف من غير الحجم ومفتاح التخزين
 * @param businessId النشاط في المسار
 * @param actorId المستخدم اللي بيربط
 * @returns لا شيء عند القبول
 */
export function validateLogoFile(file: LogoFileFacts, businessId: string, actorId: string): void {
  if (!matchesLogoIdentity(file, businessId, actorId)) throw new LogoFileRejected('FILE_NOT_FOUND');
  if (file.status === 'PENDING' || file.status === 'VERIFYING') {
    throw new LogoFileRejected('FILE_NOT_READY');
  }
  if (file.status !== 'READY') throw new LogoFileRejected('FILE_NOT_FOUND');
}
