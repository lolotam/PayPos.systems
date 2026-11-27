import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { staffPinInput, type StaffPinInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { usePinForm } from '../api/use-pin-form';
import { ChangePinForm } from './change-pin-form';
import { ForgotPinFlow } from './forgot-pin-flow';

type PinNotice = 'changed' | 'expired' | 'reset' | null;

type PinStep =
  | { readonly kind: 'sign_in'; readonly notice: PinNotice }
  | { readonly kind: 'change'; readonly proof: string }
  | { readonly kind: 'forgot' };

type PinMessage = { readonly text: string; readonly destructive: boolean };

type PinLoginState = { readonly expired: boolean; readonly invalid: boolean };

// رسالة واحدة للشاشة: حفظ ناجح أو انتهاء مدّة أو رفض؛ وكلها alert عشان الكاشير تشوفها من غير ما تقرا.
function pinMessage(
  locale: Locale,
  notice: PinNotice,
  login: PinLoginState,
  errors: object,
): PinMessage | null {
  if (notice === 'changed')
    return { text: t(locale, 'staffLogin.pinChangedSignIn'), destructive: false };
  if (notice === 'reset')
    return { text: t(locale, 'staffLogin.forgotPinDone'), destructive: false };
  if (login.expired || notice === 'expired')
    return { text: t(locale, 'staffLogin.pinExpired'), destructive: true };
  if (login.invalid || Object.keys(errors).length !== 0)
    return { text: t(locale, 'staffLogin.pinInvalid'), destructive: true };
  return null;
}

export function PinForm({ onSignedIn }: { onSignedIn: () => void }) {
  const locale = useLocale();
  const [step, setStep] = useState<PinStep>({ kind: 'sign_in', notice: null });
  const login = usePinForm(onSignedIn, (proof) => setStep({ kind: 'change', proof }));
  const form = useForm<StaffPinInput>({ resolver: zodResolver(staffPinInput) });
  // الدليل في الذاكرة بس، ولو الشاشة نزلت (تبديل مشغل، انقطاع، خروج) ما يفضلش معاها.
  useEffect(() => () => setStep({ kind: 'sign_in', notice: null }), []);
  const submit = async (input: StaffPinInput) => {
    setStep({ kind: 'sign_in', notice: null });
    await login.submit(input);
    form.resetField('pin');
  };
  if (step.kind === 'change')
    return (
      <ChangePinForm
        proof={step.proof}
        onChanged={() => setStep({ kind: 'sign_in', notice: 'changed' })}
        onExpired={() => setStep({ kind: 'sign_in', notice: 'expired' })}
        onCancel={() => setStep({ kind: 'sign_in', notice: null })}
      />
    );
  if (step.kind === 'forgot')
    return (
      <ForgotPinFlow
        onDone={() => setStep({ kind: 'sign_in', notice: 'reset' })}
        onCancel={() => setStep({ kind: 'sign_in', notice: null })}
      />
    );
  const message = pinMessage(locale, step.notice, login, form.formState.errors);
  return (
    <PinSignInForm
      form={form}
      pending={login.pending}
      message={message}
      onSubmit={submit}
      onForgot={() => setStep({ kind: 'forgot' })}
    />
  );
}

type PinSignInFormProps = {
  form: UseFormReturn<StaffPinInput>;
  pending: boolean;
  message: PinMessage | null;
  onSubmit: (input: StaffPinInput) => Promise<void>;
  onForgot: () => void;
};

function PinSignInForm({ form, pending, message, onSubmit, onForgot }: PinSignInFormProps) {
  const locale = useLocale();
  return (
    <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
      <p className="text-base text-muted-foreground">{t(locale, 'staffLogin.recovery')}</p>
      <Label className="text-base" htmlFor="pin-phone">
        {t(locale, 'staffLogin.phone')}
      </Label>
      <Input
        id="pin-phone"
        type="tel"
        autoComplete="off"
        disabled={pending}
        {...form.register('phone')}
      />
      <Label className="text-base" htmlFor="staff-pin">
        {t(locale, 'staffLogin.ownPin')}
      </Label>
      <Input
        id="staff-pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        disabled={pending}
        {...form.register('pin')}
      />
      {message !== null ? (
        <p role="alert" className={message.destructive ? 'text-destructive' : 'text-base'}>
          {message.text}
        </p>
      ) : null}
      <Button size="touch" type="submit" disabled={pending}>
        {t(locale, 'staffLogin.pinSignIn')}
      </Button>
      <Button size="touch" type="button" variant="link" disabled={pending} onClick={onForgot}>
        {t(locale, 'staffLogin.forgotPin')}
      </Button>
    </form>
  );
}
