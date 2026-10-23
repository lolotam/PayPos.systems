'use client';
import { t, type Locale } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import {
  performersReasonLength,
  performersReasonValid,
  type PerformersFormInput,
} from '../model/change-line-performers-values';
import { ChangeLineMembershipField } from './change-line-performers-membership';

function Actions({
  locale,
  online,
  pending,
  onClose,
}: {
  locale: Locale;
  online: boolean;
  pending: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={!online || pending}>
        {t(locale, pending ? 'serviceLinePerformers.submitting' : 'serviceLinePerformers.submit')}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (!pending) onClose();
        }}
      >
        {t(locale, 'serviceLinePerformers.close')}
      </Button>
    </div>
  );
}

export function ChangeLinePerformersFields({
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
  form: UseFormReturn<PerformersFormInput>;
  locale: Locale;
  companyId: string;
  userId: string;
  memberships: string[];
  online: boolean;
  pending: boolean;
  frozen: boolean;
  onClose: () => void;
}) {
  const reason = useWatch({ control: form.control, name: 'reason' });
  const reasonError = form.formState.errors.reason?.message;
  const reasonField = form.register('reason', {
    validate: (value) =>
      performersReasonValid(value) || t(locale, 'serviceLinePerformers.reasonInvalid'),
  });
  // أثناء الطلب الجسم المحفوظ هو اللي هيتعاد؛ تعديل السبب دلوقتي هيظهر قيمة غير اللي اتبعتت.
  const locked = frozen || pending;
  return (
    <>
      <Label htmlFor="performers-reason">{t(locale, 'serviceLinePerformers.reason')}</Label>
      <Input
        id="performers-reason"
        disabled={locked}
        aria-invalid={!!reasonError}
        {...reasonField}
        onChange={(event) => {
          if (!locked) void reasonField.onChange(event);
        }}
      />
      <p>
        {t(locale, 'serviceLinePerformers.reasonCount').replace(
          '{count}',
          String(performersReasonLength(reason ?? '')),
        )}
      </p>
      {reasonError ? <p role="alert">{reasonError}</p> : null}
      <ChangeLineMembershipField
        locale={locale}
        companyId={companyId}
        userId={userId}
        memberships={memberships}
        frozen={locked}
        register={form.register}
      />
      <Actions locale={locale} online={online} pending={pending} onClose={onClose} />
    </>
  );
}
