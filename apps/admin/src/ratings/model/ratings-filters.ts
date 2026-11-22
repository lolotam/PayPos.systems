import type { WorkspaceBranch } from '@pospay/contracts';
import { currentRatingsMonth, ratingsMonthRange } from './ratings-period';

/** فلاتر الشاشة كما اختارها المستخدم؛ السلسلة الفارغة معناها «الكل». */
export interface RatingsFilters {
  branchId: string;
  employeeId: string;
  month: string;
}

/** نطاق الاستعلام المبعوت للـ API: الفترة دايمًا صريحة عشان الجدولين يغطّوا نفس الشهر. */
export interface RatingsRange {
  branch_id?: string;
  from: string;
  to: string;
}

/** توقيت الفرع المحدد، أو الفرع الأول عند «كل الفروع» لأن توقيت النشاط مش متاح هنا. */
export function ratingsTimeZone(branches: readonly WorkspaceBranch[], branchId: string): string {
  const branch = branches.find((candidate) => candidate.id === branchId) ?? branches[0];
  return branch?.effective_timezone ?? 'UTC';
}

export function initialRatingsFilters(
  branches: readonly WorkspaceBranch[],
  now: Date,
): RatingsFilters {
  return {
    branchId: '',
    employeeId: '',
    month: currentRatingsMonth(now, ratingsTimeZone(branches, '')),
  };
}

export function ratingsRange(
  filters: RatingsFilters,
  branches: readonly WorkspaceBranch[],
): RatingsRange {
  const range = ratingsMonthRange(filters.month, ratingsTimeZone(branches, filters.branchId));
  return filters.branchId ? { branch_id: filters.branchId, ...range } : range;
}
