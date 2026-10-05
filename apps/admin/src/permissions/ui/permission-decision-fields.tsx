'use client';
import type { PermissionOverrideInput } from '@pospay/contracts';
import { permissionName, t } from '@pospay/i18n';
import { Label, Select } from '@pospay/ui';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

export function PermissionDecisionFields({ catalog }: { catalog: readonly string[] }) {
  const locale = useLocale();
  const { control } = useFormContext<PermissionOverrideInput>();
  const code = useWatch({ control, name: 'permission_code' });
  return (
    <>
      <Label htmlFor="override-permission">{t(locale, 'permissions.permission')}</Label>
      <Controller
        name="permission_code"
        control={control}
        render={({ field }) => (
          <Select
            id="override-permission"
            value={field.value}
            onValueChange={field.onChange}
            placeholder={t(locale, 'permissions.choosePermission')}
            options={catalog.map((code) => ({
              value: code,
              label: `${permissionName(locale, code)} · ${code}`,
            }))}
          />
        )}
      />
      {code === 'read:salaries:business' || code === 'manage:salaries:business' ? (
        <p className="text-sm text-muted-foreground">{t(locale, 'salary.employeeAccessHint')}</p>
      ) : null}
      <Label htmlFor="override-effect">{t(locale, 'permissions.effect')}</Label>
      <Controller
        name="effect"
        control={control}
        render={({ field }) => (
          <Select
            id="override-effect"
            value={field.value}
            onValueChange={field.onChange}
            options={[
              { value: 'ALLOW', label: t(locale, 'permissions.allow') },
              { value: 'DENY', label: t(locale, 'permissions.deny') },
            ]}
          />
        )}
      />
    </>
  );
}
