'use client';
import type { RecordingContext } from '@pospay/contracts';
import { formatInstant, t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useEffect, useId, useState } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionDraftForm } from '../model/session-drafts';
import { sessionLocalTime, sessionOldestLocal, sessionUtc } from '../model/session-local-time';

export function SessionTimeField({ context, disabled = false }: { context: RecordingContext; disabled?: boolean }) {
  const locale = useLocale(), id = useId(), timezone = context.business_timezone;
  const [invalidLocal, setInvalidLocal] = useState('');
  const [clock, setClock] = useState({ source: context.generated_at, elapsed: 0 });
  const now = new Date(Date.parse(context.generated_at) + (clock.source === context.generated_at ? clock.elapsed : 0)).toISOString();
  const result = sessionUtc(invalidLocal, timezone), { control } = useFormContext<SessionDraftForm>();
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setClock({ source: context.generated_at, elapsed: Date.now() - started }), 1000);
    return () => clearInterval(timer);
  }, [context.generated_at]);
  return <Controller control={control} name="occurred_at" rules={{
    validate: (value) => value !== '' || t(locale, `serviceSessions.${result.error ?? 'invalidTime'}`),
  }} render={({ field, fieldState }) => {
  const error = field.value === '' ? t(locale, `serviceSessions.${result.error ?? 'invalidTime'}`) : fieldState.error?.message;
  return <fieldset disabled={disabled} className="grid gap-2 text-start">
    <Label htmlFor={id}>{t(locale, 'serviceSessions.occurredAt')}</Label>
    {field.value === undefined ? <p>{t(locale, 'serviceSessions.now')} <bdi>{formatInstant(new Date(now), locale, timezone)}</bdi></p> : null}
    <Input name={field.name} ref={field.ref} onBlur={field.onBlur} id={id} type="datetime-local" step="1" dir="ltr"
      value={field.value === '' ? invalidLocal : field.value ? sessionLocalTime(field.value, timezone) : ''}
      aria-invalid={!!error} aria-describedby={`${id}-zone ${id}-help${error ? ` ${id}-error` : ''}`}
      onChange={(event) => {
        const local = event.target.value, converted = sessionUtc(local, timezone);
        setInvalidLocal(local); field.onChange(converted.error ? '' : converted.instant);
      }} />
    <Button type="button" variant="outline" onClick={() => field.onChange(undefined)}>{t(locale, 'serviceSessions.useNow')}</Button>
    <p id={`${id}-zone`} className="text-sm text-muted-foreground">{t(locale, 'serviceSessions.timezone')} <bdi>{timezone}</bdi></p>
    <p id={`${id}-help`} className="text-sm text-muted-foreground">{t(locale, 'serviceSessions.windowHelp')
      .replace('{oldest}', sessionOldestLocal(now, timezone).replace('T', ' '))}</p>
    {error ? <p id={`${id}-error`} role="alert">{error}</p> : null}
  </fieldset>;
  }} />;
}
