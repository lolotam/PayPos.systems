import type { RequesterDiscountProposalList } from '@pospay/contracts';
import { discountApprovalRefusals, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { afterEach, expect, it, vi } from 'vitest';
import { createSessionDraft, type SessionDraftForm } from '../model/session-drafts';
import { emptySessionRecordingResult, type SessionRecordingResult } from '../model/session-recording-result';
import { id, instant, rejection, scope } from '../model/session-recording-result.fixture';
import { SessionRejectedLines } from './session-rejected-lines';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: api.get, POST: api.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const A = id(10), B = id(11), first = id(51), second = id(52), firstProposal = id(60), secondProposal = id(61);
const editedTime = '2026-10-14T00:05:00.000Z', normalizedTime = '2026-10-13T23:55:00.000Z';

function proposal(idValue: string, inputIndex: number, status: 'PENDING' | 'APPROVED', requestId = first): RequesterDiscountProposalList['items'][number] {
  return { kind: 'RECORD', id: idValue, request_id: requestId, input_index: inputIndex, status, session_id: null,
    occurred_at: instant, service_id: id(5), service_name_en: 'Synthetic service', service_name_ar: null,
    list_price: '7.125', price: '7.125', discount: '0.713', net: '6.412', effective_bps: 1001,
    expires_at: instant, terms_hash: 'a'.repeat(64) };
}

function requested(proposalId: string, inputIndex: number) {
  return { id: proposalId, input_index: inputIndex, status: 'PENDING' as const,
    expires_at: instant, effective_bps: 1001, terms_hash: 'a'.repeat(64) };
}

function response(requestId: string, proposalId: string, inputIndex = 0) {
  return { request_id: requestId, occurred_at: normalizedTime, proposals: [requested(proposalId, inputIndex)] };
}

function result(twoRows = false): SessionRecordingResult {
  const lines = [A, B].map((localId) => ({ ...createSessionDraft(localId), service_id: id(5), price: '7.125',
    discount_kind: 'PERCENT' as const, discount_percentage: '10',
    performers: [{ employee_id: id(6), share_percentage: '', selection: null }] }));
  const rejected = [A, B].map((localId, input_index) => ({ localId, error: { ...rejection, input_index } }));
  return { ...emptySessionRecordingResult(), customerId: id(7), feedback: { kind: 'ALL_REJECTED' },
    drafts: { occurred_at: instant, recorder_membership_id: id(8), lines: twoRows ? lines : lines.slice(0, 1) },
    rejected: twoRows ? rejected : rejected.slice(0, 1) };
}

function Harness({ value, scopeValue, onDrafts }: { value: SessionRecordingResult; scopeValue: typeof scope; onDrafts: (drafts: SessionDraftForm) => void }) {
  const form = useForm<SessionDraftForm>({ defaultValues: value.drafts });
  return <FormProvider {...form}>
    <SessionRejectedLines result={value} onEdit={vi.fn()} scope={scopeValue} online />
    <button type="button" onClick={() => form.setValue('occurred_at', editedTime)}>{t('en', 'serviceSessions.useNow')}</button>
    <button type="button" onClick={() => onDrafts(form.getValues())}>{t('en', 'serviceSessions.save')}</button>
  </FormProvider>;
}

function mount(value = result(), scopeValue = scope) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const drafts = vi.fn();
  const view = render(<QueryClientProvider client={client}><Harness value={value} scopeValue={scopeValue} onDrafts={drafts} /></QueryClientProvider>);
  return { client, drafts, view };
}

async function clickRequest() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: t('en', 'discountApproval.request') }));
    await Promise.resolve();
  });
}

function rejectedRow(value: SessionRecordingResult, localId: string) {
  const row = value.rejected.find((candidate) => candidate.localId === localId);
  if (!row) throw new Error('Missing rejected row');
  return row;
}

afterEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

