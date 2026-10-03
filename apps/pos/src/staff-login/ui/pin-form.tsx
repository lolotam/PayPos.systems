import { zodResolver } from '@hookform/resolvers/zod';
import { staffPinInput, type StaffPinInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { usePinForm } from '../api/use-pin-form';

export function PinForm({ onSignedIn }: { onSignedIn: () => void }) {
  const locale = useLocale();
  const login = usePinForm(onSignedIn);
  const form = useForm<StaffPinInput>({ resolver: zodResolver(staffPinInput) });
  const submit = async (input: StaffPinInput) => {
    await login.submit(input);
    form.resetField('pin');
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(submit)}>
      <p className="text-base text-muted-foreground">{t(locale, 'staffLogin.recovery')}</p>
      <Label htmlFor="pin-phone">{t(locale, 'staffLogin.phone')}</Label>
      <Input
        id="pin-phone"
        type="tel"
        autoComplete="off"
        disabled={login.pending}
        {...form.register('phone')}
      />
      <Label htmlFor="staff-pin">{t(locale, 'staffLogin.ownPin')}</Label>
      <Input
        id="staff-pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        disabled={login.pending}
        {...form.register('pin')}
      />
      {login.invalid || Object.keys(form.formState.errors).length !== 0 ? (
        <p role="alert" className="text-destructive">
          {t(locale, 'staffLogin.pinInvalid')}
        </p>
      ) : null}
      <Button type="submit" disabled={login.pending}>
        {t(locale, 'staffLogin.pinSignIn')}
      </Button>
    </form>
  );
}
