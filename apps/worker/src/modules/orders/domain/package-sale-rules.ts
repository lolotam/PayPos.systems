import { SessionTimeError, sessionTime, type SalePackageType } from '@pospay/domain';
import { PackageSaleError } from './package-sale-errors.ts';

/** حقائق البائعة التي تقرأها قواعد البيع بعد قفلها، دون بيانات الحضور أو أسماء API. */
export interface PackageSellerFacts {
  readonly id: string;
  readonly user_id: string | null;
  readonly eligible: boolean;
}

/**
 * البيع يتبع نافذة الزيارة، لكن رفض العمر والمستقبل له كود خاص بالباقة.
 *
 * @param soldAt لحظة البيع أو غيابها لاستخدام وقت التسجيل
 * @param recordedAt ساعة السيرفر الجديدة بعد الأقفال
 * @param timezone توقيت فرع البيع الفعلي بعد حل fallback خارج الدومين
 * @returns وقت مطبّع ويوم البيع المحلي وراية التأخر
 */
export function packageSaleTime(soldAt: Date | undefined, recordedAt: Date, timezone: string) {
  try {
    return sessionTime(soldAt, recordedAt, timezone);
  } catch (error) {
    if (error instanceof SessionTimeError && error.code === 'SESSION_TIME_TOO_OLD') {
      throw new PackageSaleError('PACKAGE_SALE_TOO_OLD');
    }
    if (error instanceof SessionTimeError && error.code === 'SESSION_TIME_IN_FUTURE') {
      throw new PackageSaleError('PACKAGE_SALE_IN_FUTURE');
    }
    throw error;
  }
}

/**
 * نسخة النوع تُفحص قبل نسخ الخدمات؛ المجموعة لازم تطابق العرض كله حتى لو الأسعار متساوية.
 *
 * @param type النوع وخدماته بعد أقفال الكتالوج
 * @param expectedTypeRevision نسخة النوع التي أكدها الاستقبال
 * @param expectedServices مجموعة الخدمات ونسخها التي أكدها الاستقبال
 * @returns لا شيء؛ العرض القديم يُرفض ومعه النسخ الحالية
 */
export function assertPackageSaleQuote(
  type: SalePackageType,
  expectedTypeRevision: number,
  expectedServices: readonly { service_id: string; revision: number }[],
): void {
  if (type.revision !== expectedTypeRevision) {
    throw new PackageSaleError('PACKAGE_TYPE_REVISION_CONFLICT', {
      current_revision: type.revision,
    });
  }
  const current = type.components.map(({ service_id, service }) => ({
    service_id,
    revision: service.revision,
  }));
  const expected = new Map(
    expectedServices.map(({ service_id, revision }) => [service_id, revision]),
  );
  if (
    expectedServices.length !== current.length ||
    expected.size !== current.length ||
    current.some(({ service_id, revision }) => expected.get(service_id) !== revision)
  ) {
    throw new PackageSaleError('PACKAGE_SALE_QUOTE_STALE', { current_service_revisions: current });
  }
}

/**
 * الأهلية تسبق منع البيع للنفس؛ المالك لا يتجاوز المنع، والموظفة بلا حساب مسموحة.
 *
 * @param seller حقائق البائعة المؤرخة بعد قفلها، أو غيابها
 * @param recorderUserId حساب المسجّلة الفعلي لا العضوية المختارة
 * @returns لقطة رابط حساب البائعة لحفظها مع البيع
 */
export function checkPackageSeller(
  seller: PackageSellerFacts | undefined,
  recorderUserId: string,
): string | null {
  if (!seller?.eligible) throw new PackageSaleError('PACKAGE_SELLER_NOT_ELIGIBLE');
  if (seller.user_id === recorderUserId)
    throw new PackageSaleError('PACKAGE_SELLER_SELF_FORBIDDEN');
  return seller.user_id;
}
