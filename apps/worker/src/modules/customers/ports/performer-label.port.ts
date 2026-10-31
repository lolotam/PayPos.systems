import type { PerformerLabelChoice } from '../domain/performer-label.ts';

/** رسم تسمية المنفذين بنص الرسالة، والنص من الكتالوج مش من الكود (CLAUDE.md §7). */
export interface PerformerLabelPort {
  /**
   * يرسم التسمية المختارة بنص الرسالة.
   *
   * @param choice الاختيار اللي خرج من قاعدة التسمية
   * @param locale لغة العميل
   * @param businessName اسم النشاط كما هو معروض
   * @returns نص التسمية
   */
  format(choice: PerformerLabelChoice, locale: 'ar' | 'en', businessName: string): string;
  /**
   * يحفظ اسم النشاط داخل حدّ معامل الإشعار من غير كسر حرف مركّب؛ الاسم العادي لا يتغير.
   *
   * @param businessName اسم النشاط بعد اختيار اللغة والرجوع للإنجليزية
   * @returns الاسم كما هو، أو مختصراً على حدود code points عند تجاوزه الحد
   */
  businessName(businessName: string): string;
}
