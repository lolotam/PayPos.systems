'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect } from 'react';
import { Controller, useFormContext, useWatch, type UseFormGetValues, type UseFormSetValue } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionServiceScope } from '../api/use-session-services';
import type { SessionDraftForm, SessionDraftLine } from '../model/session-drafts';
import { packageOptionsForService, suggestPackage, type PackageList, type PackageOption } from '../model/session-package-options';
import { SessionPackagePicker } from './session-package-picker';

function otherPackagePicks(lines: SessionDraftLine[], index: number) {
  return lines.flatMap((line, row) => row !== index && line.from_package && line.package_entitlement_id !== null
    ? [{ entitlement_id: line.package_entitlement_id, service_id: line.service_id }] : []);
}

function usePackageSuggestion(
  fromPackage: boolean,
  settled: boolean,
  complete: boolean,
  options: PackageOption[],
  visitDate: string,
  index: number,
  getValues: UseFormGetValues<SessionDraftForm>,
  setValue: UseFormSetValue<SessionDraftForm>,
) {
  useEffect(() => {
    if (!fromPackage || !settled) return;
    const path = `lines.${index}.package_entitlement_id` as const;
    const current = getValues(path);
    if (current !== null && options.some((option) => option.id === current)) return;
    const suggested = complete ? suggestPackage(options, visitDate) : null;
    if (current === suggested) return;
    setValue(path, suggested, { shouldDirty: true, shouldValidate: true });
  }, [complete, fromPackage, getValues, index, options, setValue, settled, visitDate]);
}

export function SessionPackageToggle({ scope, customerId, index, visitDate, packages, disabled = false }: {
  scope: SessionServiceScope;
  customerId: string | null;
  index: number;
  visitDate: string;
  packages: PackageList;
  disabled?: boolean;
}) {
  const locale = useLocale();
  const { control, getValues, setValue, clearErrors } = useFormContext<SessionDraftForm>();
  const lines = useWatch({ control, name: 'lines' });
  const line = lines[index];
  const fromPackage = line?.from_package ?? false;
  const serviceId = line?.service_id ?? '';
  const options = packageOptionsForService(packages.items, serviceId, otherPackagePicks(lines, index), visitDate);
  const path = `lines.${index}.package_entitlement_id` as const;
  usePackageSuggestion(fromPackage, packages.complete || packages.truncated, packages.complete, options, visitDate, index, getValues, setValue);
  const gate = customerId === null ? 'packageNoCustomer' : !serviceId ? 'packageNoService' : null;
  const toggle = () => {
    if (fromPackage) {
      setValue(`lines.${index}.from_package`, false, { shouldDirty: true });
      setValue(path, null, { shouldDirty: true });
      clearErrors(path);
      return;
    }
    if (gate !== null) return;
    setValue(`lines.${index}.from_package`, true, { shouldDirty: true });
    if (getValues(path) === null && packages.complete) setValue(path, suggestPackage(options, visitDate), { shouldDirty: true, shouldValidate: true });
  };
  return <div className="grid gap-2 text-start">
    <Button type="button" variant="outline" aria-pressed={fromPackage}
      disabled={disabled || (!fromPackage && gate !== null)} onClick={toggle}>{t(locale, 'serviceSessions.fromPackage')}</Button>
    {gate !== null ? <p>{t(locale, `serviceSessions.${gate}`)}</p> : null}
    {fromPackage && gate === null ? <Controller control={control} name={path}
      rules={{ validate: (value) => {
        if (!fromPackage) return true;
        if (value === null) return t(locale, 'serviceSessions.packageRequired');
        const chosen = options.find((option) => option.id === value);
        if (!chosen) return t(locale, 'serviceSessions.packageRequired');
        return chosen.remaining === 0 ? t(locale, 'serviceSessions.packageExhausted') : true;
      } }}
      render={({ field, fieldState }) => <>
        {packages.loading ? <p role="status">{t(locale, 'serviceSessions.packageLoading')}</p> : packages.error ? <>
          <p role="alert">{t(locale, 'serviceSessions.packageLoadFailed')}</p>
          <Button type="button" variant="outline" onClick={packages.retry}>{t(locale, 'serviceSessions.packageRetry')}</Button>
        </> : packages.truncated && options.length === 0 ? <p role="status">{t(locale, 'serviceSessions.packageListTruncated')}</p> :
          packages.complete && options.length === 0 ? <p role="status">{t(locale, 'serviceSessions.packageNoneUsable')}</p> : <>
            {packages.truncated ? <p role="status">{t(locale, 'serviceSessions.packageListTruncated')}</p> : null}
            <SessionPackagePicker scope={scope} customerId={customerId ?? ''} options={options} value={field.value}
              onChange={field.onChange} suggestedId={packages.complete ? suggestPackage(options, visitDate) : null} row={index} />
          </>}
        {fieldState.error ? <p role="alert">{fieldState.error.message}</p> : null}
      </>} /> : null}
  </div>;
}
