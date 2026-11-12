'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { useCustomerPackages } from '../api/use-customer-packages';
import type { SessionServiceScope } from '../api/use-session-services';
import { createSessionDraft, SESSION_DRAFT_MAX, SESSION_DRAFT_MIN, type SessionDraftForm } from '../model/session-drafts';
import type { PackageList } from '../model/session-package-options';
import { SessionDraftLineRow } from './session-draft-line-row';

export function SessionDraftLines({ scope, customerId, occurredAt, disabled = false }: {
  scope: SessionServiceScope;
  customerId: string | null;
  occurredAt?: string;
  disabled?: boolean;
}) {
  const locale = useLocale();
  const { control } = useFormContext<SessionDraftForm>();
  const selectedTime = useWatch({ control, name: 'occurred_at' });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines',
    rules: { minLength: SESSION_DRAFT_MIN, maxLength: SESSION_DRAFT_MAX } });
  const query = useCustomerPackages(scope, customerId ?? '', customerId !== null && !disabled);
  const pages = query.data?.pages.length ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (query.isError || !hasNextPage || isFetchingNextPage || pages >= 10) return;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, pages, query.isError]);
  const packages: PackageList = {
    items: query.data?.items ?? [],
    complete: (!hasNextPage || pages >= 10) && !query.isPending,
    error: query.isError,
    loading: query.isPending || (!query.isError && hasNextPage && pages < 10),
    retry: () => { void query.refetch(); },
  };
  return <fieldset disabled={disabled} className="grid gap-3 text-start">
    <legend>{t(locale, 'serviceSessions.service')}</legend>
    {fields.map((row, index) => <SessionDraftLineRow key={row.local_id} scope={scope} customerId={customerId}
      index={index} localId={row.local_id} occurredAt={occurredAt ?? selectedTime} packages={packages} disabled={disabled}
      canRemove={fields.length > SESSION_DRAFT_MIN} onRemove={() => remove(index)} />)}
    <Button type="button" variant="outline" disabled={fields.length >= SESSION_DRAFT_MAX}
      onClick={() => append(createSessionDraft())}>{t(locale, 'serviceSessions.addLine')}</Button>
  </fieldset>;
}
