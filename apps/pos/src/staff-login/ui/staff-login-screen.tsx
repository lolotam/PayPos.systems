import { t } from '@pospay/i18n';
import { StaffHome } from './staff-home';
import { Button } from '@pospay/ui';
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
  if (!login.online) return <p role="status">{t(locale, 'staffLogin.reconnect')}</p>;
  if (login.loading) return <p role="status">{t(locale, 'pos.loading')}</p>;
  return (
    <section className="flex flex-col gap-4 text-start">
      <h1 className="text-lg font-bold">
        {t(locale, formVisible ? 'staffLogin.title' : 'staffLogin.signedIn')}
      </h1>
      {formVisible ? (
        <div className="flex flex-col gap-4" key={login.epoch}>
          {pin ? <PinForm onSignedIn={signedIn} /> : <OtpForm onSignedIn={signedIn} />}
          <Button onClick={() => setPin(!pin)}>
            {t(locale, pin ? 'staffLogin.useWhatsApp' : 'staffLogin.usePin')}
          </Button>
          {switching ? (
            <Button onClick={() => setSwitching(false)}>
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
    </section>
  );
}
