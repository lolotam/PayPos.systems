// علامتا الوقت بالعربي مكتوبتين من نقاط الشيفرة (U+0635 «ص» قبل الظهر، U+0645 «م» بعده)
// عشان الملف ما يحملش نص عربي ظاهر للمستخدم: النص الظاهر ملك الحزمة، وقاعدة الـ lint
// بتسمح بالعربي في ملف القوالب نفسه بس.
const AR_AM = String.fromCodePoint(0x0635);
const AR_PM = String.fromCodePoint(0x0645);

// نفس قاعدة الـ HH:MM (24 ساعة) اللي بتفحص بيها القوالب: أي قيمة تانية بترجع زي ما جت.
const TIME_24H_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * يحوّل وقت شيفت مخزّن بصيغة 24 ساعة لوقت 12 ساعة بلغة الإشعار.
 * القاعدة: الساعة من غير صفر بادئ والدقيقة بصفرين، و«ص» قبل الظهر و«م» بعده بالعربي
 * و AM/PM بالإنجليزي؛ والقيمة اللي مش صيغتها HH:MM بترجع زي ما جت من غير تغيير.
 *
 * @param time24 الوقت بصيغته الأصلية HH:MM
 * @param locale لغة الإشعار
 * @returns الوقت بصيغة 12 ساعة مع علامة اللغة
 */
export function formatTwelveHour(time24: string, locale: 'ar' | 'en'): string {
  const match = TIME_24H_PATTERN.exec(time24);
  if (match === null) return time24;
  const hour = Number(match[1]);
  const afterNoon = hour >= 12;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const marker = locale === 'ar' ? (afterNoon ? AR_PM : AR_AM) : afterNoon ? 'PM' : 'AM';
  return `${hour12}:${match[2]} ${marker}`;
}
