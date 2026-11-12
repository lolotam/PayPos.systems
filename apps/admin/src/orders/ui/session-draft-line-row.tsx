'use client';
import { sessionMoney } from '@pospay/contracts';
import { normalizeKwdInput, t } from '@pospay/i18n';
import { Button, Card, Input, Label } from '@pospay/ui';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionServiceScope } from '../api/use-session-services';
import { selectSessionService, type SessionDraftForm } from '../model/session-drafts';
import type { PackageList } from '../model/session-package-options';
import { SessionDiscountField } from './session-discount-field';
import { SessionPackageToggle } from './session-package-toggle';
import { SessionPerformersField } from './session-performers-field';
import { SessionServiceField } from './session-service-field';

export function SessionDraftLineRow({ scope, customerId, index, localId, occurredAt, packages, disabled, canRemove, onRemove }: {
  scope: SessionServiceScope;
  customerId: string | null;
  index: number;
  localId: string;
  occurredAt: string | undefined;
  packages: PackageList;
  disabled: boolean;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const locale = useLocale();
  const { control, register, getValues, setValue, clearErrors, formState: { errors } } = useFormContext<SessionDraftForm>();
  const fromPackage = useWatch({ control, name: `lines.${index}.from_package` });
  return <Card className="grid gap-3 p-3">
    <fieldset className="grid gap-3"><legend>{t(locale, 'serviceSessions.lineNumber').replace('{n}', String(index + 1))}</legend>
      <Controller control={control} name={`lines.${index}.service`} render={({ field }) =>
        <SessionServiceField scope={scope} value={field.value} onBlur={field.onBlur} disabled={disabled}
          onCatalogRefresh={(service) => setValue(`lines.${index}.service`, service)}
          onChange={(service) => {
            const previous = getValues(`lines.${index}`), next = selectSessionService(previous, service);
            if (next === previous) return;
            // service_id مش ظاهر في الاختيار؛ رسالة العقد بتفضل لحد ما الخدمة تتحدد.
            clearErrors(`lines.${index}.service_id`);
            field.onChange(next.service);
            setValue(`lines.${index}.service_id`, next.service_id, { shouldDirty: true });
            setValue(`lines.${index}.price`, next.price, { shouldDirty: true, shouldValidate: true });
          }} /> } />
      <input type="hidden" {...register(`lines.${index}.service_id`)} />
      <SessionPackageToggle scope={scope} customerId={customerId} index={index} occurredAt={occurredAt} packages={packages} disabled={disabled} />
      {errors.lines?.[index]?.service_id?.message ? <p role="alert">{errors.lines[index]?.service_id?.message}</p> : null}
      {!fromPackage ? <>
        <Label htmlFor={`${localId}-price`}>{t(locale, 'serviceSessions.price')}</Label>
        <Controller control={control} name={`lines.${index}.price`}
          rules={{ validate: (text) => {
            if (getValues(`lines.${index}.from_package`)) return true;
            return sessionMoney.safeParse(normalizeKwdInput(text)).success || t(locale, 'serviceSessions.invalidPrice');
          } }}
          render={({ field, fieldState }) => <>
            <Input {...field} id={`${localId}-price`} dir="ltr" inputMode="decimal" aria-invalid={!!fieldState.error}
              aria-describedby={fieldState.error ? `${localId}-error` : undefined}
              onBlur={() => { field.onChange(normalizeKwdInput(field.value)); field.onBlur(); }} />
            {fieldState.error ? <p id={`${localId}-error`} role="alert">{t(locale, 'serviceSessions.invalidPrice')}</p> : null}
          </>} />
        <SessionDiscountField index={index} disabled={disabled} />
      </> : null}
      <SessionPerformersField scope={scope} index={index} occurredAt={occurredAt} disabled={disabled} />
      <Button type="button" variant="outline" disabled={!canRemove}
        onClick={onRemove}>{t(locale, 'serviceSessions.removeLine')}</Button>
    </fieldset>
  </Card>;
}
