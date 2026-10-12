'use client';
import { t } from '@pospay/i18n';
import { AttendanceRequestsPage } from '@/staff/pages/attendance-requests-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';
export function AttendanceRequestsRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  const branch = workspace.branch ?? workspace.business.branches[0];
  if (!branch) return <p>{t(locale, 'attendanceBoard.noBranches')}</p>;
  const scope = {
    companyId: workspace.company.id,
    businessId: workspace.business.id,
    branchId: branch.id,
    userId,
  };
  return (
    <AttendanceRequestsPage
      key={`${scope.companyId}:${scope.businessId}:${userId}`}
      scope={scope}
      branches={workspace.business.branches}
      onBranch={(branchId) =>
        workspace.choose({ companyId: scope.companyId, businessId: scope.businessId, branchId })
      }
    />
  );
}
