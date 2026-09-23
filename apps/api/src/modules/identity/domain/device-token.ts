// صلاحية توكن الجهاز (PRD D-09، قرار Waleed 2026-09-23): 30 يوم، وبتتجدد مع كل اتصال.
export const DEVICE_TOKEN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * بيحسب لحد إمتى توكن الجهاز صالح بعد اتصال — كل اتصال بيبدأ الـ 30 يوم من الأول، فالجهاز الشغال عمره ما بيخرج،
 * والجهاز اللي اختفى 30 يوم بيحتاج pairing جديد.
 *
 * @param contactAt لحظة الاتصال (أو لحظة استلام التوكن أول مرة)
 * @returns آخر لحظة التوكن صالح فيها
 */
export function deviceTokenExpiry(contactAt: Date): Date {
  return new Date(contactAt.getTime() + DEVICE_TOKEN_DAYS * DAY_MS);
}

/**
 * هل التوكن لسه صالح في اللحظة دي — لحظة الانتهاء نفسها مش صالحة.
 *
 * @param expiresAt آخر لحظة صلاحية متخزنة
 * @param now       لحظة الطلب
 * @returns true لو لسه صالح
 */
export function isDeviceTokenLive(expiresAt: Date, now: Date): boolean {
  return now.getTime() < expiresAt.getTime();
}
