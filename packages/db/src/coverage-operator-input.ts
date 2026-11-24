// مدخل مشترك لأوامر المشغّل على حاوية pospay_owner؛ ملف السكربت نفسه قابل للتنفيذ (top-level await)
// فلا يمكن استيراده للاختبار، لذلك تحليل لحظة الانتهاء يعيش هنا اختبارياً وبدون قاعدة بيانات.

// لحظة ISO-8601 كاملة بoffset صريح فقط: لا تاريخ بدون وقت ولا وقت بدون Z أو offset رقمي.
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * يقبل لحظة ISO-8601 كاملة بoffset صريح ويرفض كل غيرها، ويعيد الإعادة (round-trip) فترفض التواريخ
 * الملفوفة مثل 31 فبراير أو ساعة 25 لأن Date.UTC يطبّعها لقيمة أخرى؛ ساعة الجهاز لا تُستشار أبداً.
 * مركّبات الـoffset نفسها تُفحص عنصراً عنصراً: ساعات الـoffset فوق 14 ودقائقه فوق 59 تُرفض حتى لو
 * طبّعها Date بعد الضرب، لأن +00:90 تعني 90 دقيقة وقبولها يخفي خطأ إدخال حقيقياً.
 *
 * @param value قيمة --expires كما أدخلها المشغّل
 * @returns اللحظة كـDate على خط الزمن المطلق، ليُقارن بساعة PostgreSQL
 */
export function parseExpiry(value: string): Date {
  const match = ISO_INSTANT.exec(value);
  if (match === null || match[8] === undefined) throw new Error('COVERAGE_OPERATOR_INPUT_INVALID');
  const [, year, month, day, hour, minute, second, fraction, offset] = match;
  const offsetHours = offset === 'Z' ? 0 : Number(offset.slice(1, 3));
  const offsetMinutesPart = offset === 'Z' ? 0 : Number(offset.slice(4, 6));
  if (offsetHours > 14 || offsetMinutesPart > 59)
    throw new Error('COVERAGE_OPERATOR_INPUT_INVALID');
  const offsetMinutes =
    offset === 'Z' ? 0 : (offset[0] === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutesPart);
  const millisecond = fraction === undefined ? 0 : Number(fraction.padEnd(3, '0').slice(0, 3));
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
