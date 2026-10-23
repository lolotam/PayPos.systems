'use client';

import { t } from '@pospay/i18n';
import { useSessionUser } from '@/session/api/use-session';
import { StaffAppColumnsPage } from '@/settings/staff-app-columns/pages/staff-app-columns-page';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function StaffAppColumnsRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  return (
    <StaffAppColumnsPage
      key={`${workspace.company.id}:${workspace.business.id}:${userId}`}
      companyId={workspace.company.id}
      userId={userId}
      businessId={workspace.business.id}
    />
  );
}
