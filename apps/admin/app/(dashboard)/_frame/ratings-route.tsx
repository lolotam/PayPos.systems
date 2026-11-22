'use client';
import { t } from '@pospay/i18n';
import { RatingsPage } from '@/ratings/pages/ratings-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function RatingsRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  return (
    <RatingsPage
      key={`${workspace.company.id}:${userId}:${workspace.business.id}`}
      companyId={workspace.company.id}
      userId={userId}
      business={workspace.business}
    />
  );
}
