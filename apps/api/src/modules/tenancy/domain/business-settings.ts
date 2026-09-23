/**
 * بيحسب إعدادات business جديد: الـ template بتاع الـ vertical الأول، وبعدين أي مفتاح بعته الـ client بيغطي نفس
 * المفتاح في الـ template (قرار Waleed 2026-09-23). الدمج على المستوى الأول بس — قيمة المفتاح بتتبدل كلها.
 *
 * @param template  إعدادات الـ vertical (الـ modules والـ features) من الـ templates
 * @param overrides الـ settings اللي في الطلب
 * @returns الإعدادات اللي هتتخزن في business.settings
 */
export function businessSettings(
  template: Readonly<Record<string, unknown>>,
  overrides: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return { ...template, ...overrides };
}
