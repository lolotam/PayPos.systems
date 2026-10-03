'use client';
import type { PermissionOverrideInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label, Select } from '@pospay/ui';
import { Controller, useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

export function PermissionScopeFields({ businessScoped = false }: { businessScoped?: boolean }) {
  const locale = useLocale();
  const { register, control } = useFormContext<PermissionOverrideInput>();
  return (
    <>
      <Label htmlFor="override-scope">{t(locale, 'permissions.scope')}</Label>
      <Controller
        name="scope_type"
        control={control}
        render={({ field }) => (
          <Select
            id="override-scope"
            value={field.value}
            onValueChange={field.onChange}
            options={[
              ...(businessScoped
                ? []
                : [{ value: 'COMPANY', label: t(locale, 'permissions.company') }]),
              { value: 'BUSINESS', label: t(locale, 'permissions.business') },
              { value: 'BRANCH', label: t(locale, 'permissions.branch') },
            ]}
          />
        )}
      />
      <Label htmlFor="override-scope-id">{t(locale, 'permissions.scopeId')}</Label>
      <Input id="override-scope-id" {...register('scope_id')} />
      <Label htmlFor="override-reason">{t(locale, 'permissions.reason')}</Label>
      <Input id="override-reason" maxLength={500} {...register('reason')} />
      <Label htmlFor="override-expiry">{t(locale, 'permissions.expiry')}</Label>
      <Input
        id="override-expiry"
        {...register('expires_at', {
          setValueAs: (value: string) => (value === '' ? null : value),
        })}
      />
    </>
  );
}
