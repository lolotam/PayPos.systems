import { zodResolver } from '@hookform/resolvers/zod';
import { privateViewOpenInput, type PrivateViewOpenInput } from '@pospay/contracts';
import { t, type MessageKey } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { PinProblem } from './state';

/** الأقسام اللي عندها شاشة خاصة بتفتح بالرقم السري، وكل واحد بنصوصه في الكتالوج بتاعه. */
const PIN_SECTIONS = {
  myWork: {
    title: 'myWork.pinTitle',
    label: 'myWork.pinLabel',
    submit: 'myWork.pinSubmit',
    invalid: 'myWork.pinInvalid',
    failed: 'myWork.pinFailed',
    refused: 'myWork.refused',
    waiting: 'myWork.pinWaiting',
  },
  myAttendance: {
    title: 'myAttendance.pinTitle',
    label: 'myAttendance.pinLabel',
    submit: 'myAttendance.pinSubmit',
    invalid: 'myAttendance.pinInvalid',
    failed: 'myAttendance.pinFailed',
    refused: 'myAttendance.refused',
    waiting: 'myAttendance.pinWaiting',
  },
} as const;

export type PinSection = keyof typeof PIN_SECTIONS;

/**
 * خطوة الـ PIN على جهاز الاستقبال: الحقل بيتفرّغ في نفس لحظة الإرسال والـ PIN مش بيتحفظ في أي مكان. المتحكم
 * بيركّب النموذج بدورة جديدة (`key`) مع أي خروج من الواجهة، فأي حاجة مكتوبة فيه بتروح، وبيرفض أي إرسال جاي من
 * نموذج قديم (حتى لو فك التركيب حصل والتحقق لسه مخلصش).
 *
 * @param props.section القسم اللي بتاخد نصوص الخطوة منه
 * @param props.problem سبب الرجوع للخطوة دي: PIN غلط، فشل الفتح، خروج من الواجهة، أو رفض صلاحية
 * @param props.pending هل المحاولة شغالة
 * @param props.waiting هل محاولة قديمة لسه ما ردتش، فالإرسال مقفول لحد ما تخلص
 * @param props.onSubmit بتستلم الـ PIN
 */
export function PrivateViewPinForm({
  section,
  problem,
  pending,
  waiting,
  onSubmit,
}: {
  section: PinSection;
  problem: PinProblem;
  pending: boolean;
  waiting: boolean;
  onSubmit: (pin: string) => void;
}) {
  const locale = useLocale();
  const texts = PIN_SECTIONS[section];
  const form = useForm<PrivateViewOpenInput>({ resolver: zodResolver(privateViewOpenInput) });
  const submit = (input: PrivateViewOpenInput) => {
    form.resetField('pin');
    onSubmit(input.pin);
  };
  const key: MessageKey | null =
    problem === null
      ? form.formState.errors.pin
        ? texts.invalid
        : null
      : problem === 'expired'
        ? 'errors.PRIVATE_VIEW_EXPIRED'
        : texts[problem];
  const message = key === null ? null : t(locale, key);
  const locked = pending || waiting;
  return (
    <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(submit)}>
      <p className="text-base">{t(locale, texts.title)}</p>
      <Label className="text-base" htmlFor="private-view-pin">
        {t(locale, texts.label)}
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
      {waiting ? <p role="status">{t(locale, texts.waiting)}</p> : null}
      <Button size="touch" type="submit" disabled={locked}>
        {t(locale, texts.submit)}
      </Button>
    </form>
  );
}
