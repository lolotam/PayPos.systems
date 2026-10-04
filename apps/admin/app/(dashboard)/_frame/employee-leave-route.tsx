'use client';
import { t } from '@pospay/i18n';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';
import { EmployeeLeaveSection } from '@/staff/ui/employee-leave-section';
export function EmployeeLeaveRoute({ employeeId }: { employeeId: string }) {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  return (
    <EmployeeLeaveSection
      key={`${workspace.company.id}:${workspace.business.id}:${userId}:${employeeId}`}
      companyId={workspace.company.id}
      businessId={workspace.business.id}
      userId={userId}
      employeeId={employeeId}
      branches={workspace.business.branches}
    />
  );
}