it('keeps polling the remaining row after a mixed decision', async () => {
  const value = result(true);
  api.post.mockResolvedValue({ data: { ...response(first, firstProposal), proposals: [
    requested(firstProposal, 0), requested(secondProposal, 1),
  ] }, response: { status: 201 } });
  api.get.mockResolvedValueOnce({ data: { items: [proposal(secondProposal, 1, 'PENDING')] }, response: { status: 200 } })
    .mockResolvedValue({ data: { items: [proposal(secondProposal, 1, 'APPROVED')] }, response: { status: 200 } });
  const { client, drafts, view } = mount(value);
  await clickRequest();
  await waitFor(() => expect(screen.getAllByText(t('en', 'discountApproval.pending')).length).toBeGreaterThan(0));
  expect(api.post.mock.calls[0]?.[1].body.lines).toHaveLength(2);
  const next = { ...value, rejected: [rejectedRow(value, B)] };
  view.rerender(<QueryClientProvider client={client}><Harness value={next} scopeValue={scope} onDrafts={drafts} /></QueryClientProvider>);
  expect(screen.getByText(t('en', 'discountApproval.pending'))).toBeTruthy();
  expect((screen.getByRole('button', { name: t('en', 'discountApproval.request') }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { await client.refetchQueries({ queryKey: ['discount-approval-status'] }); });
  await waitFor(() => expect(screen.getByText(t('en', 'discountApproval.approved'))).toBeTruthy());
});

it('makes a stale approved proposal requestable and sends only that row', async () => {
  const value = result();
  api.post.mockResolvedValueOnce({ data: response(first, firstProposal), response: { status: 201 } })
    .mockResolvedValueOnce({ data: response(second, secondProposal), response: { status: 201 } });
  api.get.mockImplementation((_path: string, init: { params: { query: { request_id: string } } }) => Promise.resolve(
    init.params.query.request_id === first
      ? { data: { items: [proposal(firstProposal, 0, 'APPROVED')] }, response: { status: 200 } }
      : { data: { items: [proposal(secondProposal, 0, 'PENDING', second)] }, response: { status: 200 } }));
  const { client, drafts, view } = mount(value);
  await clickRequest();
  await waitFor(() => expect(screen.getByText(t('en', 'discountApproval.approved'))).toBeTruthy());
  const row = rejectedRow(value, A);
  const next = { ...value, rejected: [{ ...row, error: { ...row.error,
    approval_refusal: 'TERMS_MISMATCH' as const, discount_proposal_id: firstProposal } }] };
  view.rerender(<QueryClientProvider client={client}><Harness value={next} scopeValue={scope} onDrafts={drafts} /></QueryClientProvider>);
  expect(screen.getByText(discountApprovalRefusals.TERMS_MISMATCH.message_en)).toBeTruthy();
  expect((screen.getByRole('button', { name: t('en', 'discountApproval.request') }) as HTMLButtonElement).disabled).toBe(false);
  await clickRequest();
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  expect(api.post.mock.calls[1]?.[1].body.lines).toHaveLength(1);
  await waitFor(() => expect(screen.getByText(t('en', 'discountApproval.pending'))).toBeTruthy());
});

it('resets tracked requests when the branch scope changes', async () => {
  api.post.mockResolvedValue({ data: response(first, firstProposal), response: { status: 201 } });
  api.get.mockResolvedValue({ data: { items: [proposal(firstProposal, 0, 'PENDING')] }, response: { status: 200 } });
  const value = result(), { client, drafts, view } = mount(value);
  await clickRequest();
  await waitFor(() => expect(screen.getByText(t('en', 'discountApproval.pending'))).toBeTruthy());
  const otherScope = { ...scope, branchId: id(33) };
  view.rerender(<QueryClientProvider client={client}><Harness value={value} scopeValue={otherScope} onDrafts={drafts} /></QueryClientProvider>);
  expect(screen.queryByText(t('en', 'discountApproval.pending'))).toBeNull();
  expect((screen.getByRole('button', { name: t('en', 'discountApproval.request') }) as HTMLButtonElement).disabled).toBe(false);
});

it('keeps a visit time edited while the request is pending', async () => {
  let finish: ((value: unknown) => void) | undefined;
  api.post.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  api.get.mockResolvedValue({ data: { items: [proposal(firstProposal, 0, 'PENDING')] }, response: { status: 200 } });
  const { drafts } = mount();
  await clickRequest();
  expect(screen.getByText(t('en', 'discountApproval.sending'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.useNow') }));
  const complete = finish;
  if (!complete) throw new Error('Missing pending request');
  await act(async () => {
    complete({ data: response(first, firstProposal), response: { status: 201 } });
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByText(t('en', 'discountApproval.pending'))).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.save') }));
  expect(drafts.mock.calls[0]?.[0].occurred_at).toBe(editedTime);
});

it('keeps tracked requests while the customer is retyped and drops them for a different customer', async () => {
  api.post.mockResolvedValue({ data: response(first, firstProposal), response: { status: 201 } });
  api.get.mockResolvedValue({ data: { items: [proposal(firstProposal, 0, 'PENDING')] }, response: { status: 200 } });
  const value = result(), { client, drafts, view } = mount(value);
  await clickRequest();
  await waitFor(() => expect(screen.getByText(t('en', 'discountApproval.pending'))).toBeTruthy());
  view.rerender(<QueryClientProvider client={client}><Harness value={{ ...value, customerId: null, customer: null }} scopeValue={scope} onDrafts={drafts} /></QueryClientProvider>);
  expect(screen.getByText(t('en', 'discountApproval.pending'))).toBeTruthy();
  view.rerender(<QueryClientProvider client={client}><Harness value={value} scopeValue={scope} onDrafts={drafts} /></QueryClientProvider>);
  expect(screen.getByText(t('en', 'discountApproval.pending'))).toBeTruthy();
  view.rerender(<QueryClientProvider client={client}><Harness value={{ ...value, customerId: id(70) }} scopeValue={scope} onDrafts={drafts} /></QueryClientProvider>);
  expect(screen.queryByText(t('en', 'discountApproval.pending'))).toBeNull();
  expect((screen.getByRole('button', { name: t('en', 'discountApproval.request') }) as HTMLButtonElement).disabled).toBe(false);
});
