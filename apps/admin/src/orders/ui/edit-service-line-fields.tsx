'use client';
import type { EditServiceLineInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button, Input, Label, NativeSelect } from '@pospay/ui';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { editReasonLength, type EditLineFormInput } from '../model/edit-service-line-values';

function fieldText(message: string | undefined, locale: Locale) {
  if (message === 'reason') return t(locale, 'serviceLineEdit.reasonInvalid');
  if (message === 'price') return t(locale, 'serviceSessions.invalidPrice');
  if (message === 'discount') return t(locale, 'serviceSessions.invalidDiscount');
  return message;
}

export function EditServiceLineFields({ form, locale, memberships, online, pending, closeDisabled, onClose }: {
  form: UseFormReturn<EditLineFormInput, unknown, EditServiceLineInput>;
  locale: Locale; memberships: string[]; online: boolean; pending: boolean; closeDisabled: boolean; onClose: () => void;
}) {
  const { register, formState, setValue, control } = form;
  const kind = useWatch({ control, name: 'discount_kind' });
  const reason = useWatch({ control, name: 'reason' });
  const reasonError = fieldText(formState.errors.reason?.message, locale);
  const priceError = fieldText(formState.errors.price?.message, locale);
  const discountError = fieldText(formState.errors.discount_value?.message, locale);
  return <>
    <div className="flex flex-wrap gap-2">
      {(['AMOUNT', 'PERCENT'] as const).map((next) => <Button key={next} type="button" variant="outline" aria-pressed={kind === next} onClick={() => setValue('discount_kind', next, { shouldDirty: true })}>
        {t(locale, next === 'AMOUNT' ? 'serviceSessions.discountAmount' : 'serviceSessions.discountPercent')}
      </Button>)}
    </div>
    <Label htmlFor="edit-price">{t(locale, 'serviceSessions.price')}</Label>
    <Input id="edit-price" dir="ltr" inputMode="decimal" aria-invalid={!!priceError} {...register('price')} />
    {priceError ? <p role="alert">{priceError}</p> : null}
    <Label htmlFor="edit-discount">{t(locale, kind === 'AMOUNT' ? 'serviceSessions.discountAmount' : 'serviceSessions.discountPercent')}</Label>
    <Input id="edit-discount" dir="ltr" inputMode="decimal" aria-invalid={!!discountError} {...register('discount_value')} />
    {discountError ? <p role="alert">{discountError}</p> : null}
    <Label htmlFor="edit-reason">{t(locale, 'serviceLineEdit.reason')}</Label>
    <Input id="edit-reason" aria-invalid={!!reasonError} {...register('reason')} />
    <p>{t(locale, 'serviceLineEdit.reasonCount').replace('{count}', String(editReasonLength(reason ?? '')))}</p>
    {reasonError ? <p role="alert">{reasonError}</p> : null}
    {memberships.length ? <NativeSelect aria-label={t(locale, 'serviceLineEdit.membership')} {...register('editor_membership_id')}>
      <option value="">{t(locale, 'serviceLineEdit.membership')}</option>
      {memberships.map((membershipId, index) => <option key={membershipId} value={membershipId}>{t(locale, 'serviceLineEdit.membershipN').replace('{n}', String(index + 1))}</option>)}
    </NativeSelect> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={!online || pending}>{pending ? t(locale, 'serviceLineEdit.saving') : t(locale, 'serviceLineEdit.save')}</Button>
      <Button type="button" variant="outline" disabled={closeDisabled} onClick={() => { if (!closeDisabled) onClose(); }}>{t(locale, 'serviceLineEdit.close')}</Button>
    </div>
  </>;
}
