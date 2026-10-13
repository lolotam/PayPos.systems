import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createSessionAttemptJournal } from '../model/session-attempt-journal';
import { SESSION_ATTEMPT_RETENTION_MS, type SessionAttempt, type SessionAttemptCommand } from '../model/session-attempt';
import { useRecordServiceSession } from './use-record-service-session';
import { useAppendServiceSessionLines } from './use-append-service-session-lines';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: post }) }));
const id = (n: number) => `01920000-0000-7000-8000-${n.toString().padStart(12, '0')}`;
const scope = { companyId: id(1), businessId: id(2), branchId: id(3), userId: id(4) };
const instant = '2026-10-13T08:00:00.000Z';
let now = Date.parse(instant), counter = 40;
const runtime = { now: () => now, newId: vi.fn(() => id(++counter)) };
const line = { service_id: id(5), price: '7.125', discount: { kind: 'PERCENT' as const, bps: 1000 }, performers: [{ employee_id: id(6) }] };
const body = { customer_id: id(7), recorder_membership_id: id(8), lines: [line, line] };
const rows = [id(9), id(10)];
const storageKey = 'pospay:service-session-attempt';
const savedLine = { id: id(11), session_id: id(12), service_id: id(5), input_index: 0, ordinal: 1, name_en: 'Synthetic service', name_ar: null,
  list_price: '7.125', price: '7.125', discount: '0.713', net: '6.412', effective_discount_bps: 1001, limit_bps_applied: null,
  limit_source: 'OWNER', status: 'ACTIVE', revision: 1, rule_snapshot: { kind: 'FOLLOW_PLAN' }, counts_snapshot: true, catalog_revision: 1,
  has_performer_warning: false, recorded_by: scope.userId, recorded_by_membership_id: id(8), recorded_at: instant, late: false,
  performers: [{ id: id(13), employee_id: id(6), performer_ordinal: 1, share_bps: 10000, name_en: 'Synthetic performer', name_ar: null,
    not_clocked_in_warning: false, approved_leave_warning: false }] };
const response = { outcome: 'PARTIAL', session: { id: id(12), business_id: scope.businessId, branch_id: scope.branchId,
  customer: { id: id(7), name: 'Synthetic customer', phone_masked: '***001' }, recorded_by: scope.userId, recorded_by_membership_id: id(8),
  occurred_at: instant, recorded_at: instant, business_date: '2026-10-13', business_timezone: 'Asia/Kuwait', late: false, total_net: '6.412', lines: [savedLine] },
  rejected_lines: [{ input_index: 1, service_id: id(5), name_ar: null, name_en: 'Synthetic service', code: 'SESSION_DISCOUNT_ABOVE_LIMIT',
    message_ar: 'Synthetic AR', message_en: 'Synthetic EN', list_price: '7.125', price: '7.125', discount: '0.713', net: '6.412',
    effective_discount_bps: 1001, limit_bps: 1000, limit_source: 'PERSON', minimum_net: '6.413', max_discount_amount: '0.712' }] };
const journals: ReturnType<typeof createSessionAttemptJournal>[] = [];
function journal(place = scope) {
  const result = createSessionAttemptJournal(place, runtime); journals.push(result); return result;
}
function hooks(store: ReturnType<typeof journal>) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: 3 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => ({ record: useRecordServiceSession(store), append: useAppendServiceSessionLines(store) }), { wrapper });
  return { client, send: (attempt: SessionAttempt) => attempt.kind === 'record' ? hook.result.current.record.mutateAsync(attempt) : hook.result.current.append.mutateAsync(attempt) };
}
afterEach(() => { journals.splice(0).forEach((store) => store.dispose()); sessionStorage.clear(); post.mockReset(); runtime.newId.mockClear(); now = Date.parse(instant); });

it.each([undefined, instant])('freezes the validated body, membership, order and row map with occurred_at %s', (occurred_at) => {
  const store = journal(), original = { ...body, lines: [line, { ...line, price: '8.000', performers: [{ employee_id: id(14) }, { employee_id: id(6) }] }], ...(occurred_at ? { occurred_at } : {}) };
  const draft = structuredClone(original);
  const attempt = store.begin({ kind: 'record', body: draft }, rows);
  draft.lines.reverse(); draft.lines.forEach((row) => { row.price = '0.000'; });
  expect(attempt.body).toEqual(original);
  expect(attempt.rowIds).toEqual(rows); expect(Object.isFrozen(attempt.body.lines[0]?.performers)).toBe(true);
  expect(() => store.begin({ kind: 'record', body }, rows)).toThrow('UNRESOLVED'); expect(runtime.newId).toHaveBeenCalledTimes(1);
});

