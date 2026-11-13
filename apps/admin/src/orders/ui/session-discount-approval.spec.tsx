import type { RequesterDiscountProposalList } from '@pospay/contracts';
import { discountApprovalRefusals, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { afterEach, expect, it, vi } from 'vitest';
import { createSessionDraft, type SessionDraftForm } from '../model/session-drafts';
import { emptySessionRecordingResult, type SessionRecordingResult } from '../model/session-recording-result';
import { id, instant, rejection, scope } from '../model/session-recording-result.fixture';
import { sessionCommandLines } from '../model/use-session-recording';
import { SessionRejectedLines } from './session-rejected-lines';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: api.get, POST: api.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => api.locale }));
const proposalId = id(50), requestId = id(51), termsHash = 'a'.repeat(64);
const requestResponse = { request_id: requestId, occurred_at: instant,
  proposals: [{ id: proposalId, input_index: 0, status: 'PENDING', expires_at: instant, effective_bps: 1001, terms_hash: termsHash }] };

function proposal(status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'): RequesterDiscountProposalList['items'][number] {
  return { kind: 'RECORD', id: proposalId, request_id: requestId, input_index: 0, status, session_id: null, occurred_at: instant,
    service_id: id(5), service_name_en: 'Synthetic service', service_name_ar: null,
    list_price: '7.125', price: '7.125', discount: '0.713', net: '6.412', effective_bps: 1001, expires_at: instant, terms_hash: termsHash,
    ...(status === 'APPROVED' ? { decided_label_ar: 'Approver AR', decided_label_en: 'Layla', decided_via: 'REMOTE' as const } : {}),
    ...(status === 'REJECTED' ? { decided_label_ar: 'Approver AR', decided_label_en: 'Layla', decided_via: 'PIN' as const, reject_reason: 'Too much' } : {}) };
}

function result(): SessionRecordingResult {
  const line = { ...createSessionDraft(id(10)), service_id: id(5), price: '7.125', discount_kind: 'PERCENT' as const,
    discount_percentage: '10', performers: [{ employee_id: id(6), share_percentage: '', selection: null }] };
  const other = { ...createSessionDraft(id(11)), service_id: id(7), price: '2.000' };
  return { ...emptySessionRecordingResult(), customerId: id(7), feedback: { kind: 'ALL_REJECTED' },
    drafts: { occurred_at: instant, recorder_membership_id: id(8), lines: [line, other] },
    rejected: [{ localId: id(10), error: { ...rejection, input_index: 0 } }] };
}

function Harness({ result: value, onCommands }: {
  result: SessionRecordingResult; onCommands: (drafts: SessionDraftForm, lines: ReturnType<typeof sessionCommandLines>) => void;
}) {
  const form = useForm<SessionDraftForm>({ defaultValues: value.drafts });
  const rootError = form.formState.errors.root?.message;
  return <FormProvider {...form}>
    <SessionRejectedLines result={value} onEdit={vi.fn()} scope={scope} online />
    {rootError ? <p role="alert">{rootError}</p> : null}
    <button type="button" onClick={() => onCommands(form.getValues(),
      sessionCommandLines(form.getValues('lines')))}>{t(api.locale, 'serviceSessions.save')}</button>
  </FormProvider>;
}

function mount(value = result()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const commands = vi.fn();
  const view = render(<QueryClientProvider client={client}><Harness result={value} onCommands={commands} /></QueryClientProvider>);
  return { client, commands, view };
}

async function clickRequest(locale: 'ar' | 'en') {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'discountApproval.request') }));
    await Promise.resolve();
  });
}

afterEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  vi.useRealTimers();
});

it.each(['ar', 'en'] as const)('requests refused rows only, polls, and resends an approved proposal in %s', async (locale) => {
  api.locale = locale;
  api.post.mockResolvedValue({ data: requestResponse, response: { status: 201 } });
  api.get.mockResolvedValueOnce({ data: { items: [proposal('PENDING')] }, response: { status: 200 } })
    .mockResolvedValueOnce({ data: { items: [proposal('APPROVED')] }, response: { status: 200 } });
  const { client, commands } = mount();
  await clickRequest(locale);
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  expect(api.post.mock.calls[0]?.[1].body.lines).toHaveLength(1);
  expect(screen.getByText(t(locale, 'discountApproval.pending'))).toBeTruthy();
  expect((screen.getByRole('button', { name: t(locale, 'discountApproval.request') }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  await act(async () => { await client.refetchQueries({ queryKey: ['discount-approval-status'] }); });
  await waitFor(() => expect(screen.getByText(t(locale, 'discountApproval.approved'))).toBeTruthy());
  const decider = locale === 'ar' ? 'Approver AR' : 'Layla';
  expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === `${t(locale, 'discountApproval.decidedBy')}: ${decider}`)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t(locale, 'serviceSessions.save') }));
  expect(commands.mock.calls[0]?.[1][0]).toHaveProperty('discount_proposal_id', proposalId);
});

