'use client';
import type { RequestDiscountApprovalResponse, RequesterDiscountProposalList } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect, useState } from 'react';
import { useFormContext, type UseFormReturn } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useDiscountApprovalStatus } from '../api/use-discount-approval-status';
import { useRequestDiscountApproval } from '../api/use-request-discount-approval';
import type { SessionServiceScope } from '../api/use-session-services';
import { buildDiscountApprovalBody, discountApprovalContext, discountApprovalFingerprint, discountProposalLocalIds, refusedDiscountDrafts } from '../model/discount-approval-request';
import type { SessionDraftForm } from '../model/session-drafts';
import { sessionResultFrozen, type SessionRecordingResult } from '../model/session-recording-result';
import { reportSessionSubmitError } from '../model/session-submit-error';
import { sessionCommandLines } from '../model/use-session-recording';
import { SessionDiscountApprovalStatus } from './session-discount-approval-status';

type ActiveRequest = { requestedIds: string[]; requestId: string;
  localIds: Record<number, string>; fingerprints: Record<string, string> };
type Form = Pick<UseFormReturn<SessionDraftForm>, 'getValues' | 'setValue' | 'setError'>;

function attachApproved(items: RequesterDiscountProposalList['items'], active: ActiveRequest | null, form: Form) {
  if (!active) return;
  const lines = form.getValues('lines');
  for (const item of items) {
    if (item.status !== 'APPROVED') continue;
    const localId = active.localIds[item.input_index], index = lines.findIndex((line) => line.local_id === localId);
    const line = lines[index], fingerprint = localId ? active.fingerprints[localId] : undefined;
    if (!line || !fingerprint || line.discount_proposal?.id === item.id) continue;
    form.setValue(`lines.${index}.discount_proposal`, { id: item.id, fingerprint });
  }
}

function sendRequest(result: SessionRecordingResult, form: Form, locale: Locale, mutate: (body: ReturnType<typeof buildDiscountApprovalBody>,
  options: { onSuccess: (response: RequestDiscountApprovalResponse) => void }) => void, setActive: (active: ActiveRequest) => void) {
  const drafts = form.getValues(), rows = refusedDiscountDrafts(result, drafts.lines);
  let commands: ReturnType<typeof sessionCommandLines>, body: ReturnType<typeof buildDiscountApprovalBody>;
  try {
    commands = sessionCommandLines(rows);
    body = buildDiscountApprovalBody(result, drafts, commands);
  } catch (error) {
    // سطر بسعر أو خصم أو مؤدّين غلط كان بيطلع استثناء برّه المعالج، فالمسجّلة كانت تضيع الطلب من غير رسالة.
    reportSessionSubmitError(form.setError, error, locale);
    return;
  }
  mutate(body, { onSuccess: (response) => {
    const context = discountApprovalContext(result, { ...drafts, occurred_at: result.sessionId ? drafts.occurred_at : response.occurred_at });
    setActive({ requestId: response.request_id, requestedIds: rows.map((row) => row.local_id),
      localIds: discountProposalLocalIds(response.proposals, rows),
      fingerprints: context ? Object.fromEntries(rows.map((row, index) => {
        const command = commands[index];
        if (!command || !('price' in command)) throw new Error('DISCOUNT_APPROVAL_PACKAGE_INVALID');
        return [row.local_id, discountApprovalFingerprint(command, context)];
      })) : {} });
    if (!result.sessionId) form.setValue('occurred_at', response.occurred_at);
  } });
}

export function SessionDiscountApproval({ result, scope, online }: { result: SessionRecordingResult; scope: SessionServiceScope; online: boolean }) {
  const locale = useLocale(), form = useFormContext<SessionDraftForm>();
  const [active, setActive] = useState<ActiveRequest | null>(null);
  const [sentRejected, setSentRejected] = useState<SessionRecordingResult['rejected'] | null>(null);
  // الطلب يفضل حياً طالما سطوره لسه مرفوضة في النتيجة، فحفظ تاني ما يصنعش طلبين ولا جرس تاني.
  const current = active && active.requestedIds.every((localId) => result.rejected.some((row) => row.localId === localId)) ? active : null;
  const request = useRequestDiscountApproval(scope);
  const status = useDiscountApprovalStatus(scope, current?.requestId ?? null);
  useEffect(() => { attachApproved(status.data?.items ?? [], current, form); }, [current, form, status.data]);
  const items = status.data?.items ?? [];
  const waiting = current !== null && (items.length === 0 || items.some((item) => item.status === 'PENDING'));
  const attached = items.some((item) => item.status === 'APPROVED' || item.status === 'CONSUMED');
  const error = (sentRejected === result.rejected ? request.error : null) ?? status.error;
  return <section className="grid gap-2" aria-label={t(locale, 'discountApproval.section')}>
    {current ? result.rejected.map(({ localId, error: rejection }) => <SessionDiscountApprovalStatus key={localId} error={rejection}
      proposal={items.find((item) => current.localIds[item.input_index] === localId)} />) : null}
    {error ? <p role="alert">{envelopeMessage(error, locale)}</p> : null}
    {status.error ? <Button type="button" variant="outline" onClick={() => { void status.refetch(); }}>{t(locale, 'discountApproval.retry')}</Button> : null}
    <Button type="button" variant="outline" disabled={!online || sessionResultFrozen(result) || request.isPending || waiting || attached}
      onClick={() => { setSentRejected(result.rejected); sendRequest(result, form, locale, request.mutate, setActive); }}>
      {t(locale, request.isPending ? 'discountApproval.sending' : 'discountApproval.request')}
    </Button>
  </section>;
}
