'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useBusinessIdentityAccess } from '@/business-identity/api/use-business-identity-access';
import { identityFailureMessage } from '@/business-identity/model/identity-failure';
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
  const locale = useLocale();
  const access = useBusinessIdentityAccess(props.companyId, props.userId, props.businessId);
  if (access.isPending) return <p role="status">{t(locale, 'admin.loading')}</p>;
  if (access.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert">{identityFailureMessage(access.error, locale)}</p>
        <Button type="button" variant="outline" onClick={() => void access.refetch()}>
          {t(locale, 'pos.retry')}
        </Button>
      </div>
    );
  }
  if (access.data !== true) return <p role="alert">{t(locale, 'errors.FORBIDDEN')}</p>;
  return (
    <BusinessIdentityPage
      key={`${props.companyId}:${props.businessId}:${props.userId}`}
      companyId={props.companyId}
      userId={props.userId}
      businessId={props.businessId}
    />
  );
}
