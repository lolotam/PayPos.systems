// مدخل مشترك لأوامر المشغّل على حاوية pospay_owner؛ ملف السكربت نفسه قابل للتنفيذ (top-level await)
// فلا يمكن استيراده للاختبار، لذلك تحليل لحظة الانتهاء يعيش هنا اختبارياً وبدون قاعدة بيانات.

// لحظة ISO-8601 كاملة بoffset صريح فقط: لا تاريخ بدون وقت ولا وقت بدون Z أو offset رقمي.
// الoffset بيتقبل بتهجئاته الصحيحة كلها: Z، +03، +0300، و+03:00.
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * يقبل لحظة ISO-8601 كاملة بoffset صريح ويرفض كل غيرها، ويعيد الإعادة (round-trip) فترفض التواريخ
 * الملفوفة مثل 31 فبراير أو ساعة 25 لأن Date.UTC يطبّعها لقيمة أخرى؛ ساعة الجهاز لا تُستشار أبداً.
 * مركّبات الـoffset نفسها تُفحص عنصراً عنصراً: ساعات الـoffset فوق 14 ودقائقه فوق 59 تُرفض حتى لو
 * طبّعها Date بعد الضرب، لأن +00:90 تعني 90 دقيقة وقبولها يخفي خطأ إدخال حقيقياً. الكسور فوق ثلاث
 * خانات تُرفض صراحةً بدل اقتصاصها صامتاً، فالاقتصاص كان يخفي دقة زمن أقل مما أدخله المشغّل.
 *
 * @param value قيمة --expires كما أدخلها المشغّل
 * @returns اللحظة كـDate على خط الزمن المطلق، ليُقارن بساعة PostgreSQL
 */
export function parseExpiry(value: string): Date {
  const match = ISO_INSTANT.exec(value);
  if (match === null || match[8] === undefined) throw new Error('COVERAGE_OPERATOR_INPUT_INVALID');
  const [, year, month, day, hour, minute, second, fraction, offset] = match;
  let offsetMinutes = 0;
  if (offset !== 'Z') {
    const sign = offset[0] === '-' ? -1 : 1;
    const digits = offset.slice(1);
    const [hourPart, minutePart] = digits.includes(':')
      ? digits.split(':')
      : [digits.slice(0, 2), digits.slice(2) || '0'];
    const offsetHours = Number(hourPart);
    const offsetMinutesPart = Number(minutePart);
    if (offsetHours > 14 || offsetMinutesPart > 59)
      throw new Error('COVERAGE_OPERATOR_INPUT_INVALID');
    offsetMinutes = sign * (offsetHours * 60 + offsetMinutesPart);
  }
  if (fraction !== undefined && fraction.length > 3)
    throw new Error('COVERAGE_OPERATOR_INPUT_INVALID');
  const millisecond = fraction === undefined ? 0 : Number(fraction.padEnd(3, '0'));
  const wall =
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute),
      Number(second), millisecond) -
    offsetMinutes * 60_000;
  const shifted = new Date(wall + offsetMinutes * 60_000);
  const rounded =
    shifted.getUTCFullYear() !== Number(year) ||
    shifted.getUTCMonth() !== Number(month) - 1 ||
    shifted.getUTCDate() !== Number(day) ||
    shifted.getUTCHours() !== Number(hour) ||
    shifted.getUTCMinutes() !== Number(minute) ||
    shifted.getUTCSeconds() !== Number(second) ||
    shifted.getUTCMilliseconds() !== millisecond;
  if (rounded || Math.abs(offsetMinutes) > 14 * 60)
    throw new Error('COVERAGE_OPERATOR_INPUT_INVALID');
  return new Date(wall);
}
