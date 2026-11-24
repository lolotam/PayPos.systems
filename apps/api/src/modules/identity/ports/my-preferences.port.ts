export type NavigationStyle = 'A' | 'B' | 'C';

export interface MyPreferencesWriter {
  /**
   * يحفظ قيمة المستخدم المحقّق من الجلسة، بلا أي محدّد حساب يختاره العميل، ويعيد القيمة المثبتة.
   *
   * @param userId   معرّف المستخدم القادم من الجلسة الموثّقة، لا من جسم الطلب
   * @param navStyle النمط المطلوب حفظه، أو `null` للعودة إلى الافتراضي
   * @returns القيمة كما حُفظت في الحساب
   */
  write(userId: string, navStyle: NavigationStyle | null): Promise<NavigationStyle | null>;
}
