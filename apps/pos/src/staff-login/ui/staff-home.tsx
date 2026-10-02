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
    <>
      <p>{formatRemainingMinutes(new Date(session.expires_at), new Date(), locale)}</p>
      <Button onClick={onSwitch}>{t(locale, 'staffLogin.switchOperator')}</Button>
      <Button onClick={onSignOut}>{t(locale, 'staffLogin.signOut')}</Button>
    </>
  );
}
