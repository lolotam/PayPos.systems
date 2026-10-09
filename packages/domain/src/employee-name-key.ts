// تُبنى الحروف من رموزها لأن قاعدة الواجهة تمنع النص العربي الحرفي خارج packages/i18n.
const ALEF = String.fromCodePoint(0x0627);
const HEH = String.fromCodePoint(0x0647);
const YEH = String.fromCodePoint(0x064a);

/**
 * يحسب مفتاح التطابق التام للأسماء وفق قرار المالك: توحيد Unicode والحروف العربية والمسافات وحالة الأحرف.
 * تُحذف الحركات والتطويل دون تغيير الاسم المعروض أو قبول تطابق البادئة.
 *
 * @param name الاسم الأصلي بالعربية أو الإنجليزية أو كليهما
 * @returns مفتاح موحد للمقارنة التامة، وقد يكون فارغاً بعد التنظيف
 */
export function employeeNameMatchKey(name: string): string {
  return (
    name
      .normalize('NFKC')
      .replace(/[\u064B-\u0652\u0670\u0640]/gu, '')
      .replace(/[أإآٱ]/gu, ALEF)
      .replace(/ة/gu, HEH)
      .replace(/ى/gu, YEH)
      .toLowerCase()
      .replace(/\s+/gu, ' ')
      .trim()
  );
}
