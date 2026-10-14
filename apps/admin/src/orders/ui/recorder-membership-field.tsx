'use client';
import { t } from '@pospay/i18n';
import type { RecordingDiscountLimit } from '@pospay/contracts';
import { Button, Label, NativeSelect } from '@pospay/ui';
import { useEffect, useId, useLayoutEffect, useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useRecordingContext } from '../api/use-recording-context';
import type { SessionServiceScope } from '../api/use-session-services';
import { recorderLimitText } from './session-draft-summary';

export function RecorderMembershipField({ scope, value, onChange, onLimitChange, disabled = false, readOnly = false }: {
  scope: SessionServiceScope; value: string | null; onChange: (id: string | null) => void;
  onLimitChange?: (limit: RecordingDiscountLimit | null) => void; disabled?: boolean; readOnly?: boolean;
}) {
  const locale = useLocale(), prefix = useId();
  const scopeKey = JSON.stringify([scope.companyId, scope.businessId, scope.branchId, scope.userId]);
  const [selectionScope, setSelectionScope] = useState(scopeKey), scopeChanged = selectionScope !== scopeKey;
  if (scopeChanged && value === null) setSelectionScope(scopeKey);
  const query = useRecordingContext(scope, scopeChanged ? null : value, !disabled);
  useLayoutEffect(() => {
    if (!scopeChanged) return;
    onChange(null); onLimitChange?.(null);
  }, [scopeChanged, scopeKey, onChange, onLimitChange]);
  const selected = query.isSuccess ? query.data.recorder_membership_id : null;
  useEffect(() => {
    if (disabled || readOnly || scopeChanged || query.isFetching || !selected || selected === value) return;
    onChange(selected);
  }, [disabled, readOnly, scopeChanged, query.isFetching, selected, value, onChange]);
  const limit = query.isError || query.isFetching || scopeChanged ? null : query.data?.discount_limit ?? null;
  useLayoutEffect(() => { onLimitChange?.(limit); }, [limit, onLimitChange]);
  const authority = limit ? recorderLimitText(locale, limit) : null;
  const selectValue = scopeChanged ? '' : readOnly ? (value ?? '') : (selected ?? value ?? '');
  return <fieldset disabled={disabled} className="grid gap-2 text-start">
    <Label htmlFor={prefix}>{t(locale, 'serviceSessions.recorderMembership')}</Label>
    <NativeSelect id={prefix} dir="ltr" value={selectValue} disabled={readOnly || !query.data || query.isError || query.isFetching || scopeChanged}
      onChange={(event) => onChange(event.target.value)}>
      <option value="" disabled>{t(locale, 'serviceSessions.chooseMembership')}</option>
      {query.data?.recorder_membership_ids.map((id) => <option key={id} value={id}>{id}</option>)}
    </NativeSelect>
    {authority ? <div role="status">
      <p>{t(locale, 'serviceSessions.limit')} <bdi>{authority.value}</bdi></p>
      <p>{t(locale, 'serviceSessions.limitSource')} <span>{authority.source}</span></p>
    </div> : null}
    {query.isFetching ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
    {query.isError ? <><p role="alert">{envelopeMessage(query.error, locale)}</p>
      <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => {
        if (value && (query.error as { status?: number } | null)?.status === 403) onChange(null);
        else void query.refetch();
      }}>{t(locale, 'serviceSessions.retryContext')}</Button></> : null}
  </fieldset>;
}
