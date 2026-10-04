'use client';
import { t } from '@pospay/i18n';
import { LeaveInboxPage } from '@/staff/pages/leave-inbox-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';
export function LeaveInboxRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  const scope = { companyId: workspace.company.id, businessId: workspace.business.id, userId };
  return (
    <LeaveInboxPage
      key={`${scope.companyId}:${scope.businessId}:${scope.userId}`}
      scope={scope}
      branches={workspace.business.branches}
    />
  );
}
