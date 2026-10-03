'use client';

import { t } from '@pospay/i18n';
import { PageHeader, EmptyState, UserRound } from '@pospay/ui';
import { useState } from 'react';

import { useLocale } from '@/shared/locale/locale-context';
import { usePermissionMemberships } from '../api/use-permissions';
import { MembershipPermissionsPanel } from '../ui/membership-permissions-panel';
import { PermissionPageNavigation } from '../ui/permission-page-navigation';
import { PermissionMembershipTable } from '../ui/permission-membership-table';
import { BusinessDiscountDefault } from '../ui/business-discount-default';
import { PermissionListFeedback } from '../ui/permission-list-feedback';

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
  const [cursor, setCursor] = useState<string>();
  const [membershipId, setMembershipId] = useState('');
  const list = usePermissionMemberships(companyId, userId, cursor);
  return (
    <section className="flex min-w-0 flex-col gap-12 text-start">
      <PageHeader
        title={t(locale, 'permissions.title')}
        description={t(locale, 'shell.permissionsLead')}
      />
      {business ? (
        <BusinessDiscountDefault
          key={business.id}
          companyId={companyId}
          userId={userId}
          businessId={business.id}
          businessName={business.name}
        />
      ) : null}
      <PermissionListFeedback pending={list.isPending} failed={list.isError} error={list.error} />
      {list.data ? (
        <>
          {list.data.items.length === 0 ? (
            <EmptyState icon={<UserRound />} title={t(locale, 'permissions.empty')} />
          ) : (
            <PermissionMembershipTable
              items={list.data.items}
              selectedId={membershipId}
              scopeNames={scopeNames}
              onSelect={setMembershipId}
            />
          )}
          <PermissionPageNavigation
            cursor={cursor}
            next={list.data.next_cursor}
            onChange={(next) => {
              setCursor(next);
              setMembershipId('');
            }}
          />
        </>
      ) : null}
      {membershipId ? (
        <MembershipPermissionsPanel
          key={membershipId}
          companyId={companyId}
          userId={userId}
          membershipId={membershipId}
          branchTimeZones={branchTimeZones}
        />
      ) : null}
    </section>
  );
}
