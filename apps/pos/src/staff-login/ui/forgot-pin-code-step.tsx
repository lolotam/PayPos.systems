import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { useForgotPin } from '../api/use-forgot-pin';

export function ForgotPinCodeStep({ flow }: { flow: ReturnType<typeof useForgotPin> }) {
  const locale = useLocale();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        flow.continueToPin();
      }}
    >
      <p className="text-base text-muted-foreground">
        {t(locale, 'staffLogin.forgotPinCodePrompt')}
      </p>
      <Label className="text-base" htmlFor="forgot-pin-code">
        {t(locale, 'staffLogin.code')}
      </Label>
      <Input
        id="forgot-pin-code"
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        disabled={flow.pending}
        value={flow.code}
        onChange={(event) => flow.setCode(event.target.value)}
      />
      <Button size="touch" type="submit" disabled={flow.pending}>
        {t(locale, 'staffLogin.forgotPinContinue')}
      </Button>
      <p aria-live="polite">
        {t(locale, 'staffLogin.countdown')} {flow.remaining}
      </p>
      <Button
        size="touch"
        variant="outline"
        type="button"
        disabled={flow.pending || flow.remaining > 0}
        onClick={() => void flow.resend()}
      >
        {t(locale, 'staffLogin.newCode')}
      </Button>
    </form>
  );
}
