'use client';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useState } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useSessionPerformers } from '../api/use-session-performers';
import type { SessionServiceScope } from '../api/use-session-services';
import type { SessionDraftForm } from '../model/session-drafts';
import { SessionPerformerRow } from './session-performer-row';

export function SessionPerformersField({ scope, index, occurredAt, disabled = false }: {
  scope: SessionServiceScope; index: number; occurredAt?: string | undefined; disabled?: boolean;
}) {
  const locale = useLocale(), [search, setSearch] = useState('');
  const { control, setValue, clearErrors, formState: { errors } } = useFormContext<SessionDraftForm>();
  const line = useWatch({ control, name: `lines.${index}` });
  const path = `lines.${index}.performers` as const, { fields, append, remove } = useFieldArray({ control, name: path });
  const query = useSessionPerformers(scope, occurredAt, search, !disabled);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [], id = `${line.local_id}-performer-search`;
  const error = errors.lines?.[index]?.performers;
  return <fieldset disabled={disabled} className="grid gap-2 text-start">
    <legend>{t(locale, 'serviceSessions.performers')}</legend>
    <Label htmlFor={id}>{t(locale, 'serviceSessions.searchPerformers')}</Label>
    <Input id={id} type="search" maxLength={50} value={search} aria-invalid={query.invalidSearch}
      aria-describedby={query.invalidSearch ? `${id}-error` : undefined} onChange={(event) => setSearch(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} />
    {query.invalidSearch ? <p id={`${id}-error`} role="alert">{t(locale, 'serviceSessions.invalidSearch')}</p> : null}
    <div className="flex flex-wrap gap-2">{(['EQUAL', 'CUSTOM'] as const).map((mode) => <Button key={mode} type="button" variant="outline"
      aria-pressed={line.share_mode === mode} onClick={() => { clearErrors(path); setValue(`lines.${index}.share_mode`, mode, { shouldDirty: true }); }}>
      {t(locale, mode === 'EQUAL' ? 'serviceSessions.equalSplit' : 'serviceSessions.customShares')}</Button>)}</div>
    {line.share_mode === 'CUSTOM' ? <p>{t(locale, 'serviceSessions.shareTotal')}</p> : null}
    {fields.map((row, ordinal) => <SessionPerformerRow key={row.id} index={index} ordinal={ordinal} items={items}
      instant={query.instant} timeZone={query.timeZone} factsKey={query.factsKey} remove={() => { clearErrors(path); remove(ordinal); }} />)}
    <Button type="button" variant="outline" disabled={fields.length >= 4}
      onClick={() => { clearErrors(path); append({ employee_id: '', share_percentage: '', selection: null }); }}>{t(locale, 'serviceSessions.addPerformer')}</Button>
    {error?.message || error?.root?.message ? <p role="alert">{error.message ?? error.root?.message}</p> : null}
    {query.isFetching || query.context.isLoading ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
    {query.data && !items.length ? <p role="status">{t(locale, 'serviceSessions.noPerformers')}</p> : null}
    {query.isError || query.context.isError ? <><p role="alert">{envelopeMessage(query.error ?? query.context.error, locale)}</p>
      <Button type="button" variant="outline" disabled={query.isFetching || query.context.isFetching}
        onClick={() => void (query.context.isError ? query.context.refetch() : query.refetch())}>{t(locale, 'serviceSessions.retryPerformers')}</Button></> : null}
    {query.data && query.hasNextPage && !query.isError ? <Button type="button" variant="outline" disabled={query.isFetching}
      onClick={() => void query.fetchNextPage()}>{t(locale, 'serviceSessions.morePerformers')}</Button> : null}
  </fieldset>;
}
