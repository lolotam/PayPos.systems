'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useBusinessIdentityAccess } from '../api/use-business-identity-access';
import { identityFailureMessage } from '../model/identity-failure';
import { BusinessIdentityPage } from './business-identity-page';

export function BusinessIdentityGate(props: {
  companyId: string;
  userId: string;
  businessId: string;
}) {
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
