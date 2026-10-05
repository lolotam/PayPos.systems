import { useForm } from 'react-hook-form';
import { Button, Input, Label } from '@pospay/ui';
import { t, type Locale } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

export function PersonalPhoneForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit(input: { phone: string; locale: Locale }): Promise<void>;
}) {
  const locale = useLocale();
  const form = useForm<{ phone: string }>({ defaultValues: { phone: '' } });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={form.handleSubmit(({ phone }) => onSubmit({ phone, locale }))}
    >
      <Label htmlFor="personal-phone">{t(locale, 'staffLogin.phone')}</Label>
      <Input
        id="personal-phone"
        type="tel"
        autoComplete="off"
        disabled={pending}
        {...form.register('phone', { required: true })}
      />
      <Button size="touch" type="submit" disabled={pending}>
        {t(locale, 'staffLogin.request')}
      </Button>
    </form>
  );
}
