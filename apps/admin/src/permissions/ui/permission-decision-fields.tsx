'use client';
import type { PermissionOverrideInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

export function PermissionDecisionFields({ catalog }: { catalog: readonly string[] }) {
  const locale = useLocale();
  const { register } = useFormContext<PermissionOverrideInput>();
  return (
    <>
      <Label htmlFor="override-permission">{t(locale, 'permissions.permission')}</Label>
      <select id="override-permission" {...register('permission_code')}>
        <option value="">{t(locale, 'permissions.choosePermission')}</option>
        {catalog.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      <Label htmlFor="override-effect">{t(locale, 'permissions.effect')}</Label>
      <select id="override-effect" {...register('effect')}>
        <option value="ALLOW">{t(locale, 'permissions.allow')}</option>
        <option value="DENY">{t(locale, 'permissions.deny')}</option>
      </select>
    </>
  );
}
