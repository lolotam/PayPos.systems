'use client';

import { t } from '@pospay/i18n';
import { Label, Select } from '@pospay/ui';
import { useState } from 'react';

import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { usePermissionMemberships } from '../api/use-permissions';
import { MembershipPermissionsPanel } from '../ui/membership-permissions-panel';
import { PermissionPageNavigation } from '../ui/permission-page-navigation';

export function PermissionsPage({
  companyId,
  userId,
  branchTimeZones,
}: {
  companyId: string;
  userId: string;
  branchTimeZones: Readonly<Record<string, string>>;
}) {
  const locale = useLocale();
  const [cursor, setCursor] = useState<string>();
  const [membershipId, setMembershipId] = useState('');
  const list = usePermissionMemberships(companyId, userId, cursor);
  return (
    <section className="flex flex-col gap-4 text-start">
      <h1 className="text-xl font-semibold">{t(locale, 'permissions.title')}</h1>
      {list.isPending ? <p>{t(locale, 'admin.loading')}</p> : null}
      {list.isError ? <p role="alert">{envelopeMessage(list.error, locale)}</p> : null}
      {list.data ? (
        <>
          {list.data.items.length === 0 ? <p>{t(locale, 'permissions.empty')}</p> : null}
          <Label htmlFor="permission-membership">{t(locale, 'permissions.person')}</Label>
          <Select
            id="permission-membership"
            value={membershipId}
            placeholder={t(locale, 'permissions.choose')}
            options={list.data.items.map((item) => ({
              value: item.id,
              label: `${locale === 'ar' ? (item.role_name_ar ?? item.role_name_en) : item.role_name_en} · ${item.user_id ?? item.employee_id} · ${item.scope_id}`,
            }))}
            onValueChange={setMembershipId}
          />
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
