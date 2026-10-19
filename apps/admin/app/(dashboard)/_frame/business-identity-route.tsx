'use client';

import { t } from '@pospay/i18n';
import { useBusinessIdentityAccess } from '@/business-identity/api/use-business-identity-access';
import { BusinessIdentityPage } from '@/business-identity/pages/business-identity-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function BusinessIdentityRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  return (
    <GatedBusinessIdentity
      companyId={workspace.company.id}
      userId={userId}
      businessId={workspace.business.id}
    />
  );
}

function GatedBusinessIdentity(props: { companyId: string; userId: string; businessId: string }) {
  const access = useBusinessIdentityAccess(props.companyId, props.userId, props.businessId);
  if (access.isPending || access.isError || access.data !== true) return null;
  return (
    <BusinessIdentityPage
      key={`${props.companyId}:${props.businessId}:${props.userId}`}
      companyId={props.companyId}
      userId={props.userId}
      businessId={props.businessId}
    />
  );
}
