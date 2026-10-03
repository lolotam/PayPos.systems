import type { StaffSessionContext } from '@pospay/contracts';
import { formatRemainingMinutes, t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function StaffHome({
  session,
  onSwitch,
  onSignOut,
}: {
  session: StaffSessionContext;
  onSwitch(): void;
  onSignOut(): void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-2">
      <p className="mb-4 tabular-nums text-muted-foreground">
        {formatRemainingMinutes(new Date(session.expires_at), new Date(), locale)}
      </p>
      <Button size="touch" variant="secondary" onClick={onSwitch}>
        {t(locale, 'staffLogin.switchOperator')}
      </Button>
      <Button size="touch" variant="ghost" onClick={onSignOut}>
        {t(locale, 'staffLogin.signOut')}
      </Button>
    </div>
  );
}
