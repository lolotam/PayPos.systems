'use client';
import { t, type Locale } from '@pospay/i18n';
import { Card } from '@pospay/ui';

import type { SessionCustomerProfileEntry } from '../api/use-session-customer-profile';
import type { SessionCustomerSelection } from './session-customer-field';
import { CustomerPackagesLink } from './customer-packages-link';
import { SessionCustomerProfileCard } from './session-customer-profile-card';

type SelectedCardProps = {
  value: SessionCustomerSelection;
  locale: Locale;
  packages: { companyId: string; businessId: string; branchId: string; userId: string } | null;
  profile: Omit<SessionCustomerProfileEntry, 'customerId'>;
  online: boolean | null;
};

export function SelectedCustomerCard({ value, locale, packages, profile, online }: SelectedCardProps) {
  return (
    <Card role="status" className="p-3">
      <p>{t(locale, 'serviceSessions.selected')}</p>
      <p>{value.name}</p>
      <bdi>{value.phone}</bdi>
      <SessionCustomerProfileCard customerId={value.id} locale={locale} online={online} {...profile} />
      {/* رابط الباقات يظهر بس لما النموذج يمرر نطاق النشاط والفرع؛ التلميحات معرّفات بس. */}
      {packages !== null ? (
        <CustomerPackagesLink
          customerId={value.id}
          newTab
          hints={{
            companyId: packages.companyId,
            businessId: packages.businessId,
            branchId: packages.branchId,
          }}
        />
      ) : null}
    </Card>
  );
}
