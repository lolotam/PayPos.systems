'use client';
import { t } from '@pospay/i18n';
import { sessionServiceOptionsQuery } from '@pospay/contracts';
import { Button, Input, Label, NativeSelect } from '@pospay/ui';
import { useEffect, useId, useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useSessionServices, type SessionServiceScope } from '../api/use-session-services';
import type { SessionServiceSelection } from '../model/session-drafts';

type Props = { scope: SessionServiceScope; value: SessionServiceSelection | null;
  onChange: (value: SessionServiceSelection) => void; onCatalogRefresh?: (value: SessionServiceSelection) => void;
  onBlur?: () => void; disabled?: boolean };

export function SessionServiceField({ scope, value, onChange, onCatalogRefresh, onBlur, disabled = false }: Props) {
  const locale = useLocale(), prefix = useId();
  const [search, setSearch] = useState('');
  const [settledSearch, setSettledSearch] = useState('');
  const invalidSearch = !sessionServiceOptionsQuery.safeParse({ lang: locale, q: search.trim() || undefined }).success;
  useEffect(() => {
    if (invalidSearch) return;
    const timer = setTimeout(() => setSettledSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search, invalidSearch]);
  const query = useSessionServices(scope, settledSearch, !disabled);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const retained = value && !items.some((item) => item.id === value.id) ? value : null;
  const catalogSelection = items.find((item) => item.id === value?.id) ?? value;
  useEffect(() => {
    if (catalogSelection && value && catalogSelection.revision !== value.revision) onCatalogRefresh?.(catalogSelection);
  }, [catalogSelection, value, onCatalogRefresh]);
  const name = (item: SessionServiceSelection) => locale === 'ar' ? item.name_ar ?? item.name_en : item.name_en;
  return <fieldset disabled={disabled} className="grid gap-2 text-start">
    <Label htmlFor={`${prefix}-search`}>{t(locale, 'serviceSessions.searchServices')}</Label>
    <Input id={`${prefix}-search`} type="search" maxLength={50} value={search}
      aria-invalid={invalidSearch} aria-describedby={invalidSearch ? `${prefix}-search-error` : undefined}
      onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }}
      onChange={(event) => setSearch(event.target.value)} />
    {invalidSearch ? <p id={`${prefix}-search-error`} role="alert">{t(locale, 'serviceSessions.invalidSearch')}</p> : null}
    <Label htmlFor={`${prefix}-service`}>{t(locale, 'serviceSessions.service')}</Label>
    <NativeSelect id={`${prefix}-service`} value={value?.id ?? ''} onBlur={onBlur}
      disabled={!query.data} onChange={(event) => {
        const selected = items.find((item) => item.id === event.target.value);
        if (selected) onChange(selected);
      }}>
      <option value="" disabled>{t(locale, 'serviceSessions.chooseService')}</option>
      {retained ? <option value={retained.id}>{name(retained)}</option> : null}
      {items.map((item) => <option key={item.id} value={item.id}>{name(item)}</option>)}
    </NativeSelect>
    {catalogSelection ? <p>{t(locale, 'serviceSessions.listPrice')} <bdi>{catalogSelection.price}</bdi></p> : null}
    {query.isLoading ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
    {query.isSuccess && !items.length ? <p role="status">{t(locale, 'serviceSessions.noServices')}</p> : null}
    {query.isError ? <p role="alert">{envelopeMessage(query.error, locale)}</p> : null}
    {query.isError ? <Button type="button" variant="outline" disabled={query.isFetching}
      onClick={() => void query.refetch()}>{t(locale, 'serviceSessions.retryServices')}</Button> : null}
    {query.hasNextPage && !query.isError && !invalidSearch ? <Button type="button" variant="outline" disabled={query.isFetching}
      onClick={() => void query.fetchNextPage()}>{t(locale, 'serviceSessions.moreServices')}</Button> : null}
  </fieldset>;
}
