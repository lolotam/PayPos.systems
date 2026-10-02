'use client';
import type { MembershipPermissions } from '@pospay/contracts';
import { formatInstant, t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

export function PermissionMembershipSummary({
  data,
  timeZone,
}: {
  data: MembershipPermissions;
  timeZone: string;
}) {
  const locale = useLocale();
  return (
    <>
      <p>{t(locale, 'permissions.provisional')}</p>
      <p>
        {t(locale, 'permissions.holder')}: {data.membership.user_id ?? data.membership.employee_id}
      </p>
      <p>
        {t(locale, 'permissions.window')}:{' '}
        {formatInstant(new Date(data.membership.starts_at), locale, timeZone)} ·{' '}
        {data.membership.ends_at
          ? formatInstant(new Date(data.membership.ends_at), locale, timeZone)
          : t(locale, 'permissions.never')}
      </p>
      <h2>{t(locale, 'permissions.defaults')}</h2>
      {data.role_defaults.length === 0 ? (
        <p>{t(locale, 'permissions.noDefaults')}</p>
      ) : (
        <ul>
          {data.role_defaults.map((code) => (
            <li key={code} dir="ltr">
              {code}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
