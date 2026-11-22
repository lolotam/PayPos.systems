import { timestamp } from '../scalars/timestamp.js';

/** أقصى عدد خانات عشرية في كسر الثانية؛ قاعدة البيانات بتخزن الميكروثانية وبتقرّب القراءة لها، فأي خانة بعدها بتخبّي فرق مش موجود. */
export const PERIOD_FRACTION_DIGITS = 6;

/**
 * لحظة حد الفترة: `timestamp` العادي بشرط إن كسر الثانية يبقى ست خانات أو أقل. القارئان في SQL بيحوّلوا الحد لـ`timestamptz`
 * بدقة الميكروثانية، فلو اتقبل `.1234561Z` بعد `.123456Z` الفترة تبان مرتّبة في التحقق وهي في القاعدة نافذة فاضية (نفس اللحظة).
 * الرفض هنا بيطلع 400 واضح عند التحقق بدل نتيجة فاضية صامتة.
 */
export const periodInstant = timestamp.refine(
  (value) => (/\.(\d+)/.exec(value)?.[1] ?? '').length <= PERIOD_FRACTION_DIGITS,
  {
    message: `fractional seconds must have at most ${PERIOD_FRACTION_DIGITS} digits (microsecond precision)`,
  },
);

/** الثواني الكاملة والكسر العشري كما كُتبا، بدون الاعتماد على دقة الملّي ثانية في `Date`. */
function instantParts(value: string): { seconds: number; fraction: string } {
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? '';
  return { seconds: Date.parse(value.replace(/\.\d+/, '')), fraction };
}

/**
 * يقرر هل `from` قبل `to` بدقة الميكروثانية: الثواني الكاملة تتقارن كأرقام والكسر العشري كنص بعد
 * مساواة الطول بأصفار، فالنصان بنفس الطول وترتيبهما الأبجدي هو ترتيبهما العددي. التقارن بالملّي ثانية
 * كان يرفض `.123001Z` ثم `.123999Z` مع إن قاعدة البيانات تخزن الميكروثانية وتفرّق بينهما.
 *
 * @param from بداية الفترة (شاملة) كما وصلت بعد تحقق `timestamp`
 * @param to نهاية الفترة (حصرية) كما وصلت بعد تحقق `timestamp`
 * @returns هل الفترة غير فارغة؛ false لو أي طرف غير صالح أو تساوى الطرفان أو انعكسا
 */
export function isPeriodForward(from: string, to: string): boolean {
  const a = instantParts(from);
  const b = instantParts(to);
  if (Number.isNaN(a.seconds) || Number.isNaN(b.seconds)) return false;
  if (a.seconds !== b.seconds) return a.seconds < b.seconds;
  const width = Math.max(a.fraction.length, b.fraction.length);
  return a.fraction.padEnd(width, '0') < b.fraction.padEnd(width, '0');
}

/**
 * شرط التحقق المشترك بين `ratingsListQuery` و`ratingAveragesQuery`: الفترة مفتوحة لو أحد الطرفين غايب.
 *
 * @param query الاستعلام بعد تحقق الحقول
 * @param query.from بداية الفترة أو undefined
 * @param query.to نهاية الفترة أو undefined
 * @returns false فقط لما الطرفان موجودان والفترة فارغة أو معكوسة
 */
export function periodIsValid(query: {
  from?: string | undefined;
  to?: string | undefined;
}): boolean {
  return (
    query.from === undefined || query.to === undefined || isPeriodForward(query.from, query.to)
  );
}
