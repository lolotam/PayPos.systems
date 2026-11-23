import { zodResolver } from '@hookform/resolvers/zod';
import { privateViewOpenInput, type PrivateViewOpenInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { PinProblem } from '../model/private-window-state';

const PROBLEM_KEYS = {
  expired: 'errors.PRIVATE_VIEW_EXPIRED',
  failed: 'myWork.pinFailed',
  invalid: 'myWork.pinInvalid',
  refused: 'myWork.refused',
} as const;

/**
 * خطوة الـ PIN على جهاز الاستقبال: الحقل بيتفرّغ في نفس لحظة الإرسال والـ PIN مش بيتحفظ في أي مكان. المتحكم
 * بيركّب النموذج بدورة جديدة (`key`) مع أي خروج من الواجهة، فأي حاجة مكتوبة فيه بتروح، وبيرفض أي إرسال جاي من
 * نموذج قديم (حتى لو فك التركيب حصل والتحقق لسه ماخلصش).
 *
 * @param props.problem سبب الرجوع للخطوة دي: PIN غلط، فشل الفتح، خروج من الواجهة، أو رفض صلاحية
 * @param props.pending هل المحاولة شغالة
 * @param props.waiting هل محاولة قديمة لسه ما ردتش، فالإرسال مقفول لحد ما تخلص
 * @param props.onSubmit بتستلم الـ PIN
 */
export function PrivateViewPinForm({
  problem,
  pending,
  waiting,
  onSubmit,
}: {
  problem: PinProblem;
  pending: boolean;
  waiting: boolean;
  onSubmit: (pin: string) => void;
}) {
  const locale = useLocale();
  const form = useForm<PrivateViewOpenInput>({ resolver: zodResolver(privateViewOpenInput) });
  const submit = (input: PrivateViewOpenInput) => {
    form.resetField('pin');
    onSubmit(input.pin);
  };
  const key =
    problem === null
      ? form.formState.errors.pin
        ? 'myWork.pinInvalid'
        : null
      : PROBLEM_KEYS[problem];
  const message = key === null ? null : t(locale, key);
  const locked = pending || waiting;
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
        disabled={locked}
        {...form.register('pin')}
      />
      {message === null ? null : (
        <p role="alert" className="text-destructive">
          {message}
        </p>
      )}
      {waiting ? <p role="status">{t(locale, 'myWork.pinWaiting')}</p> : null}
      <Button size="touch" type="submit" disabled={locked}>
        {t(locale, 'myWork.pinSubmit')}
      </Button>
    </form>
  );
}
