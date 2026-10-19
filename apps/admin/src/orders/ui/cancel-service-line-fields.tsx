'use client';
import type { CancelServiceLineInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { cancelReasonLength, type CancelLineFormInput } from '../model/cancel-service-line-values';
import { CancelLineActions } from './cancel-line-actions';
import { CancelLineMembershipField } from './cancel-line-membership-field';

function fieldText(message: string | undefined, locale: Locale) {
  return message === 'reason' ? t(locale, 'serviceLineCancel.reasonInvalid') : message;
}
export function CancelServiceLineFields({
  form,
  locale,
  companyId,
  userId,
  memberships,
  online,
  pending,
  frozen,
  onClose,
}: {
  form: UseFormReturn<CancelLineFormInput, unknown, CancelServiceLineInput>;
  locale: Locale;
  companyId: string;
  userId: string;
  memberships: string[];
  online: boolean;
  pending: boolean;
  frozen: boolean;
  onClose: () => void;
}) {
  const { register, formState } = form;
  const reason = useWatch({ control: form.control, name: 'reason' });
  const reasonError = fieldText(formState.errors.reason?.message, locale);
  const reasonField = register('reason');
  // أثناء الطلب الجسم المحفوظ هو اللي هيتعاد؛ تعديل السبب أو العضوية دلوقتي هيظهر قيمة غير اللي اتسجلت.
  const locked = frozen || pending;
  return (
    <>
      <Label htmlFor="cancel-reason">{t(locale, 'serviceLineCancel.reason')}</Label>
      <Input
        id="cancel-reason"
        disabled={locked}
        aria-invalid={!!reasonError}
        {...reasonField}
        onChange={(event) => {
          if (!locked) reasonField.onChange(event);
        }}
      />
      <p>
        {t(locale, 'serviceLineCancel.reasonCount').replace(
          '{count}',
          String(cancelReasonLength(reason ?? '')),
        )}
      </p>
      {reasonError ? <p role="alert">{reasonError}</p> : null}
      <CancelLineMembershipField
        locale={locale}
        companyId={companyId}
        userId={userId}
        memberships={memberships}
        frozen={locked}
        register={register}
      />
      <CancelLineActions locale={locale} online={online} pending={pending} onClose={onClose} />
    </>
  );
}
