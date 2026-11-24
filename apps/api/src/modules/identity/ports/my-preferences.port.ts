export type NavigationStyle = 'A' | 'B' | 'C';

export interface MyPreferencesReader {
  /** تفضيل المتصل فقط؛ القراءة مستقلة عن الشركة والصلاحيات عشان شاشة المظهر تفضل شخصية. */
  read(userId: string): Promise<NavigationStyle | null>;
}
export interface MyPreferencesWriter {
  /** يحفظ قيمة المستخدم المحقّق من الجلسة، بلا أي محدّد حساب يختاره العميل. */
  write(userId: string, navStyle: NavigationStyle | null): Promise<NavigationStyle | null>;
}
