import { zodResolver } from '@hookform/resolvers/zod';
import { staffOtpRequestInput, type StaffOtpRequestInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

export function PhoneForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit(input: StaffOtpRequestInput): Promise<void>;
}) {
  const locale = useLocale();
  const form = useForm<StaffOtpRequestInput>({ resolver: zodResolver(staffOtpRequestInput) });
  return (
    <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
      <Label htmlFor="staff-phone">{t(locale, 'staffLogin.phone')}</Label>
      <Input
        id="staff-phone"
        type="tel"
        autoComplete="off"
        disabled={pending}
        {...form.register('phone')}
      />
      <Label htmlFor="staff-language">{t(locale, 'staffLogin.language')}</Label>
      <select
        id="staff-language"
        defaultValue=""
        required
        disabled={pending}
        className="rounded-control border p-3 text-start"
        {...form.register('locale')}
      >
        <option value="" disabled>
          {t(locale, 'staffLogin.chooseLanguage')}
        </option>
        <option value="ar">{t(locale, 'staffLogin.arabic')}</option>
        <option value="en">{t(locale, 'staffLogin.english')}</option>
      </select>
      {form.formState.errors.phone !== undefined || form.formState.errors.locale !== undefined ? (
        <p role="alert">{t(locale, 'staffLogin.inputInvalid')}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {t(locale, 'staffLogin.request')}
      </Button>
    </form>
  );
}
