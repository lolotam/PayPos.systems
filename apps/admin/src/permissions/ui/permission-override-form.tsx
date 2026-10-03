'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { permissionOverrideInput, type PermissionOverrideInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { FormProvider, useForm } from 'react-hook-form';

import { useLocale } from '@/shared/locale/locale-context';
import { PermissionDecisionFields } from './permission-decision-fields';
import { PermissionScopeFields } from './permission-scope-fields';

export function PermissionOverrideForm({
  catalog,
  companyId,
  disabled,
  pending,
  onSave,
}: {
  catalog: readonly string[];
  companyId: string;
  disabled: boolean;
  pending: boolean;
  onSave: (terms: PermissionOverrideInput) => void;
}) {
  const locale = useLocale();
  const form = useForm<PermissionOverrideInput>({
    resolver: zodResolver(permissionOverrideInput),
    defaultValues: {
      permission_code: '',
      effect: 'DENY',
      scope_type: 'COMPANY',
      scope_id: companyId,
      reason: '',
      expires_at: null,
    },
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3 text-start">
        <fieldset disabled={disabled || pending} className="flex flex-col gap-3">
          <PermissionDecisionFields catalog={catalog} />
          <PermissionScopeFields />
          <Button type="submit">{t(locale, 'permissions.save')}</Button>
        </fieldset>
        {Object.keys(form.formState.errors).length > 0 ? (
          <p role="alert">{t(locale, 'permissions.invalid')}</p>
        ) : null}
      </form>
    </FormProvider>
  );
}
