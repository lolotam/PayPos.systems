import type { WorkspaceBranch } from '@pospay/contracts';
import { currentRatingsMonth } from './ratings-period';

/** فلاتر الشاشة كما اختارها المستخدم؛ السلسلة الفارغة معناها «الكل». */
export interface RatingsFilters {
  branchId: string;
  employeeId: string;
  month: string;
}

/**
 * ما تبعته الشاشة للمسارين لتحديد الفترة: الشهر `YYYY-MM` والفرع (اختياري). الـAPI هو اللي يحوّل الشهر لنافذة لحظات بتوقيت
 * النشاط (D-B12)، فالمتصفح ما بيحسبش `from` ولا `to` ولا يختار توقيتًا.
 */
export interface RatingsPeriodQuery {
  branch_id?: string;
  month: string;
}

/**
 * توقيت اسم الشهر الافتراضي عند فتح الشاشة فقط: التوقيت الأكثر اشتراكًا بين الفروع، والأبجدي عند التعادل. توقيت النشاط نفسه
 * مش في رد مساحات العمل، فده تقدير لتسمية الشهر الظاهر في الحقل، ومش مصدر لنافذة الطلب (الـAPI بيحسبها بتوقيت النشاط).
 */
function defaultMonthTimeZone(branches: readonly WorkspaceBranch[]): string {
  const counts = new Map<string, number>();
  for (const branch of branches)
    counts.set(branch.effective_timezone, (counts.get(branch.effective_timezone) ?? 0) + 1);
  const ranked = [...counts].sort(
    ([a, countA], [b, countB]) => countB - countA || a.localeCompare(b),
  );
  return ranked[0]?.[0] ?? 'UTC';
}

export function initialRatingsFilters(
  branches: readonly WorkspaceBranch[],
  now: Date,
): RatingsFilters {
  return {
    branchId: '',
    employeeId: '',
    month: currentRatingsMonth(now, defaultMonthTimeZone(branches)),
  };
}

/** الطلب المشترك للجدولين: الشهر المختار لكل الفروع أو لفرع واحد، بنفس الصيغة. */
export function ratingsQuery(filters: RatingsFilters): RatingsPeriodQuery {
  return filters.branchId
    ? { branch_id: filters.branchId, month: filters.month }
    : { month: filters.month };
}
