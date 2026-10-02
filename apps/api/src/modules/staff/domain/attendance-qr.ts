/** مدة نافذة إثبات الحضور حسب SPEC؛ التحقق بيقبل الحالية والسابقة فقط. */
export const ATTENDANCE_QR_WINDOW_MS = 60_000;
const DAY_MS = 86_400_000;

/** نطاق سر يومي منفصل لكل شركة وفرع، مع نهاية الاحتفاظ اللازمة لقبول آخر نافذة. */
export interface QrSecretScope {
  readonly companyId: string;
  readonly branchId: string;
  readonly day: number;
  readonly retainUntil: number;
}

/** بيانات عرض الفرع الموثق؛ توقيت العرض منفصل عن دورة السر اليومي. */
export interface QrBranch {
  readonly id: string;
  readonly name_ar: string | null;
  readonly name_en: string;
  readonly effective_timezone: string;
}

/**
 * بيحسب نافذة الرمز من وقت السيرفر عشان كل أجهزة الفرع تعرض نفس الإثبات.
 *
 * @param now لحظة السيرفر بالمللي ثانية من بداية Unix
 * @returns رقم نافذة الستين ثانية
 */
export function attendanceQrWindow(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000 - DAY_MS) {
    throw new RangeError('Invalid attendance clock');
  }
  return Math.floor(now / ATTENDANCE_QR_WINDOW_MS);
}

/**
 * بيحدد توقيت تجديد الشاشة وانتهاء قبول النافذة السابقة من نفس وقت السيرفر.
 *
 * @param now لحظة الإصدار بالمللي ثانية
 * @returns وقت السيرفر وحدود عرض وقبول الرمز بصيغة UTC
 */
export function attendanceQrTiming(now: number) {
  const window = attendanceQrWindow(now);
  return {
    window,
    server_time: new Date(now).toISOString(),
    refresh_at: new Date((window + 1) * ATTENDANCE_QR_WINDOW_MS).toISOString(),
    expires_at: new Date((window + 2) * ATTENDANCE_QR_WINDOW_MS).toISOString(),
  };
}

/**
 * بيقبل الفرع المقصود والنافذة الحالية أو السابقة فقط؛ الصورة الأقدم مابتثبتش الحضور.
 *
 * @param branchId الفرع اللي إجراء الحضور هيشتغل عليه
 * @param token الرمز اللي اتقرا من الشاشة
 * @param token.branch_id الفرع المكتوب في الرمز
 * @param token.window النافذة المكتوبة في الرمز
 * @param now وقت التحقق من السيرفر
 * @returns هل الفرع والنافذة ينفعوا قبل فحص التوقيع
 */
export function acceptsAttendanceQrWindow(
  branchId: string,
  token: { readonly branch_id: string; readonly window: number },
  now: number,
): boolean {
  const current = attendanceQrWindow(now);
  return (
    token.branch_id === branchId &&
    Number.isSafeInteger(token.window) &&
    token.window >= 0 &&
    (token.window === current || token.window === current - 1)
  );
}

/**
 * بيختار سر يوم النافذة نفسها وبيحتفظ بيه لآخر نافذة مقبولة بعد تغيير اليوم.
 *
 * @param companyId الشركة الموثقة من السيرفر
 * @param branchId الفرع الموثق من السيرفر
 * @param window رقم نافذة الإصدار أو التحقق المقبولة
 * @returns نطاق السر اليومي ووقت انتهاء الاحتفاظ بيه
 */
export function attendanceQrSecretScope(
  companyId: string,
  branchId: string,
  window: number,
): QrSecretScope {
  // TODO(spec): توقيت تغيير السر اليومي مش محدد في SPEC؛ المقترح UTC بدل يوم عمل الموظف المحلي.
  const day = Math.floor((window * ATTENDANCE_QR_WINDOW_MS) / DAY_MS);
  return { companyId, branchId, day, retainUntil: (day + 1) * DAY_MS + ATTENDANCE_QR_WINDOW_MS };
}

/** فشل مغلق من غير تفاصيل Redis أو السر اليومي في رسالة الخطأ. */
export class AttendanceQrUnavailableError extends Error {}
/** الفرع مش متاح تحت نطاق الشركة الموثقة أو اتوقف. */
export class AttendanceQrBranchMissingError extends Error {}
