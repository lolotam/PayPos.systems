'use client';

import { t } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';

import { useSignIn } from '../api/use-sign-in';
import { GuestFrame } from '../ui/guest-frame';
import { LoginForm } from '../ui/login-form';

// TODO(spec): a signed-in visitor who opens /login stays on this page.

export function LoginPage() {
  const locale = useLocale();
  const signIn = useSignIn();
  return (
    <GuestFrame title={t(locale, 'admin.signInTitle')} lead={t(locale, 'admin.signInLead')}>
      <LoginForm pending={signIn.pending} error={signIn.error} onSubmit={signIn.submit} />
    </GuestFrame>
  );
}
