'use client';
import { formatInstant, t } from '@pospay/i18n';
import { Button, Input, Label, NativeSelect } from '@pospay/ui';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { useEffect } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { normalizeSessionPercent, sessionSharePercentage, type SessionDraftForm, type SessionPerformerSelection } from '../model/session-drafts';

export function SessionPerformerRow({ index, ordinal, items, instant, timeZone, factsKey, remove }: {
  index: number; ordinal: number; items: SessionPerformerSelection[]; instant: string | undefined; timeZone: string | undefined; factsKey: string; remove: () => void;
}) {
  const locale = useLocale(), { control, setValue, getValues, clearErrors } = useFormContext<SessionDraftForm>();
  const line = useWatch({ control, name: `lines.${index}` }), row = line.performers[ordinal];
  const current = items.find((item) => item.id === row?.employee_id), path = `lines.${index}.performers.${ordinal}` as const;
  useEffect(() => {
    if (!current || (row?.facts_key === factsKey && row.selection?.not_clocked_in_warning === current.not_clocked_in_warning && row.selection.approved_leave_warning === current.approved_leave_warning)) return;
    setValue(`${path}.selection`, current); setValue(`${path}.facts_key`, factsKey);
  }, [current, factsKey, row, path, setValue]);
  if (!row) return null;
  const id = `${line.local_id}-performer-${ordinal}`;
  const label = (key: 'performerNumber' | 'share' | 'removePerformer') => t(locale, `serviceSessions.${key}`).replace('{n}', String(ordinal + 1));
  const name = (item: SessionPerformerSelection) => locale === 'ar' ? item.name_ar ?? item.name_en : item.name_en;
  const facts = current ?? (row.facts_key === factsKey && row.selection?.id === row.employee_id ? row.selection : null);
  const choices = items.filter((item) => item.id === row.employee_id || !line.performers.some((other) => other.employee_id === item.id));
  return <div className="grid gap-2">
    <Label htmlFor={id}>{label('performerNumber')}</Label>
    <Controller control={control} name={`${path}.employee_id`} rules={{ required: t(locale, 'serviceSessions.choosePerformer') }}
      render={({ field, fieldState }) => <>
        <NativeSelect {...field} id={id} aria-invalid={!!fieldState.error} aria-describedby={fieldState.error ? `${id}-error` : undefined}
          onChange={(event) => { const selection = choices.find((item) => item.id === event.target.value); if (!selection) return;
            clearErrors(`lines.${index}.performers`); field.onChange(selection.id); setValue(`${path}.selection`, selection); setValue(`${path}.facts_key`, factsKey); }}>
          <option value="" disabled>{t(locale, 'serviceSessions.choosePerformer')}</option>
          {row.selection && !current ? <option value={row.selection.id}>{name(row.selection)}</option> : null}
          {choices.map((item) => <option key={item.id} value={item.id}>{name(item)}</option>)}
        </NativeSelect>
        {fieldState.error ? <p id={`${id}-error`} role="alert">{fieldState.error.message}</p> : null}
      </>} />
    {line.share_mode === 'CUSTOM' ? <><Label htmlFor={`${id}-share`}>{label('share')}</Label>
      <Controller control={control} name={`${path}.share_percentage`} rules={{ validate: (text) =>
        getValues(`lines.${index}.share_mode`) === 'EQUAL' || sessionSharePercentage.safeParse(normalizeSessionPercent(text)).success || t(locale, 'serviceSessions.invalidShare') }}
        render={({ field, fieldState }) => <><Input {...field} id={`${id}-share`} dir="ltr" inputMode="decimal"
          onChange={(event) => { clearErrors(`lines.${index}.performers`); field.onChange(event); }}
          aria-invalid={!!fieldState.error} aria-describedby={fieldState.error ? `${id}-share-error` : undefined}
          onBlur={() => { field.onChange(normalizeSessionPercent(field.value)); field.onBlur(); }} />
          {fieldState.error ? <p id={`${id}-share-error`} role="alert">{fieldState.error.message}</p> : null}</>} />
    </> : null}
    {row.employee_id && !facts ? <p role="status">{row.selection ? name(row.selection) : null}: {t(locale, 'serviceSessions.notChecked')}</p> : null}
    {facts && instant && timeZone ? <div role="status">{(['not_clocked_in_warning', 'approved_leave_warning'] as const).map((flag) => facts[flag] ?
      <p key={flag}>{name(facts)} — {formatInstant(new Date(instant), locale, timeZone)}: {t(locale, flag === 'not_clocked_in_warning' ? 'serviceSessions.notClockedIn' : 'serviceSessions.approvedLeave')}</p> : null)}</div> : null}
    <Button type="button" variant="outline" disabled={line.performers.length <= 1} onClick={remove}>{label('removePerformer')}</Button>
  </div>;
}
