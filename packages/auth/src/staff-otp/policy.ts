import type { StaffDeviceContext } from './types.ts';

export const OTP_LIFETIME_MS = 300_000;
export const PREPARATION_MS = 200;
export const STAFF_SESSION_MS = 28_800_000;
/** نافذة إعادة طلب الكود موحدة لكل هاتف قبل قراءة الأهلية. */
export const OTP_RETRY_MS = 60_000;
/** سقف عمل إثبات الموظف يحمي موارد الدخول إلى الجهاز. */
export const STAFF_LOGIN_CONCURRENCY = 8;

/**
 * يثبت تطابق سياق الاعتماد بالكامل، فلا يختار الجسم شركة أو جهازاً مختلفاً.
 *
 * @param left السياق المخزن
 * @param right الجهاز المثبت حالياً
 * @returns هل كل القيود متطابقة
 */
export function sameDevice(left: StaffDeviceContext, right: StaffDeviceContext): boolean {
  return (
    left.companyId === right.companyId &&
    left.businessId === right.businessId &&
    left.branchId === right.branchId &&
    left.deviceId === right.deviceId
  );
}

/**
 * لا تمتد صلاحية الكود بتأخير الطابور، والحد النهائي نفسه مرفوض.
 *
 * @param createdAt وقت قبول الطلب
 * @returns الموعد المطلق بعد خمس دقائق
 */
export function challengeExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + OTP_LIFETIME_MS);
}

/**
 * يختار موعد التحضير قبل البحث ويحظر إعادة بدء المهلة عند الاستهلاك.
 *
 * @param createdAt بداية النافذة المشتركة
 * @returns نهاية النافذة الثابتة
 */
export function preparationDeadline(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PREPARATION_MS);
}

/**
 * جلسة الوردية لها نهاية مطلقة بلا مهلة خمول أو تجديد منزلق.
 *
 * @param now وقت إثبات الموظف
 * @returns نهاية الثماني ساعات
 */
export function staffDeadline(now: Date): Date {
  return new Date(now.getTime() + STAFF_SESSION_MS);
}
