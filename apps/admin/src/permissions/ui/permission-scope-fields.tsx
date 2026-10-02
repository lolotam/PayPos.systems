'use client';
import type { PermissionOverrideInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

export function PermissionScopeFields() {
  const locale = useLocale();
  const { register } = useFormContext<PermissionOverrideInput>();
  return (
    <>
      <Label htmlFor="override-scope">{t(locale, 'permissions.scope')}</Label>
      <select id="override-scope" {...register('scope_type')}>
        <option value="COMPANY">{t(locale, 'permissions.company')}</option>
        <option value="BUSINESS">{t(locale, 'permissions.business')}</option>
        <option value="BRANCH">{t(locale, 'permissions.branch')}</option>
      </select>
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
