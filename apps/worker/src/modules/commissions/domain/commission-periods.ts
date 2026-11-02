import type { LockedCommissionPeriod } from './commission-line-types.ts';

export interface CommissionPeriodLockPlan {
  readonly affectedPeriods: readonly string[];
  readonly periodsToLock: readonly string[];
}

/** نتيجة تصنيف الشهور المقفولة: المغلق منها والمراجع منها، والشهور المرشحة غير مصنّفة. */
export interface CommissionPeriodClassification {
  readonly closed: readonly string[];
  readonly reviewed: readonly string[];
}

/**
 * يحسب الشهر الحالي بتقويم النشاط من لحظة محقونة؛ هذا للمرشحين المستقبليين فقط،
 * أما شهر كل بند فيأتي من business_date ولا يُعاد اشتقاقه من occurred_at.
 *
 * @param now اللحظة الحالية من Clock
 * @param timeZone منطقة النشاط الزمنية المقروءة من tenancy
 * @returns شهر اليوم المحلي للنشاط بصيغة YYYY-MM
 */
export function currentBusinessPeriod(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value as string;
  const month = parts.find((part) => part.type === 'month')?.value as string;
  return `${year}-${month}`;
}

/**
 * يوسّع كل شهر متأثر إلى كل مرشحي التصحيح من ذلك الشهر حتى الشهر الحالي،
 * مع إبقاء الشهر المصدر مرشحاً وعدم توليد شهور مستقبلية عندما يكون أحدث من الحالي.
 *
 * @param affectedPeriods شهور الحذف أو الإضافة للبنود الأحدث
 * @param currentPeriod شهر اليوم المحلي للنشاط
 * @returns كل الشهور المرشحة، فريدة ومرتبة تصاعدياً
 */
export function candidateCommissionPeriods(
  affectedPeriods: readonly string[],
  currentPeriod: string,
): string[] {
  const candidates = new Set<string>();
  for (const affected of affectedPeriods) {
    const end = affected > currentPeriod ? affected : currentPeriod;
    for (let period = affected; period <= end; period = nextPeriod(period)) {
      candidates.add(period);
    }
  }
  return [...candidates].sort();
}

/**
 * يجهّز نطاق القفل الواحد: المتأثر وحده يُصنّف ويُعاد فتحه، وكل المرشحين يُقفلون
 * معه تصاعدياً حتى لا يتغير وضع شهر أثناء اختيار هدف التصحيح.
 *
 * @param affectedPeriods شهور الحذف أو الإضافة
 * @param currentPeriod شهر اليوم المحلي للنشاط
 * @returns الشهور المتأثرة ومجموعة الشهور الكاملة المطلوب قفلها
 */
export function commissionPeriodLockPlan(
  affectedPeriods: readonly string[],
  currentPeriod: string,
): CommissionPeriodLockPlan {
  const affected = [...new Set(affectedPeriods)].sort();
  const candidates = candidateCommissionPeriods(affected, currentPeriod);
  return {
    affectedPeriods: affected,
    periodsToLock: [...new Set([...affected, ...candidates])].sort(),
  };
}

function nextPeriod(period: string): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}

/**
 * يصنّف الشهور المقفولة في المتأثر والمراجع؛ الشهر المرشّح وحده لا يُصنّف أبداً،
 * فإغلاق شهر مرشّح لا يمنع إسقاط بنود لأن مدخلات ذلك الشهر لم تتغيّر.
 * التصنيف هنا قرار عمل لا قراءة قاعدة بيانات، عشان يبقى له اختبار وحدة حقيقي.
 *
 * @param locked الشهور المقفولة بحالاتها بعد اكتمال انتظار الأقفال
 * @param affectedPeriods الشهور المتأثرة بالحذف أو الإضافة
 * @returns الشهور المغلقة والشهور المراجعة، كل قائمة مرتبة تصاعدياً
 */
export function classifyCommissionPeriods(
  locked: readonly LockedCommissionPeriod[],
  affectedPeriods: readonly string[],
): CommissionPeriodClassification {
  const affected = new Set(affectedPeriods);
  const closed: string[] = [];
  const reviewed: string[] = [];
  for (const row of locked) {
    if (!affected.has(row.period)) continue;
    if (row.status === 'APPROVED' || row.status === 'PAID') closed.push(row.period);
    else if (row.status === 'REVIEWED') reviewed.push(row.period);
  }
  return { closed: closed.sort(), reviewed: reviewed.sort() };
}
