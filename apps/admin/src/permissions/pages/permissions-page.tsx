'use client';

import { t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useState } from 'react';

import { useLocale } from '@/shared/locale/locale-context';
import { PermissionMembershipBrowser } from '../ui/permission-membership-browser';
import { BusinessDiscountDefault } from '../ui/business-discount-default';
import { PermissionManagementScope } from '../ui/permission-management-scope';

type Props = {
  companyId: string;
  userId: string;
  branchTimeZones: Readonly<Record<string, string>>;
  scopeNames: Readonly<Record<string, string>>;
  business?: { id: string; name: string } | undefined;
};

export function PermissionsPage(props: Props) {
  const { companyId, userId, branchTimeZones, scopeNames, business } = props;
  const locale = useLocale();
  const [scope, setScope] = useState(business ? 'business' : 'company');
  const businessId = scope === 'business' ? business?.id : undefined;
  return (
    <section className="flex min-w-0 flex-col gap-12 text-start">
      <PageHeader
        title={t(locale, 'permissions.title')}
        description={t(locale, 'shell.permissionsLead')}
      />
      {business ? (
        <PermissionManagementScope value={scope} businessName={business.name} onChange={setScope} />
      ) : null}
      {business ? (
        <BusinessDiscountDefault
          key={`discount:${business.id}`}
          companyId={companyId}
          userId={userId}
          businessId={business.id}
          businessName={business.name}
        />
      ) : null}
      <PermissionMembershipBrowser
        key={`members:${businessId ?? companyId}`}
        companyId={companyId}
        userId={userId}
        businessId={businessId}
        scopeNames={scopeNames}
        branchTimeZones={branchTimeZones}
      />
    </section>
  );
}
