import { t } from '@pospay/i18n';
import { UserRound } from '@pospay/ui';
import type { SessionAccount } from '@/session/api/session-account';
import { useLocale } from '@/shared/locale/locale-context';

export function DashboardAccount({ account }: { account: SessionAccount | null }) {
  const locale = useLocale();
  return (
    <div className="flex items-start gap-2 text-sm">
      <UserRound aria-hidden="true" className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t(locale, 'shell.account')}</p>
        {account?.name ? (
          <p title={account.name} className="truncate text-sm">
            {account.name}
          </p>
        ) : null}
        {account?.email ? (
          <p
            dir="ltr"
            title={account.email}
            className="truncate text-xs text-sidebar-foreground/80"
          >
            {account.email}
          </p>
        ) : null}
      </div>
    </div>
  );
}
