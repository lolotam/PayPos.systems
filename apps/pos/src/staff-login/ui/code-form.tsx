import { zodResolver } from '@hookform/resolvers/zod';
import { staffOtpVerifyInput, type StaffOtpVerifyInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

export function CodeForm({
  challengeId,
  pending,
  onSubmit,
}: {
  challengeId: string;
  pending: boolean;
  onSubmit(input: StaffOtpVerifyInput): Promise<void>;
}) {
  const locale = useLocale();
  const form = useForm<StaffOtpVerifyInput>({
    resolver: zodResolver(staffOtpVerifyInput),
    defaultValues: { challenge_id: challengeId, code: '' },
  });
  return (
    <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
      <Label className="text-base" htmlFor="staff-code">
        {t(locale, 'staffLogin.code')}
      </Label>
      <Input
        id="staff-code"
        inputMode="numeric"
        autoComplete="off"
        disabled={pending}
        {...form.register('code')}
      />
      <Button size="touch" type="submit" disabled={pending}>
        {t(locale, 'staffLogin.verify')}
      </Button>
    </form>
  );
}
