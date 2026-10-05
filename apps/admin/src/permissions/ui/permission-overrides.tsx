'use client';

import type { PermissionOverride } from '@pospay/contracts';
import { formatInstant, permissionName, t } from '@pospay/i18n';
import { Badge } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';
import { PermissionRevokeForm } from './permission-revoke-form';

type Props = {
  items: readonly PermissionOverride[];
  branchTimeZones: Readonly<Record<string, string>>;
  onRevoke?: (overrideId: string, reason: string) => void;
  pending?: boolean;
  ended?: boolean;
  businessScoped?: boolean;
};

export function PermissionOverrides({
  items,
  branchTimeZones,
  onRevoke,
  pending = false,
  ended = false,
  businessScoped = false,
}: Props) {
  const locale = useLocale();
  if (items.length === 0) return <p>{t(locale, 'permissions.noOverrides')}</p>;
  return (
    <ul className="flex flex-col gap-3 text-start">
      {items.map((row) => (
        <li
          key={row.id}
          className={`min-w-0 break-words rounded-card border border-border p-4 ${ended ? 'bg-secondary/50 text-muted-foreground' : 'bg-card'}`}
        >
          {permissionName(locale, row.permission_code)} <span dir="ltr">{row.permission_code}</span>{' '}
          <Badge variant={ended ? 'neutral' : row.effect === 'ALLOW' ? 'brand' : 'danger'}>
            {t(locale, row.effect === 'ALLOW' ? 'permissions.allow' : 'permissions.deny')}
          </Badge>
          <p>
            {t(locale, 'permissions.scope')}:{' '}
            {t(
              locale,
              row.scope_type === 'COMPANY'
                ? 'permissions.company'
                : row.scope_type === 'BUSINESS'
                  ? 'permissions.business'
                  : 'permissions.branch',
            )}{' '}
            · {row.scope_id}
          </p>
          {onRevoke && (!businessScoped || row.scope_type !== 'COMPANY') ? (
            <PermissionRevokeForm overrideId={row.id} disabled={pending} onRevoke={onRevoke} />
          ) : null}
          <p>
            {t(locale, 'permissions.reason')}: {row.reason}
          </p>
          <p>
            {t(locale, 'permissions.expiresAt')}:{' '}
            {row.expires_at
              ? formatInstant(
                  new Date(row.expires_at),
                  locale,
                  branchTimeZones[row.scope_id] ?? 'UTC',
                )
              : t(locale, 'permissions.never')}
          </p>
        </li>
      ))}
    </ul>
  );
}
