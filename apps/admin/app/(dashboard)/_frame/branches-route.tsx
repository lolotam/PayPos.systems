'use client';
import { t } from '@pospay/i18n';
import { BranchesPage } from '@/settings/branches/pages/branches-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function BranchesRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  if (!workspace.branch) return <p>{t(locale, 'admin.chooseBranch')}</p>;
  return (
    <BranchesPage
      key={`${workspace.company.id}:${userId}:${workspace.business.id}:${workspace.branch.id}`}
      scope={{
        companyId: workspace.company.id,
        userId,
        businessId: workspace.business.id,
        branchId: workspace.branch.id,
      }}
    />
  );
}
