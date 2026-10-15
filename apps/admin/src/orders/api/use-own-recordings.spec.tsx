import type { ReactNode } from 'react';
import type { ServiceSessionRecoveryPage } from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { id, scope } from '../model/session-recording-result.fixture';
import type { ExpiredAttemptView } from '../model/session-recording-result';
import type { ExpiredRecoveryProof } from '../model/session-attempt-journal';
import { RECOVERY_REVOKE_TIMEOUT_MS, revokeOwnRecording, useOwnRecordings, useRevokeOwnRecording } from './use-own-recordings';

const probe = 'redaction-probe-value';
const when = '2026-10-13T08:00:00.000Z';
const recoveryPath = '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/recovery';
const confirmPath = '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/recovery/confirm';
const state = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, POST: state.post }) }));

function page(name: string, cursor: string | null, outcome?: 'COMMITTED' | 'NOT_COMMITTED', itemId = id(30)): ServiceSessionRecoveryPage {
  return {
    items: [{ id: itemId, occurred_at: when, customer_name: name, customer_phone_masked: '***001', lines: [{ id: id(31), ordinal: 1, name_ar: 'Marked line', name_en: 'Synthetic service' }] }],
    next_cursor: cursor,
    attempt: { business_date: '2026-10-13', business_timezone: 'Asia/Kuwait', issued_at: when, expires_at: '2026-10-14T08:00:00.000Z', ...(outcome ? { outcome } : {}) },
  };
}
function refusal(code: string, details?: unknown) {
  return { code, message_ar: 'Synthetic refusal', message_en: 'Refused', ...(details === undefined ? {} : { details }) };
}
function sentAttempt(lastSentAt: number | null = Date.parse(when)): ExpiredAttemptView {
  return { key: probe, createdAt: Date.parse(when), operation: 'record-service-session', ...(lastSentAt === null ? {} : { lastSentAt }) };
}
function proof(outcome: ExpiredRecoveryProof['outcome'] = 'NOT_RECORDED'): ExpiredRecoveryProof {
  return { scope, key: probe, createdAt: Date.parse(when), lastSentAt: Date.parse(when), operation: 'record-service-session', outcome };
}
function mount(attempt = sentAttempt(), retry = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: retry ? 3 : false }, mutations: { retry: 3 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(() => useOwnRecordings(scope, attempt), { wrapper }) };
}

it('sends the recovery key only in the header and pages with the cursor', async () => {
  state.get.mockReset();
  state.get.mockResolvedValueOnce({ data: page('First', 'page-two') }).mockResolvedValueOnce({ data: page('Second', null, undefined, id(32)) });
  const hook = mount();
  await waitFor(() => expect(hook.result.current.panel).toMatchObject({ kind: 'LIST', nextCursor: 'page-two' }));
  await act(async () => { await hook.result.current.fetchNextPage(); });
  await waitFor(() => expect(hook.result.current.data?.pages).toHaveLength(2));
  expect(state.get.mock.calls.map((call) => call[0])).toEqual([recoveryPath, recoveryPath]);
  expect(state.get.mock.calls.map((call) => call[1].params.query)).toEqual([
    { operation: 'record-service-session' }, { operation: 'record-service-session', cursor: 'page-two' },
  ]);
  expect(state.get.mock.calls.every((call) => call[1].params.header['x-recovery-key'] === probe && call[1].params.header['x-company-id'] === scope.companyId)).toBe(true);
  expect(JSON.stringify(state.get.mock.calls.map((call) => [call[0], call[1].params.query, call[1].params.path]))).not.toContain(probe);
  expect(JSON.stringify(hook.client.getQueryCache().getAll().map((query) => query.queryKey))).not.toContain(probe);
  expect(hook.result.current.panel && hook.result.current.panel.kind === 'LIST' && hook.result.current.panel.visits).toHaveLength(2);
});

