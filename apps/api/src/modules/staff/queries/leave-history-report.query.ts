import type { TenantWrappers, Tx } from '@pospay/db';
import { leaveHistoryReportSkipsDays, type LeaveHistoryReportQuery } from '@pospay/contracts';
import type { LeaveReadAccess, LeaveReadContext } from './leave-requests.query.ts';
import { readLeaveHistoryPage } from './leave-history.query.ts';

// PP-171 (LH-Q12): التقرير يتبع أهلية #901 زي التبويب؛ موظف من غير ربط ساري يرجع 404 وصفوفه تختفي من القائمة.
// الإعدادان منفصلان لأن اختيار أبو سالم لسه معلق وممكن يفرق بين التقرير المفلتر وغير المفلتر.
const reportAttachment = {
  withEmployee: 'current',
  withoutEmployee: 'current',
} as const;

// الحد اتظبط على seeded fixture (50 موظف، وردية واحدة يوميًا): 1,550 صف ≈ 83ms و2,300 ≈ 135ms و3,050 فوق 200ms (plan D7).
export const LEAVE_HISTORY_SYNC_SHIFTS = 2_000;
// مسار الإجازات بس على seeded fixture (50 موظف): 2,250 صف ≈ 128ms و3,000 ≈ 164ms و3,750 ≈ 200ms (plan D7).
export const LEAVE_HISTORY_SYNC_LEAVES = 2_000;
export type LeaveHistorySyncLimits = { shifts: number; leaves: number };
export const LEAVE_HISTORY_SYNC_LIMIT = Symbol('LEAVE_HISTORY_SYNC_LIMIT');

export async function getBusinessLeaveHistory(
  tx: Tx,
  c: LeaveReadContext,
  q: LeaveHistoryReportQuery,
  access: LeaveReadAccess,
  limits: LeaveHistorySyncLimits,
) {
  const context = {
    ...c,
    ...(q.employee_id === undefined ? {} : { employeeId: q.employee_id }),
  };
  const attachment =
    q.employee_id === undefined ? reportAttachment.withoutEmployee : reportAttachment.withEmployee;
  const scope = await access.check(tx, {
    ...context,
    ...(q.employee_id !== undefined && attachment === 'current'
      ? { purpose: 'history' as const }
      : {}),
  });
  if (!scope || scope.branches.length === 0) return null;
  if (!scope.featureEnabled) return 'FEATURE_DISABLED' as const;
  if (attachment === 'current' && !scope.eligibilityDays?.length) return null;
  return readLeaveHistoryPage(tx, context, q, scope, {
    excludeOpen: false,
    report: { attachment },
    ...(q.employee_id === undefined
      ? {
          workload: {
            leaves: limits.leaves,
            ...(leaveHistoryReportSkipsDays(q) ? {} : { shifts: limits.shifts }),
          },
        }
      : {}),
  });
}

export const LEAVE_HISTORY_REPORT_READER = Symbol('LEAVE_HISTORY_REPORT_READER');
export class LeaveHistoryReportReader {
  constructor(
    private readonly db: TenantWrappers | null,
    private readonly access: LeaveReadAccess,
    private readonly limits: LeaveHistorySyncLimits,
  ) {}
  async execute(context: LeaveReadContext, query: LeaveHistoryReportQuery) {
    if (this.db === null) return 'NOT_READY' as const;
    return this.db.withTenant(
      context.companyId,
      (tx) => getBusinessLeaveHistory(tx, context, query, this.access, this.limits),
      { userId: context.userId },
    );
  }
}
