'use client';
import { sessionMoney } from '@pospay/contracts';
import { normalizeKwdInput, t } from '@pospay/i18n';
import { Button, Card, Input, Label } from '@pospay/ui';
import { Controller, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionServiceScope } from '../api/use-session-services';
import { createSessionDraft, selectSessionService, SESSION_DRAFT_MAX, SESSION_DRAFT_MIN, type SessionDraftForm } from '../model/session-drafts';
import { SessionServiceField } from './session-service-field';

export function SessionDraftLines({ scope, disabled = false }: { scope: SessionServiceScope; disabled?: boolean }) {
  const locale = useLocale();
  const { control, register, getValues, setValue } = useFormContext<SessionDraftForm>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines',
    rules: { minLength: SESSION_DRAFT_MIN, maxLength: SESSION_DRAFT_MAX } });
  const lines = useWatch({ control, name: 'lines' });
  return <fieldset disabled={disabled} className="grid gap-3 text-start">
    <legend>{t(locale, 'serviceSessions.service')}</legend>
    {fields.map((row, index) => <Card key={row.local_id} className="grid gap-3 p-3">
      <Controller control={control} name={`lines.${index}.service`} render={({ field }) =>
        <SessionServiceField scope={scope} value={field.value} onBlur={field.onBlur} disabled={disabled}
          onChange={(service) => {
            const previous = getValues(`lines.${index}`), next = selectSessionService(previous, service);
            if (next === previous) return;
            field.onChange(next.service);
            setValue(`lines.${index}.service_id`, next.service_id, { shouldDirty: true });
            setValue(`lines.${index}.price`, next.price, { shouldDirty: true, shouldValidate: true });
          }} /> } />
      <input type="hidden" {...register(`lines.${index}.service_id`)} />
      <Label htmlFor={`${row.local_id}-price`}>{t(locale, 'serviceSessions.price')}</Label>
      <Controller control={control} name={`lines.${index}.price`}
        rules={{ validate: (text) => sessionMoney.safeParse(normalizeKwdInput(text)).success || t(locale, 'serviceSessions.invalidPrice') }}
        render={({ field, fieldState }) => <>
          <Input {...field} id={`${row.local_id}-price`} dir="ltr" inputMode="decimal" aria-invalid={!!fieldState.error}
            aria-describedby={fieldState.error ? `${row.local_id}-error` : undefined}
            onBlur={() => { field.onChange(normalizeKwdInput(field.value)); field.onBlur(); }} />
          {fieldState.error ? <p id={`${row.local_id}-error`} role="alert">{t(locale, 'serviceSessions.invalidPrice')}</p> : null}
        </>} />
      {lines?.[index]?.service ? <p>{t(locale, 'serviceSessions.listPrice')} <bdi>{lines[index]?.service?.price}</bdi></p> : null}
      <Button type="button" variant="outline" disabled={fields.length <= SESSION_DRAFT_MIN}
        onClick={() => remove(index)}>{t(locale, 'serviceSessions.removeLine')}</Button>
    </Card>)}
    <Button type="button" variant="outline" disabled={fields.length >= SESSION_DRAFT_MAX}
      onClick={() => append(createSessionDraft())}>{t(locale, 'serviceSessions.addLine')}</Button>
  </fieldset>;
}
