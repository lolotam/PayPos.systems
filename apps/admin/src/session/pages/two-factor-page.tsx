'use client';

import { t } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';

import { useVerifyTotp } from '../api/use-verify-totp';
import { GuestFrame } from '../ui/guest-frame';
import { TotpForm } from '../ui/totp-form';

export function TwoFactorPage() {
  const locale = useLocale();
  const verify = useVerifyTotp();
  return (
    <GuestFrame title={t(locale, 'admin.twoFactorTitle')} lead={t(locale, 'admin.twoFactorLead')}>
      <TotpForm pending={verify.pending} error={verify.error} onSubmit={verify.submit} />
    </GuestFrame>
  );
}