it.each(['record', 'append'] as const)('reloads and explicitly replays %s with exact headers/route/body; deduplicates clicks', async (kind) => {
  const command: SessionAttemptCommand = kind === 'record' ? { kind, body } : { kind, sessionId: id(12), body: { lines: body.lines, recorder_membership_id: id(8) } };
  const original = journal().begin(command, rows), store = journal(), attempt = store.read();
  if (!attempt || attempt === 'EXPIRED') throw new Error('Missing recovered attempt');
  expect(attempt).toEqual(original); expect(post).not.toHaveBeenCalled();
  let release!: (value: unknown) => void; post.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const hook = hooks(store);
  await act(async () => {
    const first = hook.send(attempt), second = hook.send(attempt);
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    release({ data: kind === 'record' ? response : { ...response, added_lines: [savedLine] }, response: { status: 201 } });
    expect(await first).toMatchObject({ status: 201, data: { outcome: 'PARTIAL', session: response.session } }); await second;
  });
  expect(post).toHaveBeenCalledWith(`/v1/businesses/{businessId}/branches/{branchId}/service-sessions${kind === 'append' ? '/{sessionId}/lines' : ''}`, {
    params: { header: { 'x-company-id': scope.companyId, 'Idempotency-Key': attempt.key },
      path: { businessId: scope.businessId, branchId: scope.branchId, ...(kind === 'append' ? { sessionId: id(12) } : {}) } }, body: attempt.body,
  });
  const options = hook.client.getMutationCache().getAll()[0]?.options;
  expect(options).toMatchObject({ retry: false, gcTime: 0, networkMode: 'always' });
  expect(store.read()).toBeNull(); expect(sessionStorage.length).toBe(0);
});

it.each([new TypeError('Network loss'), new DOMException('Timed out', 'TimeoutError'),
  { status: 409, code: 'IDEMPOTENCY_KEY_IN_PROGRESS' }, { status: 503, code: 'UNAVAILABLE' }])('keeps uncertain outcomes frozen without automatic retry: %s', async (error) => {
  const store = journal(), attempt = store.begin({ kind: 'record', body: { ...body, occurred_at: instant } }, rows), hook = hooks(store);
  if ('status' in error) post.mockResolvedValueOnce({ error, response: { status: error.status } }); else post.mockRejectedValueOnce(error);
  await act(async () => { await expect(hook.send(attempt)).rejects.toMatchObject(error); });
  expect(post).toHaveBeenCalledTimes(1); expect(store.read()).toBe(attempt);
  expect(() => store.begin({ kind: 'record', body }, rows)).toThrow('UNRESOLVED');
  post.mockResolvedValueOnce({ data: { ...response, outcome: 'COMPLETE', rejected_lines: [] }, response: { status: 201 } });
  now += 5000;
  await act(async () => { await hook.send(attempt); });
  expect(post.mock.calls[1]).toEqual(post.mock.calls[0]); expect(runtime.newId).toHaveBeenCalledTimes(1);
});

it.each([['SESSION_DISCOUNT_ABOVE_LIMIT', 422], ['IDEMPOTENCY_KEY_REUSED', 422], ['SESSION_PERFORMER_SHARES_INVALID', 422],
  ['FORBIDDEN', 403], ['VALIDATION_FAILED', 400], ['OTHER_CONFLICT', 409]])('preserves bilingual refusal and details as distinct %s; an edited attempt gets a new key', async (code, status) => {
  const store = journal(), attempt = store.begin({ kind: 'record', body }, rows), hook = hooks(store);
  const error = { code, message_ar: 'Synthetic AR', message_en: 'Synthetic EN', details: { rejected_lines: response.rejected_lines } };
  post.mockResolvedValueOnce({ error, response: { status } });
  await act(async () => { await expect(hook.send(attempt)).rejects.toEqual({ ...error, status }); });
  expect(store.read()).toBeNull(); expect(store.begin({ kind: 'record', body: { ...body, lines: [line] } }, [id(9)]).key).not.toBe(attempt.key);
});

it.each(['companyId', 'businessId', 'branchId', 'userId'] as const)('purges %s changes and refuses old-actor replay', async (field) => {
  const store = journal(), attempt = store.begin({ kind: 'record', body }, rows), send = vi.fn();
  store.changeScope({ ...scope, [field]: id(99) });
  expect(store.read()).toBeNull(); expect(sessionStorage.length).toBe(0);
  await expect(store.run(attempt, send)).rejects.toThrow('UNAVAILABLE'); expect(send).not.toHaveBeenCalled();
});

