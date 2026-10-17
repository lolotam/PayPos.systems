import { SessionError } from './session-error.ts';
import { validateAppendWindow } from './session-time.ts';

/**
 * يقرر إن يوم الزيارة ما زال داخل نافذة تسجيل الزيارة نفسها.
 * الفترة المعتمدة ليست مدخلاً هنا؛ التصحيح يسجّله المستهلك لاحقاً، والحد هو أول يوم في الشهر السابق بتوقيت النشاط.
 *
 * @param businessDate يوم الزيارة المحفوظ
 * @param now الوقت المحقون بعد الأقفال
 * @param timezone توقيت النشاط
 * @returns هل تسجيل البقشيش ما زال مفتوحاً لهذا اليوم
 */
export function tipWindowOpen(businessDate: string, now: Date, timezone: string): boolean {
  try {
    validateAppendWindow(businessDate, now, timezone);
    return true;
  } catch (error) {
    if (error instanceof SessionError && error.code === 'SESSION_TIME_TOO_OLD') return false;
    throw error;
  }
}

/**
 * يرفض تسجيل البقشيش عندما يكون يوم الزيارة أقدم من نافذة التسجيل.
 * يعيد استخدام حساب إلحاق الزيارة ويترجم رفضه القديم إلى رمز البقشيش، من غير إعادة حساب الشهر.
 *
 * @param businessDate يوم الزيارة المحفوظ
 * @param now الوقت المحقون بعد الأقفال
 * @param timezone توقيت النشاط
 * @returns لا شيء؛ النافذة المقفولة ترفض
 */
export function assertTipWindowOpen(businessDate: string, now: Date, timezone: string): void {
  if (!tipWindowOpen(businessDate, now, timezone)) throw new SessionError('TIP_WINDOW_CLOSED');
}
