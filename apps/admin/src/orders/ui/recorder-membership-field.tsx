'use client';
import { t } from '@pospay/i18n';
import { Button, Label, NativeSelect } from '@pospay/ui';
import { useEffect, useId } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useRecordingContext } from '../api/use-recording-context';
import type { SessionServiceScope } from '../api/use-session-services';
import { recorderLimitText } from './session-draft-summary';

export function RecorderMembershipField({ scope, value, onChange, disabled = false }: {
  scope: SessionServiceScope; value: string | null; onChange: (id: string) => void; disabled?: boolean;
}) {
  const locale = useLocale(), prefix = useId();
  const query = useRecordingContext(scope, value, !disabled);
  const selected = query.data?.recorder_membership_id;
  useEffect(() => { if (!disabled && selected && selected !== value) onChange(selected); }, [disabled, selected, value, onChange]);
  const limit = query.isError ? null : query.data?.discount_limit;
  const authority = limit ? recorderLimitText(locale, limit) : null;
  return <fieldset disabled={disabled} className="grid gap-2 text-start">
    <Label htmlFor={prefix}>{t(locale, 'serviceSessions.recorderMembership')}</Label>
    <NativeSelect id={prefix} dir="ltr" value={selected ?? value ?? ''} disabled={!query.data || query.isError}
      onChange={(event) => onChange(event.target.value)}>
      <option value="" disabled>{t(locale, 'serviceSessions.chooseMembership')}</option>
      {query.data?.recorder_membership_ids.map((id) => <option key={id} value={id}>{id}</option>)}
    </NativeSelect>
    {authority ? <div role="status">
      <p>{t(locale, 'serviceSessions.limit')} <bdi>{authority.value}</bdi></p>
      <p>{t(locale, 'serviceSessions.limitSource')} <span>{authority.source}</span></p>
    </div> : null}
    {query.isLoading ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
    {query.isError ? <><p role="alert">{envelopeMessage(query.error, locale)}</p>
      <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>{t(locale, 'serviceSessions.retryContext')}</Button></> : null}
  </fieldset>;
}
