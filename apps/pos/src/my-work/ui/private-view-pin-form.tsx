import { zodResolver } from '@hookform/resolvers/zod';
import { privateViewOpenInput, type PrivateViewOpenInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { PrivateViewProblem } from '../api/use-private-view-lock';

const PROBLEM_KEYS = {
  expired: 'errors.PRIVATE_VIEW_EXPIRED',
  unavailable: 'myWork.pinUnavailable',
  failed: 'myWork.pinFailed',
  invalid: 'myWork.pinInvalid',
} as const;

/**
 * خطوة الـ PIN على جهاز الاستقبال: الحقل بيتمسح بعد كل محاولة والـ PIN مش بيتحفظ في أي مكان.
 *
 * @param props.problem سبب الرجوع للخطوة دي: PIN غلط، فشل الفتح، انتهاء النافذة، أو تعذّر سياج التابات (التخزين مقفول)
 * @param props.pending هل المحاولة شغالة
 * @param props.onSubmit بتستلم الـ PIN
 */
export function PrivateViewPinForm({
  problem,
  pending,
  onSubmit,
}: {
  problem: PrivateViewProblem;
  pending: boolean;
  onSubmit: (pin: string) => Promise<void>;
}) {
  const locale = useLocale();
  const form = useForm<PrivateViewOpenInput>({ resolver: zodResolver(privateViewOpenInput) });
  const submit = async (input: PrivateViewOpenInput) => {
    await onSubmit(input.pin);
    form.resetField('pin');
  };
  const key =
    problem === null
      ? form.formState.errors.pin
        ? 'myWork.pinInvalid'
        : null
      : PROBLEM_KEYS[problem];
  const message = key === null ? null : t(locale, key);
  return (
    <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(submit)}>
      <p className="text-base">{t(locale, 'myWork.pinTitle')}</p>
      <Label className="text-base" htmlFor="private-view-pin">
        {t(locale, 'myWork.pinLabel')}
      </Label>
      <Input
        id="private-view-pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        disabled={pending}
        {...form.register('pin')}
      />
      {message === null ? null : (
        <p role="alert" className="text-destructive">
          {message}
        </p>
      )}
      <Button size="touch" type="submit" disabled={pending}>
        {t(locale, 'myWork.pinSubmit')}
      </Button>
    </form>
  );
}
