'use client';
import { t } from '@pospay/i18n';
import { ImportedRefundsPage } from '@/settings/imported-refunds/pages/imported-refunds-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function ImportedRefundsRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  return (
    <ImportedRefundsPage
      key={`${workspace.company.id}:${userId}:${workspace.business.id}`}
      companyId={workspace.company.id}
      userId={userId}
      businessId={workspace.business.id}
    />
  );
}