it.each([null, id(12)])('uses the normalized response time only for a fresh visit: %s', async (sessionId) => {
  api.locale = 'en';
  const normalized = '2026-10-14T00:05:00.000Z';
  api.post.mockResolvedValue({ data: { ...requestResponse, occurred_at: normalized }, response: { status: 201 } });
  api.get.mockResolvedValue({ data: { items: [proposal('PENDING')] }, response: { status: 200 } });
  const { commands } = mount({ ...result(), sessionId });
  await clickRequest('en');
  await waitFor(() => expect(screen.getByText(t('en', 'discountApproval.pending'))).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.save') }));
  expect(commands.mock.calls[0]?.[0].occurred_at).toBe(sessionId === null ? normalized : instant);
});

it('shows the reject reason and decider', async () => {
  api.locale = 'en';
  api.post.mockResolvedValue({ data: requestResponse, response: { status: 201 } });
  api.get.mockResolvedValue({ data: { items: [proposal('REJECTED')] }, response: { status: 200 } });
  mount();
  await clickRequest('en');
  await waitFor(() => expect(screen.getByText((_, element) => element?.textContent === `${t('en', 'discountApproval.reason')}: Too much`)).toBeTruthy());
  expect(screen.getByText((_, element) => element?.textContent === `${t('en', 'discountApproval.decidedBy')}: Layla`)).toBeTruthy();
  expect(screen.getByText(t('en', 'discountApproval.rejected'))).toBeTruthy();
});

it('allows a fresh request after expiry', async () => {
  api.locale = 'en';
  api.post.mockResolvedValue({ data: requestResponse, response: { status: 201 } });
  api.get.mockResolvedValue({ data: { items: [proposal('EXPIRED')] }, response: { status: 200 } });
  mount();
  await clickRequest('en');
  await waitFor(() => expect(screen.getByText(t('en', 'discountApproval.expired'))).toBeTruthy());
  expect((screen.getByRole('button', { name: t('en', 'discountApproval.request') }) as HTMLButtonElement).disabled).toBe(false);
});

it('shows the request envelope on a 422', async () => {
  api.locale = 'en';
  api.post.mockResolvedValue({ error: { code: 'DISCOUNT_APPROVAL_NOT_NEEDED', message_ar: 'Approval AR', message_en: 'Approval not needed' }, response: { status: 422 } });
  const value = result(), { client, commands, view } = mount(value);
  await clickRequest('en');
  await waitFor(() => expect(screen.getByText('Approval not needed')).toBeTruthy());
  const next = { ...value, rejected: [...value.rejected] };
  view.rerender(<QueryClientProvider client={client}><Harness result={next} onCommands={commands} /></QueryClientProvider>);
  expect(screen.queryByText('Approval not needed')).toBeNull();
});

it('shows the existing consumed refusal label on a rejected row', () => {
  api.locale = 'en';
  const value = result(), row = value.rejected[0];
  if (!row) throw new Error('Missing rejected row');
  value.rejected[0] = { ...row, error: { ...row.error, approval_refusal: 'CONSUMED' } };
  mount(value);
  expect(screen.getByText(discountApprovalRefusals.CONSUMED.message_en)).toBeTruthy();
});

it('retries the status read that failed and shows the approved proposal', async () => {
  api.locale = 'en';
  api.post.mockResolvedValue({ data: requestResponse, response: { status: 201 } });
  api.get.mockResolvedValueOnce({ error: { code: 'DISCOUNT_APPROVAL_STATUS_FAILED', message_ar: 'Status read failed AR', message_en: 'Status read failed' }, response: { status: 500 } })
    .mockResolvedValue({ data: { items: [proposal('APPROVED')] }, response: { status: 200 } });
  mount();
  await clickRequest('en');
  await waitFor(() => expect(screen.getByText('Status read failed')).toBeTruthy());
  const retry = screen.getByRole('button', { name: t('en', 'discountApproval.retry') });
  await act(async () => { fireEvent.click(retry); await Promise.resolve(); });
  await waitFor(() => expect(screen.getByText(t('en', 'discountApproval.approved'))).toBeTruthy());
});

it('shows the invalid line error and sends no request', async () => {
  api.locale = 'ar';
  const value = result(), row = value.drafts.lines[0];
  if (!row) throw new Error('Missing rejected row');
  value.drafts.lines[0] = { ...row, price: 'abc' };
  mount(value);
  await clickRequest('ar');
  expect(screen.getByText(t('ar', 'admin.unexpected'))).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
});

it('keeps the pending request after a re-save with a new result', async () => {
  api.locale = 'en';
  api.post.mockResolvedValue({ data: requestResponse, response: { status: 201 } });
  api.get.mockResolvedValue({ data: { items: [proposal('PENDING')] }, response: { status: 200 } });
  const value = result(), { client, commands, view } = mount(value);
  await clickRequest('en');
  await waitFor(() => expect(screen.getByText(t('en', 'discountApproval.pending'))).toBeTruthy());
  const next = { ...value, rejected: [...value.rejected] };
  view.rerender(<QueryClientProvider client={client}><Harness result={next} onCommands={commands} /></QueryClientProvider>);
  expect(screen.getByText(t('en', 'discountApproval.pending'))).toBeTruthy();
  expect((screen.getByRole('button', { name: t('en', 'discountApproval.request') }) as HTMLButtonElement).disabled).toBe(true);
});

it('shows one customer-required alert and sends no request when the fresh visit has no customer', async () => {
  api.locale = 'en';
  const value = { ...result(), customerId: null, customer: null };
  mount(value);
  await clickRequest('en');
  expect(screen.getAllByText(t('en', 'discountApproval.customerRequired'))).toHaveLength(1);
  expect(screen.getByText(t('en', 'discountApproval.customerRequired')).getAttribute('role')).toBe('alert');
  expect(api.post).not.toHaveBeenCalled();
});
