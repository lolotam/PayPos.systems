import { t } from '@pospay/i18n';
import { Button, EmptyState, CircleAlert } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useOtpForm } from '../api/use-otp-form';
import { PhoneForm } from './phone-form';
import { CodeForm } from './code-form';

export function OtpForm({ onSignedIn }: { onSignedIn(): void }) {
  const locale = useLocale();
  const { phone, challenge, remaining, pending, error, request, verify } = useOtpForm(onSignedIn);
  return (
    <section className="flex flex-col gap-4">
      <p className="text-base text-muted-foreground">{t(locale, 'staffLogin.recovery')}</p>
      {error === null ? null : (
        <EmptyState
          role="alert"
          tone="danger"
          icon={<CircleAlert />}
          title={t(locale, error === 'invalid' ? 'errors.OTP_INVALID' : 'errors.OTP_UNAVAILABLE')}
          className="p-4"
        />
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
            variant="outline"
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
