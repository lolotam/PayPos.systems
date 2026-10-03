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
      {membershipId ? (
        <MembershipPermissionsPanel
          key={membershipId}
          companyId={companyId}
          userId={userId}
          membershipId={membershipId}
          businessId={businessId}
          branchTimeZones={branchTimeZones}
        />
      ) : null}
    </>
  );
}
