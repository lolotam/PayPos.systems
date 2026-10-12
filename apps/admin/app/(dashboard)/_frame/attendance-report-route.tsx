'use client';
import { localDate, t } from '@pospay/i18n';
import { AttendanceReportPage } from '@/staff/pages/attendance-report-page';
import { useAttendanceReport } from '@/staff/api/use-attendance-report';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function AttendanceReportRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  const ready = workspace.status === 'ready';
  const business = ready ? workspace.business : undefined;
  const branch = ready ? (workspace.branch ?? business?.branches[0]) : undefined;
  // عقد مساحات العمل يختزل العضويات على مستوى الشركة؛ قراءة النشاط نفسه تثبت تغطية كل فروعه.
  const allBranches = useAttendanceReport(
    {
      companyId: ready ? workspace.company.id : '',
      businessId: business?.id ?? '',
      branchId: 'all',
      userId: userId ?? '',
    },
    localDate(new Date(), branch?.effective_timezone ?? 'Asia/Kuwait').slice(0, 7),
    ready && Boolean(business && branch && userId),
  );
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  if (!branch) return <p>{t(locale, 'attendanceBoard.noBranches')}</p>;
  const scope = {
    companyId: workspace.company.id,
    businessId: workspace.business.id,
    branchId: branch.id,
    userId,
  };
  return (
    <AttendanceReportPage
      key={`${scope.companyId}:${scope.businessId}:${userId}`}
      scope={scope}
      branches={workspace.business.branches}
      allowAllBranches={allBranches.isSuccess}
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
