'use client';
import { useState } from 'react';
import { usePermissionMemberships } from '../api/use-permissions';
import { PermissionMembershipList } from './permission-membership-list';
import { MembershipPermissionsPanel } from './membership-permissions-panel';

export function PermissionMembershipBrowser({
  companyId,
  userId,
  businessId,
  scopeNames,
  branchTimeZones,
}: {
  companyId: string;
  userId: string;
  businessId?: string | undefined;
  scopeNames: Readonly<Record<string, string>>;
  branchTimeZones: Readonly<Record<string, string>>;
}) {
  const [cursor, setCursor] = useState<string>();
  const [membershipId, setMembershipId] = useState('');
  const list = usePermissionMemberships(companyId, userId, cursor, businessId);
  const blocked = list.isPending || list.isFetching || list.isError || list.failureCount > 0;
  const selected = list.data?.items.some((item) => item.id === membershipId);
  return (
    <>
      <PermissionMembershipList
        list={list}
        cursor={cursor}
        membershipId={membershipId}
        scopeNames={scopeNames}
        onSelect={setMembershipId}
        onCursor={(next) => {
          setCursor(next);
          setMembershipId('');
        }}
      />
      {membershipId && selected ? (
        <fieldset hidden={blocked} disabled={blocked} className="min-w-0">
          <MembershipPermissionsPanel
            key={membershipId}
            companyId={companyId}
            userId={userId}
            membershipId={membershipId}
            businessId={businessId}
            branchTimeZones={branchTimeZones}
          />
        </fieldset>
      ) : null}
    </>
  );
}
