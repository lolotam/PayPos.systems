import { parseCookies } from 'better-auth/cookies/utils';

/**
 * نتيجة إنهاء الجلسة: هل انتهت جلسة حقيقية، وهل الطلب كان يحمل cookie المسار.
 * `cookie` هو قيمة Set-Cookie اللي بيمسح cookie المسار، و null لما الطلب مابحمش cookie
 * بالاسم ده (D-6) — سطر التنضيف ما يبعتش إلا لو كان فيه cookie يمسحه.
 * `userId` موجود بس مع `ended`، وهو لسطر الـ log بس؛ مابيوصلش في جسم الـ HTTP.
 */
export type SignOutOutcome = { readonly cookie: string | null } & (
  { readonly ended: true; readonly userId: string } | { readonly ended: false }
);

/**
 * الصف اللي بتقراه دوال الإنهاء — الحقول اللي بتقراها بس.
 * النوع محلي بالملف ده عشان الملفين التانيين يستوردوا هذا من غير ما يعملوا دايرة.
 */
export interface SignOutRow {
  readonly purpose?: string | null;
  readonly staffDeviceContext?: unknown;
  readonly staffAuthenticatedAt?: Date | null;
  readonly staffAbsoluteDeadline?: Date | null;
  readonly expiresAt: Date;
}

// نفس نمط UUID بتاع قفل الجهاز: تغييره يفصل اختيار القفل عن اختيار صف صالح.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * هل الطلب حمل cookie بالاسم ده؟ الوجود بس، مش صحة التوقيع: cookie بتوقيع غلط لسه
 * cookie محمولة، وسطر التنظيف لازم يوصلها عشان ما تسيبش cookie عتيقة في المتصفح.
 *
 * @param headers رؤوس الطلب
 * @param name اسم cookie المسار
 * @returns true لو الطلب حمل cookie بنفس الاسم
 */
export function hasCookie(headers: Headers, name: string): boolean {
  return parseCookies(headers.get('cookie') ?? '').has(name);
}

/**
 * الصف حي لو غايته هي و سياقه مظبوط و موعده المطلق لسه قدام (BR-002).
 * الأهلية وربط التليفون مش جزء منه: صف فاشل فيهم دلوقتي ممكن ينجح تاني في الثماني ساعات.
 *
 * @param row صف الجلسة
 * @param now وقت القراءة، بعد ما الحذف رجع
 * @returns true لو الصف كان حياً وقت القراءة
 */
export function liveStaffRow(row: SignOutRow, now: Date): boolean {
  if (row.purpose !== 'STAFF_POS') return false;
  const context = row.staffDeviceContext;
  if (context === null || typeof context !== 'object') return false;
  const device = context as Record<string, unknown>;
  if (typeof device['companyId'] !== 'string') return false;
  if (typeof device['businessId'] !== 'string') return false;
  if (typeof device['branchId'] !== 'string') return false;
  if (typeof device['deviceId'] !== 'string' || !UUID.test(device['deviceId'])) return false;
  if (row.staffAuthenticatedAt === null || row.staffAuthenticatedAt === undefined) return false;
  const deadline = row.staffAbsoluteDeadline;
  if (deadline === null || deadline === undefined) return false;
  if (row.expiresAt.getTime() !== deadline.getTime()) return false;
  return now < deadline;
}

/**
 * الجهاز اللي الصف نفسه ماشي عليه — القفل بيتبني عليه وهو مكتوب من السيرفر.
 * اختيار القفل محتاج deviceId بس؛ مش معناه إن الصف حي.
 *
 * @param row صف الجلسة
 * @returns معرّف الجهاز لما يكون UUID، و null في أي حالة تانية
 */
export function staffLockDeviceId(row: SignOutRow): string | null {
  const context = row.staffDeviceContext;
  if (context === null || typeof context !== 'object') return null;
  const deviceId = (context as Record<string, unknown>)['deviceId'];
  if (typeof deviceId !== 'string' || !UUID.test(deviceId)) return null;
  return deviceId;
}
