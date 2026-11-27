import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { useForgotPin } from '../api/use-forgot-pin';

export function ForgotPinPinStep({ flow }: { flow: ReturnType<typeof useForgotPin> }) {
  const locale = useLocale();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void flow.submitReset();
      }}
    >
      <Label className="text-base" htmlFor="forgot-pin-new">
        {t(locale, 'staffLogin.newPin')}
      </Label>
      <Input
        id="forgot-pin-new"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        disabled={flow.pending}
        value={flow.newPin}
        onChange={(event) => flow.setNewPin(event.target.value)}
      />
      <Label className="text-base" htmlFor="forgot-pin-confirm">
        {t(locale, 'staffLogin.confirmPin')}
      </Label>
      <Input
        id="forgot-pin-confirm"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        disabled={flow.pending}
        value={flow.confirmPin}
        onChange={(event) => flow.setConfirmPin(event.target.value)}
      />
      <Button size="touch" type="submit" disabled={flow.pending}>
        {t(locale, 'staffLogin.changePinSubmit')}
      </Button>
    </form>
  );
}
