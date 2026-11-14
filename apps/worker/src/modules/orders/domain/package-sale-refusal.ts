import type { PackageErrorCode } from '@pospay/domain';

const MAP = {
  INVALID_PRICE: 'PACKAGE_TYPE_PRICE_INVALID',
  INVALID_COMPONENTS: 'PACKAGE_TYPE_INVALID_COMPONENTS',
  DUPLICATE_SERVICE: 'PACKAGE_TYPE_DUPLICATE_SERVICE',
  INVALID_SESSIONS: 'PACKAGE_TYPE_INVALID_SESSIONS',
  INVALID_REMAINING_SESSIONS: null,
  INVALID_SLOTS: 'PACKAGE_TYPE_INVALID_SESSIONS',
  INVALID_DATE: 'PACKAGE_TYPE_VALIDITY_INVALID',
  PACKAGE_EXPIRED: null,
  PACKAGE_EXTENSION_NOT_LATER: null,
  PACKAGE_EXTENSION_TOO_LONG: null,
  INSUFFICIENT_SLOTS: null,
} as const satisfies Record<PackageErrorCode, string | null>;

/**
 * بيحوّل خطأ قاعدة باقة وصل أثناء البيع إلى كود الرفض العام المناسب.
 * القواعد اللي بترجع `null` البيع مستحيل يوصلها، لذلك ظهورها كسر لثابت داخلي مش رفض مسمّى.
 *
 * @param code كود قاعدة الباقة التي فشلت أثناء تنفيذ البيع
 * @returns كود الرفض العام، أو `null` عندما يمثل الخطأ كسرًا لثابت داخلي
 */
export function packageSaleRefusalCode(code: PackageErrorCode): (typeof MAP)[PackageErrorCode] {
  return MAP[code];
}
