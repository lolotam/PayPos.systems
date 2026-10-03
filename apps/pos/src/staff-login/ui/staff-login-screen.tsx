import { t } from '@pospay/i18n';
import { StaffHome } from './staff-home';
import { Button, BrandedPanel, EmptyState, WifiOff, LoaderCircle } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useStaffLogin } from '../api/use-staff-login';
import { OtpForm } from './otp-form';
import { PinForm } from './pin-form';
import { useState } from 'react';

export function StaffLoginScreen() {
  const locale = useLocale();
  const login = useStaffLogin();
  const [pin, setPin] = useState(false);
  const [switching, setSwitching] = useState(false);
  const formVisible = login.session === null || switching;
  const signedIn = () => {
    setSwitching(false);
    login.changed();
  };
  if (!login.online)
    return (
      <EmptyState
        role="status"
        tone="warning"
        icon={<WifiOff />}
        title={t(locale, 'staffLogin.reconnect')}
      />
    );
  if (login.loading)
    return <EmptyState role="status" icon={<LoaderCircle />} title={t(locale, 'pos.loading')} />;
  return (
    <BrandedPanel
      brandTitle={t(locale, 'brand.title')}
      title={t(locale, formVisible ? 'staffLogin.title' : 'staffLogin.signedIn')}
    >
      {formVisible ? (
        <div className="flex flex-col gap-4" key={login.epoch}>
          {pin ? <PinForm onSignedIn={signedIn} /> : <OtpForm onSignedIn={signedIn} />}
          <Button size="touch" variant="outline" onClick={() => setPin(!pin)}>
            {t(locale, pin ? 'staffLogin.useWhatsApp' : 'staffLogin.usePin')}
          </Button>
          {switching ? (
            <Button size="touch" variant="ghost" onClick={() => setSwitching(false)}>
              {t(locale, 'staffLogin.cancelSwitch')}
            </Button>
          ) : null}
        </div>
      ) : login.session === null ? null : (
        <StaffHome
          session={login.session}
          onSwitch={() => setSwitching(true)}
          onSignOut={() => {
            void login.signOut();
          }}
        />
      )}
    </BrandedPanel>
  );
}
