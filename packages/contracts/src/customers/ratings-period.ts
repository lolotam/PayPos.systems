import { z } from 'zod';

import { timestamp } from '../scalars/timestamp.js';

/** أقصى عدد خانات عشرية في كسر الثانية؛ قاعدة البيانات بتخزن الميكروثانية وبتقرّب القراءة لها، فأي خانة بعدها بتخبّي فرق مش موجود. */
export const PERIOD_FRACTION_DIGITS = 6;

/** أكبر ساعات إزاحة عن UTC تقبلها PostgreSQL في `timestamptz`؛ من ±16:00 لفوق الـcast بيفشل بخطأ 22007 بدل ما الطلب يرجع 400. */
const MAX_OFFSET_HOURS = 15;

/**
 * هل الحد لحظة تقبلها PostgreSQL فعلًا: السنة 0000 مرفوضة (مفيش سنة صفر)، والإزاحة فوق ±15:59 مرفوضة،
 * وأي تاريخ مستحيل بيطلع من Date.parse بـ NaN. الفحص على كل حد لوحده سواء اتبعت واحد أو الاتنين.
 */
function isDatabaseInstant(value: string): boolean {
  if (value.startsWith('0000-')) return false;
  const offset = /([+-])(\d{2}):\d{2}$/.exec(value);
  if (offset !== null && Number(offset[2]) > MAX_OFFSET_HOURS) return false;
  return Number.isFinite(Date.parse(value.replace(/\.\d+/, '')));
}

/**
 * لحظة حد الفترة: `timestamp` العادي بشرطين على كل حد لوحده. الأول إن كسر الثانية يبقى ست خانات أو أقل: القارئان في SQL
 * بيحوّلوا الحد لـ`timestamptz` بدقة الميكروثانية، فلو اتقبل `.1234561Z` بعد `.123456Z` الفترة تبان مرتّبة في التحقق وهي
 * في القاعدة نافذة فاضية (نفس اللحظة). والتاني إن اللحظة تقبلها PostgreSQL (السنة 0000 والإزاحة فوق ±15:59 مرفوضتين).
 * الرفض هنا بيطلع 400 واضح عند التحقق بدل خطأ cast من القاعدة أو نتيجة فاضية صامتة.
 */
export const periodInstant = timestamp
  .refine((value) => (/\.(\d+)/.exec(value)?.[1] ?? '').length <= PERIOD_FRACTION_DIGITS, {
    message: `fractional seconds must have at most ${PERIOD_FRACTION_DIGITS} digits (microsecond precision)`,
  })
  .refine(isDatabaseInstant, {
    message: 'must be an instant PostgreSQL accepts (year 0001 or later, UTC offset within ±15:59)',
  });

/**
 * الشهر المطلوب `YYYY-MM` بالتقويم الميلادي في توقيت النشاط: السنة 2000 إلى 2999 والشهر 01 إلى 12 بصفرين، من غير مسافات
 * ولا يوم. نفس حدود محدد الشهر في الأدمن؛ السيرفر هو اللي بيحوّله لنافذة لحظات بتوقيت النشاط.
 */
export const ratingsMonth = z.string().regex(/^2[0-9]{3}-(?:0[1-9]|1[0-2])$/, {
  message: 'month must be YYYY-MM, years 2000 to 2999',
});

/** الثواني الكاملة والكسر العشري كما كُتبا، بدون الاعتماد على دقة الملّي ثانية في `Date`، وnull لو التاريخ مش صالح. */
function instantParts(value: string): { seconds: number; fraction: string } | null {
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? '';
  const seconds = Date.parse(value.replace(/\.\d+/, ''));
  return Number.isFinite(seconds) ? { seconds, fraction } : null;
}

/**
 * اللحظة بالميكروثانية بالضبط: `Date.parse` بيدّي ميلي ثانية والكسر العشري بيدّي ميكروثانية، فالضبط بالجمع.
 * null لو اللحظة مش صالحة (تاريخ مستحيل) أو كسرها أطول من دقة PostgreSQL (الميكروثانية).
 */
function instantMicroseconds(value: string): bigint | null {
  const parts = instantParts(value);
  if (parts === null || parts.fraction.length > PERIOD_FRACTION_DIGITS) return null;
  return (
    BigInt(parts.seconds) * 1_000n + BigInt(parts.fraction.padEnd(PERIOD_FRACTION_DIGITS, '0'))
  );
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
  if (a === null || b === null) return false;
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

/**
 * أقصى مدى لتقرير متوسط التقييمات بالأيام: سنة واحدة (PP-278). المدى الأعرض من كده بيتحمل على كل صف في
 * جدول التقييمات، فبيرفض بـ 422 `RATING_RANGE_TOO_WIDE` بدل ما الطلب ياخد وقت طويل من غير فايدة.
 */
export const MAX_RATING_AVERAGES_RANGE_DAYS = 366;

/** الميكروثانية في اليوم: 24 ساعة × 60 دقيقة × 60 ثانية × 1,000,000. */
const MICROSECONDS_PER_DAY = 86_400_000_000n;

/** أقصى المدى بالأيام محوّل للميكروثانية، عشان المقارنة تبقى دقيقة من غير فرق ولا تقريب. */
const MAX_RATING_AVERAGES_RANGE_US = BigInt(MAX_RATING_AVERAGES_RANGE_DAYS) * MICROSECONDS_PER_DAY;

/**
 * شرط «مدى التقرير» لتقرير متوسط التقييمات: غياب الطرفين معناه الشهر الحالي بتوقيت النشاط، والفترة الصريحة
 * لازم تبقى من طرفين وتشمل عرض 366 يوم بالميكروثانية على الأكثر. طرف واحد بس (من غير طرف تاني) مدى مفتوح
 * وعرضه أكبر من الحد، فيترفض.
 *
 * @param query الاستعلام بعد تحقق الحقول
 * @param query.from بداية الفترة أو undefined
 * @param query.to نهاية الفترة أو undefined
 * @returns هل المدى داخل الحد؛ false للمدى الأعرض من الحد أو المفتوح أو المعكوس
 */
export function isRatingAveragesRangeWithinMax(query: {
  from?: string | undefined;
  to?: string | undefined;
}): boolean {
  if (query.from === undefined && query.to === undefined) return true;
  if (query.from === undefined || query.to === undefined) return false;
  const start = instantMicroseconds(query.from);
  const end = instantMicroseconds(query.to);
  if (start === null || end === null) return false;
  return end > start && end - start <= MAX_RATING_AVERAGES_RANGE_US;
}

/**
 * شرط التحقق المشترك: `month` بديل عن `from` و`to` مش مكمّل ليهم، فلو اتبعت معاهم الطلب مرفوض.
 *
 * @param query الاستعلام بعد تحقق الحقول
 * @param query.month الشهر `YYYY-MM` أو undefined
 * @param query.from بداية الفترة أو undefined
 * @param query.to نهاية الفترة أو undefined
 * @returns false فقط لما `month` موجود مع `from` أو `to`
 */
export function monthExcludesRange(query: {
  month?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}): boolean {
  return query.month === undefined || (query.from === undefined && query.to === undefined);
}

/**
 * الشهر `YYYY-MM` الذي استخدمه السيرفر فعلًا بتوقيت النشاط لما الفترة جات من `month` أو من الشهر الحالي الافتراضي للمتوسطات،
 * وnull لما اتبعت `from`/`to` صراحة أو القائمة بلا فترة. اختياري في المخطط عشان متصفح أحدث على سيرفر أقدم أثناء النشر ما يفشلش في التحقق.
 */
export const resolvedRatingsMonth = ratingsMonth.nullable().optional();
