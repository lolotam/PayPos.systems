'use client';

import { t } from '@pospay/i18n';
import { Card, CardContent } from '@pospay/ui';
import { useState } from 'react';

import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { usePermissions } from '../api/use-permissions';
import { PermissionMembershipDecisions } from './permission-membership-decisions';
import { PermissionOverrides } from './permission-overrides';
import { PermissionMembershipSummary } from './permission-membership-summary';
import { PermissionPageNavigation } from './permission-page-navigation';
import { MembershipDiscountLimit } from './membership-discount-limit';
import { PermissionMembershipTitle } from './permission-membership-title';

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
  if (detail.isPending) return <p>{t(locale, 'admin.loading')}</p>;
  if (detail.isError) return <p role="alert">{envelopeMessage(detail.error, locale)}</p>;
  const data = detail.data;
  return (
    <Card>
      <PermissionMembershipTitle membership={data.membership} />
      <CardContent className="flex flex-col gap-4 text-start">
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
        <h2>{t(locale, 'permissions.history')}</h2>
        <PermissionOverrides items={data.ended_overrides.items} branchTimeZones={branchTimeZones} />
        <PermissionPageNavigation
          cursor={historyCursor}
          next={data.ended_overrides.next_cursor}
          onChange={setHistoryCursor}
        />
      </CardContent>
    </Card>
  );
}
