'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

/** زرار «إرسال كود جديد»: مقفول لحد ما العدّاد يخلص، وبيعرض الثواني المتبقية. */
export function PasswordResetResendButton({
  disabled,
  cooldown,
  onResend,
}: {
  disabled: boolean;
  cooldown: number;
  onResend: () => Promise<void>;
}) {
  const locale = useLocale();
  return (
    <Button
      type="button"
      variant="link"
      onClick={() => void onResend()}
      disabled={disabled || cooldown > 0}
    >
      {cooldown > 0
        ? t(locale, 'passwordReset.resendWait').replace('{seconds}', String(cooldown))
        : t(locale, 'passwordReset.resend')}
    </Button>
  );
}
