import type { LeaveHistoryReportStoredScope } from './leave-history-report-request.ts';

/** مجموعات الفروع الحية التي تقارن بالنطاق المجمد دون إدخال تواريخ الأهلية في القرار. */
export interface LeaveHistoryReportCurrentScope {
  readonly branches: readonly string[];
  readonly attendanceBranches: readonly string[];
  readonly eligibilityBranchIds: readonly string[];
}

function containsAll(current: readonly string[], frozen: readonly string[]): boolean {
  const available = new Set(current);
  return frozen.every((branchId) => available.has(branchId));
}

/**
 * يكشف فقدان أي فرع كان أساس التقرير، مع تجاهل تواريخ الأهلية حتى لا تنتهي صلاحية النتيجة عند منتصف الليل.
 *
 * @param frozen نطاق الفروع المحفوظ عند قبول التقرير
 * @param current مجموعات الفروع الحية بعد إعادة فحص القراءة
 * @returns true عندما لا تبقى كل فروع التقرير ضمن الوصول الحالي
 */
export function leaveHistoryReportScopeIsStale(
  frozen: LeaveHistoryReportStoredScope,
  current: LeaveHistoryReportCurrentScope,
): boolean {
  return (
    !containsAll(current.branches, frozen.branches) ||
    !containsAll(current.attendanceBranches, frozen.attendanceBranches) ||
    !containsAll(current.eligibilityBranchIds, frozen.eligibilityBranchIds)
  );
}
