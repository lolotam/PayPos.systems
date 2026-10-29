'use client';
import { t } from '@pospay/i18n';
import { useAttendanceStatementShifts } from '@/staff/api/use-attendance-statement-shifts';
import { boardAccessLost } from '@/staff/model/attendance-board-display';
import { statementDefaultPeriod } from '@/staff/model/attendance-statement-display';
import { AttendanceStatementPage } from '@/staff/pages/attendance-statement-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function AttendanceStatementRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  const ready = workspace.status === 'ready';
  const business = ready ? workspace.business : undefined;
  const branch = ready ? (workspace.branch ?? business?.branches[0]) : undefined;
  const scope = {
    companyId: ready ? workspace.company.id : '',
    businessId: business?.id ?? '',
    branchId: branch?.id ?? '',
    userId: userId ?? '',
  };
  // فحص الوصول بيستخدم نفس قراءة الشيفتات بتاعت الفترة الافتراضية (FR-001a).
  const probe = useAttendanceStatementShifts(
    scope,
    statementDefaultPeriod(branch?.effective_timezone ?? 'Asia/Kuwait'),
    ready && Boolean(business && branch && userId),
  );
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  if (!branch) return <p>{t(locale, 'attendanceBoard.noBranches')}</p>;
  if (boardAccessLost(probe.error)) {
    return <p role="alert">{t(locale, 'attendanceStatementScreen.noAccess')}</p>;
  }
  return (
    <AttendanceStatementPage
      key={`${scope.companyId}:${scope.businessId}:${scope.branchId}:${userId}`}
      scope={scope}
      branches={workspace.business.branches}
      timezone={branch.effective_timezone}
      onBranch={(branchId) =>
        workspace.choose({
          companyId: scope.companyId,
          businessId: scope.businessId,
          branchId,
        })
      }
    />
  );
}
