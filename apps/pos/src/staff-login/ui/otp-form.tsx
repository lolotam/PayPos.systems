import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useOtpForm } from '../api/use-otp-form';
import { PhoneForm } from './phone-form';
import { CodeForm } from './code-form';

export function OtpForm({ onSignedIn }: { onSignedIn(): void }) {
  const locale = useLocale();
  const { phone, challenge, remaining, pending, error, request, verify } = useOtpForm(onSignedIn);
  return (
    <section className="flex flex-col gap-4">
      <p>{t(locale, 'staffLogin.recovery')}</p>
      {error === null ? null : (
        <p role="alert">
          {t(locale, error === 'invalid' ? 'errors.OTP_INVALID' : 'errors.OTP_UNAVAILABLE')}
        </p>
      )}
      {challenge === null ? (
        <PhoneForm pending={pending} onSubmit={request} />
      ) : (
        <>
          <CodeForm key={challenge} challengeId={challenge} pending={pending} onSubmit={verify} />
          <p aria-live="polite">
            {t(locale, 'staffLogin.countdown')} {remaining}
          </p>
          <Button
            disabled={pending || remaining > 0}
            onClick={() => {
              if (phone !== null) void request(phone);
            }}
          >
            {t(locale, 'staffLogin.newCode')}
          </Button>
        </>
      )}
    </section>
  );
}
