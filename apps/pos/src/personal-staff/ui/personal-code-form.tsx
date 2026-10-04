import { useForm } from 'react-hook-form';
import { Button, Input, Label } from '@pospay/ui';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

export function PersonalCodeForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit(code: string): Promise<void>;
}) {
  const locale = useLocale();
  const form = useForm<{ code: string }>({ defaultValues: { code: '' } });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={form.handleSubmit(({ code }) => onSubmit(code))}
    >
      <Label htmlFor="personal-code">{t(locale, 'staffLogin.code')}</Label>
      <Input
        id="personal-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        disabled={pending}
        {...form.register('code', { required: true, pattern: /^\d{6}$/ })}
      />
      <Button size="touch" type="submit" disabled={pending}>
        {t(locale, 'staffLogin.verify')}
      </Button>
    </form>
  );
}
