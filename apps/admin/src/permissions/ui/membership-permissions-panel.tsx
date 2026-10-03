'use client';

import { Card, CardContent } from '@pospay/ui';
import { useState } from 'react';

import { usePermissions } from '../api/use-permissions';
import { PermissionMembershipDecisions } from './permission-membership-decisions';
import { PermissionMembershipSummary } from './permission-membership-summary';
import { PermissionMembershipHistory } from './permission-membership-history';
import { MembershipDiscountLimit } from './membership-discount-limit';
import { PermissionMembershipHeading } from './permission-membership-heading';
import { PermissionDetailState } from './permission-detail-state';

type Props = {
  companyId: string;
  userId: string;
  membershipId: string;
  branchTimeZones?: Readonly<Record<string, string>>;
};

export function MembershipPermissionsPanel({
  companyId,
  userId,
  membershipId,
  branchTimeZones = {},
}: Props) {
  const [cursor, setCursor] = useState<string>();
  const [historyCursor, setHistoryCursor] = useState<string>();
  const { detail, save, revoke } = usePermissions(
    companyId,
    userId,
    membershipId,
    cursor,
    historyCursor,
  );
  if (detail.isPending || detail.isError)
    return <PermissionDetailState pending={detail.isPending} error={detail.error} />;
  const data = detail.data;
  return (
    <Card>
      <PermissionMembershipHeading membership={data.membership} />
      <CardContent className="flex min-w-0 flex-col gap-6 text-start">
        <PermissionMembershipSummary
          data={data}
          timeZone={branchTimeZones[data.membership.scope_id] ?? 'UTC'}
        />
        <PermissionMembershipDecisions
          data={data}
          companyId={companyId}
          branchTimeZones={branchTimeZones}
          save={save}
          revoke={revoke}
          cursor={cursor}
          onCursorChange={setCursor}
        />
        <MembershipDiscountLimit
          companyId={companyId}
          userId={userId}
          membershipId={membershipId}
          limitBps={data.discount_limit.limit_bps}
          disabled={!data.editing_enabled}
        />
        <PermissionMembershipHistory
          data={data}
          branchTimeZones={branchTimeZones}
          cursor={historyCursor}
          onCursorChange={setHistoryCursor}
        />
      </CardContent>
    </Card>
  );
}
