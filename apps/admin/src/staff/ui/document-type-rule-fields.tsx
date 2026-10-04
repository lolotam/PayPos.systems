'use client';
import type { CreateDocumentTypeInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import type { UseFormRegister } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

export function DocumentTypeRuleFields({
  id,
  register,
}: {
  id: string;
  register: UseFormRegister<CreateDocumentTypeInput>;
}) {
  const locale = useLocale();
  return (
    <>
      <Label htmlFor={`type-alert-${id}`}>{t(locale, 'employeeDocuments.alertDays')}</Label>
      <Input
        id={`type-alert-${id}`}
        type="number"
        min={0}
        max={365}
        dir="ltr"
        {...register('alert_days', { valueAsNumber: true })}
      />
      <Label htmlFor={`type-expiry-${id}`} className="flex items-center gap-2">
        <input id={`type-expiry-${id}`} type="checkbox" {...register('requires_expiry')} />
        {t(locale, 'employeeDocuments.requiresExpiry')}
      </Label>
    </>
  );
}
