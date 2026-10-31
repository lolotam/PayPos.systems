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
}
