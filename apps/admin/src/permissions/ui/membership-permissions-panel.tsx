'use client';

import { t } from '@pospay/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@pospay/ui';
import { useState } from 'react';

import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { usePermissions } from '../api/use-permissions';
import { PermissionOverrideForm } from './permission-override-form';
import { PermissionOverrides } from './permission-overrides';
import { PermissionMembershipSummary } from './permission-membership-summary';
import { PermissionPageNavigation } from './permission-page-navigation';

export function MembershipPermissionsPanel({
  companyId,
  userId,
  membershipId,
  branchTimeZones = {},
}: {
  companyId: string;
  userId: string;
  membershipId: string;
  branchTimeZones?: Readonly<Record<string, string>>;
}) {
  const locale = useLocale();
  const [cursor, setCursor] = useState<string>();
  const { detail, save } = usePermissions(companyId, userId, membershipId, cursor);
  if (detail.isPending) return <p>{t(locale, 'admin.loading')}</p>;
  if (detail.isError) return <p role="alert">{envelopeMessage(detail.error, locale)}</p>;
  const data = detail.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {locale === 'ar'
            ? (data.membership.role_name_ar ?? data.membership.role_name_en)
            : data.membership.role_name_en}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-start">
        <PermissionMembershipSummary
          data={data}
          timeZone={branchTimeZones[data.membership.scope_id] ?? 'UTC'}
        />
        <h2>{t(locale, 'permissions.overrides')}</h2>
        <PermissionOverrides items={data.overrides.items} branchTimeZones={branchTimeZones} />
        <PermissionPageNavigation
          cursor={cursor}
          next={data.overrides.next_cursor}
          onChange={setCursor}
        />
        {!data.editing_enabled ? (
          <p role="status">{t(locale, 'permissions.policyPending')}</p>
        ) : null}
        <PermissionOverrideForm
          companyId={companyId}
          catalog={data.permission_catalog}
          disabled={!data.editing_enabled}
          pending={save.isPending}
          onSave={(terms) => save.mutate(terms)}
        />
        {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
        {save.isSuccess ? <p role="status">{t(locale, 'permissions.saved')}</p> : null}
      </CardContent>
    </Card>
  );
}
