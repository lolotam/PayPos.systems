'use client';
import { t } from '@pospay/i18n';
import { SchedulesPage } from '@/staff/pages/schedules-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';
export function SchedulesRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business || !workspace.branch)
    return <p>{t(locale, 'shell.schedule_chooseBranch')}</p>;
  const scope = {
    companyId: workspace.company.id,
    businessId: workspace.business.id,
    branchId: workspace.branch.id,
    userId,
  };
  return (
    <SchedulesPage
      key={`${scope.companyId}:${scope.businessId}:${scope.branchId}:${userId}`}
      scope={scope}
      branch={workspace.branch}
    />
  );
}
