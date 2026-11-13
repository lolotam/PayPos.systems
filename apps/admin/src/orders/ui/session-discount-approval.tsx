'use client';
import type { RequestDiscountApprovalResponse } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect, useState } from 'react';
import { useFormContext, type UseFormReturn } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useDiscountApprovalStatuses, type DiscountApprovalStatus } from '../api/use-discount-approval-status';
import { useRequestDiscountApproval } from '../api/use-request-discount-approval';
import type { SessionServiceScope } from '../api/use-session-services';
import { buildDiscountApprovalBody, discountProposalLocalIds, refusedDiscountDrafts } from '../model/discount-approval-request';
import { discountApprovalView, latestDiscountApprovalRequests, type TrackedDiscountRequest } from '../model/discount-approval-state';
import type { SessionDraftForm } from '../model/session-drafts';
import { sessionResultFrozen, type SessionRecordingResult } from '../model/session-recording-result';
import { reportSessionSubmitError } from '../model/session-submit-error';
import { sessionCommandLines } from '../model/use-session-recording';
import { SessionDiscountApprovalStatus } from './session-discount-approval-status';

type Form = Pick<UseFormReturn<SessionDraftForm>, 'getValues' | 'setValue' | 'setError'>;
type Mutate = (body: ReturnType<typeof buildDiscountApprovalBody>,
  options: { onSuccess: (response: RequestDiscountApprovalResponse) => void }) => void;
type SendInput = { result: SessionRecordingResult; form: Form; locale: Locale; requestable: string[];
  mutate: Mutate; onTrack: (request: TrackedDiscountRequest) => void };

function attachApproved(attach: ReturnType<typeof discountApprovalView>['attach'], form: Form) {
  const lines = form.getValues('lines');
  for (const approval of attach) {
    const index = lines.findIndex((line) => line.local_id === approval.localId), line = lines[index];
    if (!line || line.discount_proposal?.id === approval.proposalId) continue;
    form.setValue(`lines.${index}.discount_proposal`, { id: approval.proposalId });
  }
}

function sendRequest({ result, form, locale, requestable, mutate, onTrack }: SendInput) {
  const drafts = form.getValues();
  const rows = refusedDiscountDrafts(result, drafts.lines).filter((row) => requestable.includes(row.local_id));
  if (rows.length === 0) return;
  let body: ReturnType<typeof buildDiscountApprovalBody>;
  try {
    const commands = sessionCommandLines(rows);
    body = buildDiscountApprovalBody(result, { ...drafts, lines: rows }, commands);
  } catch (error) {
    // سطر بسعر أو خصم أو مؤدّين غلط كان بيطلع استثناء برّه المعالج، فالمسجّلة كانت تضيع الطلب من غير رسالة.
    reportSessionSubmitError(form.setError, error, locale);
    return;
  }
  mutate(body, { onSuccess: (response) => {
    onTrack({ requestId: response.request_id, localIds: discountProposalLocalIds(response.proposals, rows) });
    if (!result.sessionId && form.getValues('occurred_at') === drafts.occurred_at) form.setValue('occurred_at', response.occurred_at);
  } });
}

function retryFailed(statuses: Record<string, DiscountApprovalStatus>) {
  for (const status of Object.values(statuses)) if (status.error) status.refetch();
}

export function SessionDiscountApproval({ result, scope, online }: { result: SessionRecordingResult; scope: SessionServiceScope; online: boolean }) {
  const locale = useLocale(), form = useFormContext<SessionDraftForm>();
  const [requests, setRequests] = useState<TrackedDiscountRequest[]>([]);
  const [sentRejected, setSentRejected] = useState<SessionRecordingResult['rejected'] | null>(null);
  const request = useRequestDiscountApproval(scope);
  const queried = latestDiscountApprovalRequests(result.rejected, requests).map((tracked) => tracked.requestId);
  const statuses = useDiscountApprovalStatuses(scope, queried);
  const itemsByRequest = Object.fromEntries(Object.entries(statuses).map(([requestId, status]) => [requestId, status.data]));
  const view = discountApprovalView(result.rejected, requests, itemsByRequest);
  useEffect(() => { attachApproved(view.attach, form); }, [form, view.attach]);
  const failed = Object.values(statuses).find((status) => status.error);
  const error = (sentRejected === result.rejected ? request.error : null) ?? failed?.error ?? null;
  return <section className="grid gap-2" aria-label={t(locale, 'discountApproval.section')}>
    {result.rejected.map(({ localId, error: rejection }) => {
      const line = view.lines[localId];
      return line && (line.covered || line.proposal) ? <SessionDiscountApprovalStatus key={localId} error={rejection}
        proposal={line.proposal ?? undefined} /> : null;
    })}
    {error ? <p role="alert">{envelopeMessage(error, locale)}</p> : null}
    {failed ? <Button type="button" variant="outline" onClick={() => retryFailed(statuses)}>{t(locale, 'discountApproval.retry')}</Button> : null}
    <Button type="button" variant="outline" disabled={!online || sessionResultFrozen(result) || request.isPending || view.requestable.length === 0}
      onClick={() => { setSentRejected(result.rejected); sendRequest({ result, form, locale, requestable: view.requestable, mutate: request.mutate,
        onTrack: (tracked) => setRequests((current) => [...current, tracked]) }); }}>
      {t(locale, request.isPending ? 'discountApproval.sending' : 'discountApproval.request')}
    </Button>
  </section>;
}
