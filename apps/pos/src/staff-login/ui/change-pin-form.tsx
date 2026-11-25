import { t, type Locale } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useChangePinForm, type ChangePinFault } from '../api/use-change-pin-form';

type ChangePinFormProps = {
  proof: string;
  onChanged: () => void;
  onExpired: () => void;
  onCancel: () => void;
};

function faultMessage(locale: Locale, fault: ChangePinFault): string {
  if (fault === 'format') return t(locale, 'staffLogin.pinFormatInvalid');
  if (fault === 'mismatch') return t(locale, 'staffLogin.pinMismatch');
  return t(locale, 'staffLogin.pinChangeInvalid');
}

export function ChangePinForm({ proof, onChanged, onExpired, onCancel }: ChangePinFormProps) {
  const locale = useLocale();
  const change = useChangePinForm(proof, onChanged, onExpired);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void change.submit();
      }}
    >
      <h2 className="text-lg font-semibold">{t(locale, 'staffLogin.changePinTitle')}</h2>
      <p className="text-base text-muted-foreground">{t(locale, 'staffLogin.changePinPrompt')}</p>
      <Label className="text-base" htmlFor="new-staff-pin">
        {t(locale, 'staffLogin.newPin')}
      </Label>
      <Input
        id="new-staff-pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        disabled={change.pending}
        value={change.newPin}
        onChange={(event) => change.setNewPin(event.target.value)}
      />
      <Label className="text-base" htmlFor="confirm-staff-pin">
        {t(locale, 'staffLogin.confirmPin')}
      </Label>
      <Input
        id="confirm-staff-pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        disabled={change.pending}
        value={change.confirmPin}
        onChange={(event) => change.setConfirmPin(event.target.value)}
      />
      {change.fault !== null ? (
        <p role="alert" className="text-destructive">
          {faultMessage(locale, change.fault)}
        </p>
      ) : null}
      <Button size="touch" type="submit" disabled={change.pending}>
        {t(locale, 'staffLogin.changePinSubmit')}
      </Button>
      <Button size="touch" variant="outline" disabled={change.pending} onClick={onCancel}>
        {t(locale, 'staffLogin.changePinCancel')}
      </Button>
    </form>
  );
}
