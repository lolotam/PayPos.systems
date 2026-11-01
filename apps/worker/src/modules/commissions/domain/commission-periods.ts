export interface CommissionPeriodLockPlan {
  readonly affectedPeriods: readonly string[];
  readonly periodsToLock: readonly string[];
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
  const index = year * 12 + month;
  const nextYear = Math.floor((index - 1) / 12);
  const nextMonth = ((index - 1) % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}
