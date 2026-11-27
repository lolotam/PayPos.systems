import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useForgotPin, type ForgotPinFault } from '../api/use-forgot-pin';
import { ForgotPinChannelStep } from './forgot-pin-channel-step';
import { ForgotPinCodeStep } from './forgot-pin-code-step';
import { ForgotPinPinStep } from './forgot-pin-pin-step';

const FAULT_KEYS = {
  identifier: 'staffLogin.forgotPinIdentifierInvalid',
  codeFormat: 'staffLogin.forgotPinCodeFormat',
  format: 'staffLogin.pinFormatInvalid',
  mismatch: 'staffLogin.pinMismatch',
  invalid: 'staffLogin.forgotPinInvalid',
  limited: 'staffLogin.forgotPinLimited',
  unavailable: 'staffLogin.forgotPinChannelUnavailable',
  refused: 'staffLogin.forgotPinRefused',
} as const satisfies Record<ForgotPinFault, string>;

export function ForgotPinFlow({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const locale = useLocale();
  const flow = useForgotPin(onDone);
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t(locale, 'staffLogin.forgotPinTitle')}</h2>
      {flow.fault !== null ? (
        <p role="alert" className="text-destructive">
          {t(locale, FAULT_KEYS[flow.fault])}
        </p>
      ) : null}
      {flow.step === 'channel' ? (
        <ForgotPinChannelStep pending={flow.pending} onSubmit={flow.requestCode} />
      ) : null}
      {flow.step === 'code' ? <ForgotPinCodeStep flow={flow} /> : null}
      {flow.step === 'pin' ? <ForgotPinPinStep flow={flow} /> : null}
      <Button size="touch" variant="outline" disabled={flow.pending} onClick={onCancel}>
        {t(locale, 'staffLogin.changePinCancel')}
      </Button>
    </section>
  );
}
