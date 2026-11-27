'use client';
import { useId } from 'react';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

const trimmed = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/** في التعديل الفراغ بيتحول لـ null: مسح الحقل معناه «بلا إيميل» ويتبعت للسيرفر. */
export const recoveryEmailOptions = { setValueAs: trimmed };

/** في الإنشاء ومنح الدخول الفراغ معناه إن الحقل ما اتبعتش أصلاً. */
export const newRecoveryEmailOptions = {
  setValueAs: (value: unknown) => trimmed(value) ?? undefined,
};

/**
 * حقل إيميل الاستعادة الاختياري للموظف: للتواصل ورسالة الترحيب واستعادة الرقم السري. نفس الحقل
 * في الإنشاء والتعديل ومنح الدخول، والتحقق من شكله من عقد السيرفر (spec 079 PR-c1).
 *
 * @param props.field تسجيل الحقل من react-hook-form
 * @param props.invalid هل فشل التحقق من شكل الإيميل
 */
export function EmployeeRecoveryEmailField({
  field,
  invalid,
}: {
  field: UseFormRegisterReturn;
  invalid: boolean;
}) {
  const locale = useLocale();
  const id = `employee-recovery-email-${useId()}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <>
      <Label htmlFor={id}>{t(locale, 'staff.recoveryEmailLabel')}</Label>
      <Input
        id={id}
        inputMode="email"
        dir="ltr"
        autoComplete="off"
        aria-invalid={invalid}
        aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
        {...field}
      />
      <p id={hintId} className="text-sm text-muted-foreground">
        {t(locale, 'staff.recoveryEmailHint')}
      </p>
      {invalid ? (
        <p id={errorId} role="alert">
          {t(locale, 'staff.recoveryEmailInvalid')}
        </p>
      ) : null}
    </>
  );
}