it('purges on a cross-tab identity signal, including a scheduled send', async () => {
  const store = journal(), attempt = store.begin({ kind: 'record', body }, rows), send = vi.fn(), pending = store.run(attempt, send);
  window.dispatchEvent(new StorageEvent('storage', { key: 'pospay:identity-change', newValue: 'other-tab' }));
  await expect(pending).rejects.toThrow('UNAVAILABLE'); expect(send).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
  store.changeScope(scope); store.begin({ kind: 'record', body }, rows);
  window.dispatchEvent(new StorageEvent('storage', { key: 'pospay:identity-change', newValue: 'another-tab' }));
  expect(store.scope).toBeNull(); expect(sessionStorage.length).toBe(0);
});

it('expires at 24 hours, purges the body/key and blocks replay/new-key recovery across reloads', async () => {
  const store = journal(), attempt = store.begin({ kind: 'record', body }, rows);
  now += SESSION_ATTEMPT_RETENTION_MS - 1; expect(store.read()).toBe(attempt); now += 1;
  expect(store.read()).toBe('EXPIRED'); expect(sessionStorage.getItem(storageKey)).toBe(JSON.stringify({ scope, expired: true }));
  const recovered = journal(); expect(recovered.read()).toBe('EXPIRED');
  expect(() => recovered.begin({ kind: 'record', body }, rows)).toThrow('UNRESOLVED');
  await expect(recovered.run(attempt, vi.fn())).rejects.toThrow('UNAVAILABLE');
});

it('rejects PII before storing and purges malformed journals; malformed successful responses stay unresolved', async () => {
  const store = journal(); expect(() => store.begin({ kind: 'record', body: { ...body, phone: 'synthetic raw phone' } } as SessionAttemptCommand, rows)).toThrow();
  expect(sessionStorage.length).toBe(0);
  const attempt = store.begin({ kind: 'record', body }, rows);
  expect(sessionStorage.getItem(storageKey)).not.toMatch(/phone|name/);
  sessionStorage.setItem(storageKey, JSON.stringify({ ...attempt, body: { ...body, phone: 'synthetic raw phone' } }));
  const recovered = journal(); expect(recovered.read()).toBeNull(); expect(sessionStorage.length).toBe(0);
  const fresh = recovered.begin({ kind: 'record', body }, rows), hook = hooks(recovered);
  post.mockResolvedValueOnce({ data: { outcome: 'COMPLETE' }, response: { status: 201 } });
  await act(async () => { await expect(hook.send(fresh)).rejects.toMatchObject({ status: 201 }); }); expect(recovered.read()).toBe(fresh);
});

it.each([false, true])('purges a prior actor on reload and rejects stale results/refusals (%s)', async (refusal) => {
  const store = journal(), attempt = store.begin({ kind: 'record', body }, rows);
  expect(journal({ ...scope, userId: id(99) }).read()).toBeNull(); expect(sessionStorage.length).toBe(0);
  let release!: (value: string) => void;
  let refuse!: (error: unknown) => void;
  const result = store.run(attempt, () => new Promise<string>((resolve, reject) => { release = resolve; refuse = reject; }));
  await Promise.resolve(); store.changeScope({ ...scope, branchId: id(99) }); store.changeScope(scope);
  const next = store.begin({ kind: 'append', sessionId: id(12), body: { lines: [line] } }, [id(9)]);
  if (refusal) refuse({ status: 422, details: { name: 'Old actor private data' } }); else release('old actor result');
  await expect(result).rejects.toThrow('UNAVAILABLE'); expect(store.read()).toBe(next);
});

it('keeps frozen explicit recovery when browser storage is unavailable', async () => {
  const denied = () => { throw new Error('Storage denied'); };
  const store = createSessionAttemptJournal(scope, runtime, { getItem: denied, setItem: denied, removeItem: denied }); journals.push(store);
  const attempt = store.begin({ kind: 'append', sessionId: id(12), body: { lines: [line] } }, [id(9)]);
  await expect(store.run(attempt, async () => { throw new TypeError('Network loss'); })).rejects.toThrow();
  expect(store.read()).toBe(attempt); expect(await store.run(attempt, async () => 'settled')).toBe('settled');
  expect(store.read()).toBeNull();
});
