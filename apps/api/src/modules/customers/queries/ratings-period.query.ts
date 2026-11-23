import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { ApiError } from '../../../shared/errors.ts';
import type { RatingsListReads, RatingsListScope } from './ratings-list-reads.ts';

/**
 * الفترة اللي بتقيّد قراءة التقييمات على `submitted_at`: نطاق لحظات صريح بحدين اختياريين، أو شهر ميلادي كامل بتوقيت النشاط.
 * `localStart` أول يوم في الشهر كـ `timestamp` محلي من غير منطقة زمنية؛ الحساب كله في SQL عشان تغيّر الساعة يتحسب صح.
 */
export type RatingsPeriod =
  | {
      readonly kind: 'range';
      readonly from?: string | undefined;
      readonly to?: string | undefined;
    }
  | { readonly kind: 'month'; readonly localStart: SQL; readonly timeZone: string };

/** الشهر المطلوب `YYYY-MM`، أو الشهر الحالي في توقيت النشاط لما `month` غايب، كفترة جاهزة للمقارنة. */
export function monthPeriod(
  timeZone: string,
  month: string | undefined,
  now: Date,
): Extract<RatingsPeriod, { kind: 'month' }> {
  const localStart =
    month === undefined
      ? sql`date_trunc('month', ${now.toISOString()}::timestamptz AT TIME ZONE ${timeZone})`
      : sql`${`${month}-01`}::timestamp`;
  return { kind: 'month', localStart, timeZone };
}

/**
 * شرط الفترة على عمود `at` المجرد. النطاق الصريح مقارنتين مباشرتين. الشهر: حدّ UTC واسع بيمسك الفهرس (يوم قبل وبعد
 * عشان أي إزاحة توقيت) وفلتر الشهر المحلي بيشيل الزيادة؛ ده بيعدّي كل لحظات الشهر بغض النظر عن تغيير الساعة، ومنها
 * ساعة منتصف الليل المتكررة أو المتخطاة. نفس منطق ملخص تقييمي في 61-2a.
 *
 * @param at عمود وقت التسجيل بدون أي دالة عليه
 * @param period الفترة
 * @returns جملة `AND ...` تتحط في WHERE
 */
export function periodPredicate(at: SQL, period: RatingsPeriod): SQL {
  if (period.kind === 'range') {
    const from = period.from === undefined ? sql`` : sql`AND ${at} >= ${period.from}::timestamptz`;
    const to = period.to === undefined ? sql`` : sql`AND ${at} < ${period.to}::timestamptz`;
    return sql`${from} ${to}`;
  }
  const { localStart, timeZone } = period;
  return sql`AND ${at} >= ((${localStart} - interval '1 day') AT TIME ZONE 'UTC')
    AND ${at} < ((${localStart} + interval '1 month 1 day') AT TIME ZONE 'UTC')
    AND date_trunc('month', ${at} AT TIME ZONE ${timeZone}) = ${localStart}`;
}

/**
 * يحوّل استعلام الطلب لفترة: `from`/`to` الصريحين زي ما هم، أو شهر `month` بتوقيت النشاط، أو الشهر الحالي لو
 * `defaultsToCurrentMonth` ومفيش حاجة منهم، وإلا نطاق مفتوح. توقيت النشاط بيتقرا من نفس معاملة القراءة، ومش بيتقرا
 * خالص لما الفترة صريحة.
 *
 * @param tx معاملة القراءة على الشركة
 * @param scope الشركة والنشاط والمستخدم
 * @param query `from` و`to` و`month` بعد التحقق (الاستعلام نفسه بيمنع الجمع بين `month` والاتنين)
 * @param now عينة الساعة المشتركة
 * @param reads قراءات tenancy اللي customers مش بتقراها بنفسها
 * @param defaultsToCurrentMonth هل الغياب التام للفترة معناه الشهر الحالي (المتوسطات) ولا مفتوح (القائمة)
 * @returns الفترة الجاهزة للـ SQL مع `month`: الشهر `YYYY-MM` بتوقيت النشاط لما الفترة شهر (المطلوب أو الحالي بالتوقيت من قاعدة البيانات)، وnull لنطاق `from`/`to` أو المفتوح
 */
export async function resolvePeriod(
  tx: Tx,
  scope: RatingsListScope,
  query: { from?: string | undefined; to?: string | undefined; month?: string | undefined },
  now: Date,
  reads: RatingsListReads,
  defaultsToCurrentMonth: boolean,
): Promise<{ readonly period: RatingsPeriod; readonly month: string | null }> {
  if (query.from !== undefined || query.to !== undefined)
    return { period: { kind: 'range', from: query.from, to: query.to }, month: null };
  if (query.month === undefined && !defaultsToCurrentMonth)
    return { period: { kind: 'range' }, month: null };
  const timeZone = await reads.timeZone(tx, scope);
  if (timeZone === null) throw new ApiError('FORBIDDEN');
  const period = monthPeriod(timeZone, query.month, now);
  if (query.month !== undefined) return { period, month: query.month };
  // الشهر الحالي بيتسمّى من نفس تعبير الفترة في SQL، فالاسم والنافذة ما يختلفوش على حدود الشهر أو تغيير الساعة.
  const [row] = await tx.execute<{ month: string }>(
    sql`SELECT to_char(${period.localStart}, 'YYYY-MM') AS month`,
  );
  return { period, month: row?.month ?? null };
}
