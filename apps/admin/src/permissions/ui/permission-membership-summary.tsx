'use client';
import type { MembershipPermissions } from '@pospay/contracts';
import { formatInstant, permissionName, t } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
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
    <section className="flex min-w-0 flex-col gap-2 rounded-card border border-border p-4">
      <p className="break-all text-sm">
        {t(locale, 'permissions.holder')}: {data.membership.user_id ?? data.membership.employee_id}
      </p>
      <p className="text-sm text-muted-foreground">
        {t(locale, 'permissions.window')}:{' '}
        {formatInstant(new Date(data.membership.starts_at), locale, timeZone)} ·{' '}
        {data.membership.ends_at
          ? formatInstant(new Date(data.membership.ends_at), locale, timeZone)
          : t(locale, 'permissions.never')}
      </p>
      <h2 className="mt-4 font-bold">{t(locale, 'permissions.defaults')}</h2>
      {data.role_defaults.length === 0 ? (
        <p>{t(locale, 'permissions.noDefaults')}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {data.role_defaults.map((code) => (
            <li key={code}>
              <Badge variant="neutral">
                {permissionName(locale, code)} · <span dir="ltr">{code}</span>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
