'use client';

import { t } from '@pospay/i18n';
import { Card, CardContent, EmptyState, CircleAlert, LoaderCircle } from '@pospay/ui';
import { useState } from 'react';

import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { usePermissions } from '../api/use-permissions';
import { PermissionMembershipDecisions } from './permission-membership-decisions';
import { PermissionMembershipSummary } from './permission-membership-summary';
import { PermissionMembershipHistory } from './permission-membership-history';
import { PermissionMembershipHeading } from './permission-membership-heading';

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
  const locale = useLocale();
  const [cursor, setCursor] = useState<string>();
  const [historyCursor, setHistoryCursor] = useState<string>();
  const { detail, save, revoke } = usePermissions(
    companyId,
    userId,
    membershipId,
    cursor,
    historyCursor,
  );
  if (detail.isPending)
    return <EmptyState role="status" icon={<LoaderCircle />} title={t(locale, 'admin.loading')} />;
  if (detail.isError)
    return (
      <EmptyState
        role="alert"
        tone="danger"
        icon={<CircleAlert />}
        title={envelopeMessage(detail.error, locale)}
      />
    );
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
