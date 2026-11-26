import { isCommissionPeriod, nextCommissionPeriod } from './commission-calendar.ts';
import type { LockedCommissionPeriod } from './commission-line-types.ts';
import { CommissionCandidateRangeExceededError, CommissionPeriodInvalidError } from './errors.ts';

export interface CommissionPeriodLockPlan {
  readonly affectedPeriods: readonly string[];
  readonly periodsToLock: readonly string[];
}

/**
 * أقصى عدد شهور مرشحة لخصم واحد: عشر سنوات. النطاق الأطول بيرفض بنوع خطأ معروف
 * بدل ما ياخد أقفال على عدد شهور ما بيخلصش (FR-015).
 */
export const MAX_CANDIDATE_COMMISSION_PERIODS = 120;

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
 * النطاق بيقف عند `MAX_CANDIDATE_COMMISSION_PERIODS` شهر، فيترفض قبل أي قفل.
 *
 * @param affectedPeriods شهور الحذف أو الإضافة للبنود الأحدث
 * @param currentPeriod شهر اليوم المحلي للنشاط
 * @returns كل الشهور المرشحة، فريدة ومرتبة تصاعدياً
 * @throws CommissionCandidateRangeExceededError لما النطاق يطول عن الحد
 */
export function candidateCommissionPeriods(
  affectedPeriods: readonly string[],
  currentPeriod: string,
): string[] {
  if (!isCommissionPeriod(currentPeriod)) throw new CommissionPeriodInvalidError(currentPeriod);
  const candidates = new Set<string>();
  for (const affected of affectedPeriods) {
    if (!isCommissionPeriod(affected)) throw new CommissionPeriodInvalidError(affected);
    const end = affected > currentPeriod ? affected : currentPeriod;
    for (let period = affected; period <= end; period = nextCommissionPeriod(period)) {
      if (candidates.size >= MAX_CANDIDATE_COMMISSION_PERIODS) {
        throw new CommissionCandidateRangeExceededError(MAX_CANDIDATE_COMMISSION_PERIODS);
      }
      candidates.add(period);
      if (period === end) break;
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

/**
 * يختار الشهر التالي اللي ينفع يقفل في مسار تصحيح بيع باقة، والقرار بيتبني على لقطة
 * الأقفال المحقونة مش على مدى كامل: شهر متأثر مقفول لسه بلا هدف DRAFT بيحتاج شهر
 * مفتوح بعده، فيُقفل الشهر اللي بعده شهر شهر؛ غير كده ينتقل القفل لأقرب شهر متأثر
 * تالٍ فوراً. القفل بيفضل صاعد عشان ما يحصلش deadlock مع كاتب تاني (CM-02).
 * المشي شهر شهر بيتقف عند `MAX_CANDIDATE_COMMISSION_PERIODS` قفل، فيترفض بنوع خطأ معروف.
 *
 * @param affectedPeriods شهور الحذف أو الإضافة، مرتبة تصاعدياً بعد إزالة التكرار
 * @param currentPeriod شهر اليوم المحلي للنشاط
 * @param locked الشهور المقفولة بحالاتها بعد كل نداءات القفل السابقة
 * @returns الشهر التالي المراد قفله، أو null لما ما فيهش شهر تاني مطلوب
 * @throws CommissionCandidateRangeExceededError لما المشي شهر شهر يطول عن الحد
 */
export function nextCommissionPeriodToLock(
  affectedPeriods: readonly string[],
  currentPeriod: string,
  locked: readonly LockedCommissionPeriod[],
): string | null {
  const affected = [...new Set(affectedPeriods)].sort();
  if (affected.length === 0) return null;
  if (!isCommissionPeriod(currentPeriod)) throw new CommissionPeriodInvalidError(currentPeriod);
  for (const period of affected) {
    if (!isCommissionPeriod(period)) throw new CommissionPeriodInvalidError(period);
  }
  const lastLocked = locked.at(-1)?.period ?? null;
  if (needsCorrectionTarget(affected, currentPeriod, locked)) {
    // الشهر المقفول بلا هدف مفتوح لازم ياخد هدفه من شهر بعده داخل الشهر الحالي، فلو وصلنا
    // للشهر الحالي من غير هدف فالقفل بيقف والاختيار بيرفض العملية بنفسه.
    if (lastLocked === null || lastLocked >= currentPeriod) return null;
    if (locked.length >= MAX_CANDIDATE_COMMISSION_PERIODS) {
      throw new CommissionCandidateRangeExceededError(MAX_CANDIDATE_COMMISSION_PERIODS);
    }
    return nextCommissionPeriod(lastLocked);
  }
  const next = affected.find((period) => lastLocked === null || period > lastLocked);
  return next ?? null;
}

/**
 * يقول إن فيه شهر متأثر مقفول لسه بلا هدف DRAFT مفتوح بعده وداخل الشهر الحالي؛
 * الهدف المقفول لسه شغّال على شهر مقفول تاني فمابقاش هدف.
 *
 * @param affected الشهور المتأثرة مرتبة تصاعدياً
 * @param currentPeriod شهر اليوم المحلي للنشاط
 * @param locked الشهور المقفولة بحالاتها
 * @returns true حين يحتاج شهر متأثر مقفول إلى شهر مفتوح بعده
 */
function needsCorrectionTarget(
  affected: readonly string[],
  currentPeriod: string,
  locked: readonly LockedCommissionPeriod[],
): boolean {
  return locked.some(
    (row) =>
      affected.includes(row.period) &&
      (row.status === 'APPROVED' || row.status === 'PAID') &&
      row.period < currentPeriod &&
      !locked.some(
        (candidate) =>
          candidate.status === 'DRAFT' &&
          row.period < candidate.period &&
          candidate.period <= currentPeriod,
      ),
  );
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