it.each([
  ['SESSION_RECOVERY_NOT_FOUND', 'NEVER_REACHED'],
  ['SESSION_RECOVERY_CLOSED', 'WINDOW_ENDED'],
  ['FORBIDDEN', 'CANNOT_VERIFY'],
] as const)('maps %s to %s without a retry', async (code, kind) => {
  state.get.mockReset(); state.get.mockResolvedValue({ error: refusal(code), response: { status: 409 } });
  const hook = mount(sentAttempt(), true);
  await waitFor(() => expect(hook.result.current.panel).toEqual({ kind }));
  expect(state.get).toHaveBeenCalledTimes(1);
});

it('maps NOT_YET to the opening time', async () => {
  state.get.mockReset(); state.get.mockResolvedValue({ error: refusal('SESSION_RECOVERY_NOT_YET', { opens_at: when }), response: { status: 409 } });
  const hook = mount();
  await waitFor(() => expect(hook.result.current.panel).toEqual({ kind: 'NOT_YET', opensAt: when }));
});

it('does not call the read when the attempt has no lastSentAt', async () => {
  state.get.mockReset();
  const hook = mount(sentAttempt(null));
  expect(hook.result.current.panel).toEqual({ kind: 'NEVER_REACHED' });
  await Promise.resolve();
  expect(state.get).not.toHaveBeenCalled();
});

it('keeps loaded visits when the next page answers CLOSED', async () => {
  state.get.mockReset();
  state.get.mockResolvedValueOnce({ data: page('Kept', 'page-two', 'COMMITTED') }).mockResolvedValueOnce({ error: refusal('SESSION_RECOVERY_CLOSED'), response: { status: 409 } });
  const hook = mount();
  await waitFor(() => expect(hook.result.current.hasNextPage).toBe(true));
  await act(async () => { await hook.result.current.fetchNextPage(); });
  await waitFor(() => expect(hook.result.current.panel).toMatchObject({ kind: 'LIST', notice: 'WINDOW_ENDED', nextCursor: null, outcome: 'COMMITTED' }));
  expect(hook.result.current.panel && hook.result.current.panel.kind === 'LIST' && hook.result.current.panel.visits.map((visit) => visit.customer_name)).toEqual(['Kept']);
  expect(state.get).toHaveBeenCalledTimes(2);
});

it('revokes once through the header and does not retry a refusal', async () => {
  state.post.mockReset();
  const error = refusal('FORBIDDEN');
  state.post.mockResolvedValue({ error, response: { status: 403 } });
  const client = new QueryClient({ defaultOptions: { mutations: { retry: 3 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useRevokeOwnRecording(), { wrapper });
  await act(async () => { await expect(hook.result.current.mutateAsync(proof())).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 }); });
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(state.post).toHaveBeenCalledWith(confirmPath, {
    params: { header: { 'x-company-id': scope.companyId, 'x-recovery-key': probe }, path: { businessId: scope.businessId, branchId: scope.branchId } },
    body: { operation: 'record-service-session', outcome: 'NOT_RECORDED' }, signal: expect.any(AbortSignal),
  });
  expect(JSON.stringify(state.post.mock.calls[0]?.[1].params.path)).not.toContain(probe);
  expect(client.getMutationCache().getAll().at(-1)?.options.retry).toBe(false);
});

it('aborts the single revoke when the short timeout elapses', async () => {
  state.post.mockReset(); vi.useFakeTimers();
  try {
    state.post.mockImplementation((_path: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => { reject(new Error('aborted')); });
    }));
    const pending = revokeOwnRecording(proof('RECORDED_ELSEWHERE'));
    const failed = expect(pending).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(RECOVERY_REVOKE_TIMEOUT_MS);
    await failed;
    expect(state.post).toHaveBeenCalledTimes(1);
    expect(state.post.mock.calls[0]?.[1].signal.aborted).toBe(true);
  } finally { vi.useRealTimers(); }
});
