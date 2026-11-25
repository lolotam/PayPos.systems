import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { staffPinInput, type StaffPinInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { usePinForm } from '../api/use-pin-form';
import { ChangePinForm } from './change-pin-form';

type PinStep =
  | { readonly kind: 'sign_in'; readonly notice: 'changed' | 'expired' | null }
  | { readonly kind: 'change'; readonly proof: string };

type PinMessage = { readonly text: string; readonly destructive: boolean };

type PinLoginState = { readonly expired: boolean; readonly invalid: boolean };

// رسالة واحدة للشاشة: حفظ ناجح أو انتهاء مدّة أو رفض؛ وكلها alert عشان الكاشير تشوفها من غير ما تقرا.
function pinMessage(
  locale: Locale,
  notice: 'changed' | 'expired' | null,
  login: PinLoginState,
  errors: object,
): PinMessage | null {
  if (notice === 'changed')
    return { text: t(locale, 'staffLogin.pinChangedSignIn'), destructive: false };
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
  const message = pinMessage(locale, step.notice, login, form.formState.errors);
  return (
    <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(submit)}>
      <p className="text-base text-muted-foreground">{t(locale, 'staffLogin.recovery')}</p>
      <Label className="text-base" htmlFor="pin-phone">
        {t(locale, 'staffLogin.phone')}
      </Label>
      <Input
        id="pin-phone"
        type="tel"
        autoComplete="off"
        disabled={login.pending}
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
        disabled={login.pending}
        {...form.register('pin')}
      />
      {message !== null ? (
        <p role="alert" className={message.destructive ? 'text-destructive' : 'text-base'}>
          {message.text}
        </p>
      ) : null}
      <Button size="touch" type="submit" disabled={login.pending}>
        {t(locale, 'staffLogin.pinSignIn')}
      </Button>
    </form>
  );
}
