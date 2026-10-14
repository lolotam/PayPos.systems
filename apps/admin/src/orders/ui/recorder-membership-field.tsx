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

type MembershipReading = { fetching: boolean; status: number | undefined; settled: boolean };

// قراءة سياق العضوية المقفولة رجعت 403؛ الهيدر ما ينقلش فك القفل، فنفتح القائمة هنا لحد ما عضوية تانية تتقبل.
function useStaleMembershipRelease(readOnly: boolean, value: string | null, reading: MembershipReading, onChange: (membershipId: string | null) => void) {
  const [releasedId, setReleasedId] = useState<string | null>(null);
  const deniedId = readOnly && !reading.fetching && reading.status === 403 ? value : null;
  if (deniedId && releasedId !== deniedId) setReleasedId(deniedId);
  if (!readOnly && releasedId) setReleasedId(null);
  if (releasedId && value && value !== releasedId && !reading.fetching && reading.settled) setReleasedId(null);
  useEffect(() => {
    if (!releasedId || value !== releasedId) return;
    onChange(null);
  }, [onChange, releasedId, value]);
  return { locked: readOnly && releasedId === null, release() { if (value) { setReleasedId(value); onChange(null); } } };
}

export function RecorderMembershipField({ scope, value, onChange, onLimitChange, disabled = false, readOnly = false }: {
  scope: SessionServiceScope; value: string | null; onChange: (id: string | null) => void;
  onLimitChange?: (limit: RecordingDiscountLimit | null) => void; disabled?: boolean; readOnly?: boolean;
}) {
  const locale = useLocale(), prefix = useId();
  const scopeKey = JSON.stringify([scope.companyId, scope.businessId, scope.branchId, scope.userId]);
  const [selectionScope, setSelectionScope] = useState(scopeKey), scopeChanged = selectionScope !== scopeKey;
  if (scopeChanged && value === null) setSelectionScope(scopeKey);
  const queried = scopeChanged ? null : value;
  const query = useRecordingContext(scope, queried, !disabled);
  const reading = { fetching: query.isFetching, settled: query.isSuccess && !query.isFetching,
    status: query.isError ? (query.error as { status?: number }).status : undefined };
  const { locked, release } = useStaleMembershipRelease(readOnly, queried, reading, onChange);
  useLayoutEffect(() => {
    if (!scopeChanged) return;
    onChange(null); onLimitChange?.(null);
  }, [scopeChanged, scopeKey, onChange, onLimitChange]);
  const selected = query.isSuccess ? query.data.recorder_membership_id : null;
  useEffect(() => {
    if (disabled || locked || scopeChanged || query.isFetching || !selected || selected === value) return;
    onChange(selected);
  }, [disabled, locked, scopeChanged, query.isFetching, selected, value, onChange]);
  const limit = query.isError || query.isFetching || scopeChanged ? null : query.data?.discount_limit ?? null;
  useLayoutEffect(() => { onLimitChange?.(limit); }, [limit, onLimitChange]);
  const authority = limit ? recorderLimitText(locale, limit) : null;
  const selectValue = scopeChanged ? '' : locked ? (value ?? '') : (selected ?? value ?? '');
  return <fieldset disabled={disabled} className="grid gap-2 text-start">
    <Label htmlFor={prefix}>{t(locale, 'serviceSessions.recorderMembership')}</Label>
    <NativeSelect id={prefix} dir="ltr" value={selectValue} disabled={locked || !query.data || query.isError || query.isFetching || scopeChanged}
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
        if (value && reading.status === 403) { if (readOnly) release(); else onChange(null); }
        else void query.refetch();
      }}>{t(locale, 'serviceSessions.retryContext')}</Button></> : null}
  </fieldset>;
}
