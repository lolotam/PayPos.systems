import type { ReactNode } from 'react';
import type { RecordServiceSessionResponse, SavedServiceLine } from '@pospay/contracts';
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
const savedLine: SavedServiceLine = { id: id(11), session_id: id(12), service_id: id(5), input_index: 0, ordinal: 1, name_en: 'Synthetic service', name_ar: null,
  list_price: '7.125', price: '7.125', discount: '0.713', net: '6.412', effective_discount_bps: 1001, limit_bps_applied: null,
  limit_source: 'OWNER', status: 'ACTIVE', revision: 1, rule_snapshot: { kind: 'FOLLOW_PLAN' }, counts_snapshot: true, catalog_revision: 1,
  has_performer_warning: false, recorded_by: scope.userId, recorded_by_membership_id: id(8), recorded_at: instant, late: false,
  performers: [{ id: id(13), employee_id: id(6), performer_ordinal: 1, share_bps: 10000, name_en: 'Synthetic performer', name_ar: null,
    not_clocked_in_warning: false, approved_leave_warning: false }] };
const response: RecordServiceSessionResponse = { outcome: 'PARTIAL', session: { id: id(12), business_id: scope.businessId, branch_id: scope.branchId,
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
afterEach(() => { journals.splice(0).forEach((store) => { store.changeScope(null); store.dispose(); }); sessionStorage.clear(); post.mockReset(); runtime.newId.mockClear(); now = Date.parse(instant); });
async function reload() {
  const raw = sessionStorage.getItem(storageKey);
  journals.forEach((store) => { store.changeScope(null); store.dispose(); });
  if (raw) sessionStorage.setItem(storageKey, raw);
  vi.resetModules();
  const { createSessionAttemptJournal: create } = await import('../model/session-attempt-journal');
  const store = create(scope, runtime); journals.push(store); return store;
}

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
  const original = journal().begin(command, rows), store = await reload(), recovered = store.read();
  if (recovered?.state !== 'PENDING') throw new Error('Missing recovered attempt');
  const attempt = recovered.attempt;
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
  expect(store.read()).toEqual({ version: 1, state: 'PARTIAL', scope, sessionId: id(12) });
});

it.each([new TypeError('Network loss'), new DOMException('Timed out', 'TimeoutError'),
  { status: 409, code: 'IDEMPOTENCY_KEY_IN_PROGRESS' }, { status: 409, code: 'TRANSACTION_RETRY_REQUIRED' }, { status: 503, code: 'UNAVAILABLE' }])('keeps uncertain outcomes frozen without automatic retry: %s', async (error) => {
  const store = journal(), attempt = store.begin({ kind: 'record', body: { ...body, occurred_at: instant } }, rows), hook = hooks(store);
  if ('status' in error) post.mockResolvedValueOnce({ error, response: { status: error.status } }); else post.mockRejectedValueOnce(error);
  await act(async () => { await expect(hook.send(attempt)).rejects.toMatchObject(error); });
  expect(post).toHaveBeenCalledTimes(1); expect(store.read()).toEqual({ version: 1, state: 'PENDING', attempt });
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
  now += SESSION_ATTEMPT_RETENTION_MS - 1; expect(store.read()).toEqual({ version: 1, state: 'PENDING', attempt }); now += 1;
  const expired = { version: 1, state: 'EXPIRED', scope, key: attempt.key, createdAt: attempt.createdAt };
  expect(store.read()).toEqual(expired); expect(sessionStorage.getItem(storageKey)).toBe(JSON.stringify(expired));
  const recovered = await reload(); expect(recovered.read()).toEqual(expired);
  expect(() => recovered.begin({ kind: 'record', body }, rows)).toThrow('UNRESOLVED');
  await expect(recovered.run(attempt, vi.fn())).rejects.toThrow('UNAVAILABLE');
  recovered.acknowledgeExpired(); expect(recovered.read()).toBeNull(); expect(sessionStorage.length).toBe(0);
  expect(recovered.begin({ kind: 'record', body }, rows).key).not.toBe(attempt.key);
});

it('rejects PII before storing and purges malformed journals', async () => {
  const store = journal(); expect(() => store.begin({ kind: 'record', body: { ...body, phone: 'synthetic raw phone' } } as SessionAttemptCommand, rows)).toThrow();
  expect(sessionStorage.length).toBe(0);
  const attempt = store.begin({ kind: 'record', body }, rows);
  expect(sessionStorage.getItem(storageKey)).not.toMatch(/phone|name/);
  sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, state: 'PENDING', attempt: { ...attempt, body: { ...body, phone: 'synthetic raw phone' } } }));
  expect((await reload()).read()).toBeNull(); expect(sessionStorage.length).toBe(0);
});

it.each([false, true])('purges a prior actor on reload and rejects stale results/refusals (%s)', async (refusal) => {
  const store = journal(), attempt = store.begin({ kind: 'record', body }, rows);
  let release!: (value: string) => void;
  let refuse!: (error: unknown) => void;
  const result = store.run(attempt, async () => { await new Promise<string>((resolve, reject) => { release = resolve; refuse = reject; }); return { status: 201, data: response }; });
  await Promise.resolve(); expect(journal({ ...scope, userId: id(99) }).read()).toBeNull(); expect(sessionStorage.length).toBe(0);
  await Promise.resolve(); store.changeScope({ ...scope, branchId: id(99) }); store.changeScope(scope);
  const next = store.begin({ kind: 'append', sessionId: id(12), body: { lines: [line] } }, [id(9)]);
  if (refusal) refuse({ status: 422, details: { name: 'Old actor private data' } }); else release('old actor result');
  await expect(result).rejects.toThrow('UNAVAILABLE'); expect(store.read()).toEqual({ version: 1, state: 'PENDING', attempt: next });
});

it('keeps frozen explicit recovery when browser storage is unavailable', async () => {
  const denied = () => { throw new Error('Storage denied'); };
  const store = createSessionAttemptJournal(scope, runtime, { getItem: denied, setItem: denied, removeItem: denied }); journals.push(store);
  const attempt = store.begin({ kind: 'append', sessionId: id(12), body: { lines: [line] } }, [id(9)]);
  await expect(store.run(attempt, async () => { throw new TypeError('Network loss'); })).rejects.toThrow();
  expect(store.read()).toEqual({ version: 1, state: 'PENDING', attempt });
  expect(await store.run(attempt, async () => ({ status: 201, data: { ...response, outcome: 'COMPLETE', rejected_lines: [] } }))).toMatchObject({ status: 201 });
  expect(store.read()).toBeNull();
});

it('shares pending/flight across two instances and remounts without overwriting the tab entry', async () => {
  const first = journal(), second = journal(), attempt = first.begin({ kind: 'record', body }, rows);
  const raw = sessionStorage.getItem(storageKey);
  expect(() => second.begin({ kind: 'record', body }, rows)).toThrow('UNRESOLVED');
  first.dispose(); expect(() => journal().begin({ kind: 'record', body }, rows)).toThrow('UNRESOLVED');
  expect(sessionStorage.getItem(storageKey)).toBe(raw); expect(runtime.newId).toHaveBeenCalledTimes(1);
  let release!: (value: { status: number; data: RecordServiceSessionResponse }) => void;
  const send = vi.fn(() => new Promise<{ status: number; data: RecordServiceSessionResponse }>((resolve) => { release = resolve; }));
  const a = second.run(attempt, send), b = journal().run(attempt, send); await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(1); release({ status: 201, data: response }); await Promise.all([a, b]);
});

it('keeps an append authoritative over stale PARTIAL storage after quota failure and replays the same key', async () => {
  let full = false;
  const backing = { getItem: (key: string) => sessionStorage.getItem(key), removeItem: (key: string) => sessionStorage.removeItem(key),
    setItem(key: string, value: string) { if (full) throw new DOMException('Quota exceeded', 'QuotaExceededError'); sessionStorage.setItem(key, value); } };
  const store = createSessionAttemptJournal(scope, runtime, backing); journals.push(store);
  const first = store.begin({ kind: 'record', body }, rows);
  await store.run(first, async () => ({ status: 201, data: response }));
  expect(store.persistenceWarning).toBeNull();
  const persisted = sessionStorage.getItem(storageKey);
  full = true;
  const command: SessionAttemptCommand = { kind: 'append', sessionId: id(12), body: { lines: [line], recorder_membership_id: id(8) } };
  const attempt = store.begin(command, [id(10)]), hook = hooks(store);
  expect(sessionStorage.getItem(storageKey)).toBe(persisted);
  expect(store.persistenceWarning).toBe('NOT_PERSISTED');
  expect(store.read()).toEqual({ version: 1, state: 'PENDING', attempt });
  expect(() => store.begin(command, [id(10)])).toThrow('UNRESOLVED');
  post.mockRejectedValueOnce(new TypeError('Network loss'));
  await act(async () => { await expect(hook.send(attempt)).rejects.toThrow('Network loss'); });
  const second = createSessionAttemptJournal(scope, runtime, backing); journals.push(second);
  expect(second.read()).toEqual({ version: 1, state: 'PENDING', attempt });
  expect(second.persistenceWarning).toBe('NOT_PERSISTED');
  expect(() => second.begin(command, [id(10)])).toThrow('UNRESOLVED');
  let release!: (value: unknown) => void;
  post.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const replayHook = hooks(second);
  await act(async () => {
    const replay = replayHook.send(attempt);
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    now += SESSION_ATTEMPT_RETENTION_MS;
    expect(second.read()?.state).toBe('EXPIRED'); expect(second.read()?.state).toBe('EXPIRED');
    expect(() => second.begin(command, [id(10)])).toThrow('UNRESOLVED');
    release({ data: { ...response, outcome: 'COMPLETE', rejected_lines: [], added_lines: [savedLine] }, response: { status: 201 } });
    await expect(replay).resolves.toMatchObject({ status: 201 });
  });
  expect(post.mock.calls[1]).toEqual(post.mock.calls[0]); expect(runtime.newId).toHaveBeenCalledTimes(2);
  expect(second.read()).toBeNull(); expect(sessionStorage.getItem(storageKey)).toBeNull();
  expect(second.persistenceWarning).toBeNull();
});

it('keeps initialized idle memory authoritative over stale storage after a scope reset', () => {
  const first = journal(), second = journal(), attempt = first.begin({ kind: 'record', body }, rows), raw = sessionStorage.getItem(storageKey);
  first.changeScope(null); second.changeScope(scope);
  if (!raw) throw new Error('Missing persisted attempt'); sessionStorage.setItem(storageKey, raw);
  expect(second.read()).toBeNull();
  expect(second.begin({ kind: 'record', body }, rows).key).not.toBe(attempt.key); expect(runtime.newId).toHaveBeenCalledTimes(2);
});

it.each(['companyId', 'businessId', 'branchId', 'userId'] as const)('invalidates an old instance when another selects a different %s', async (field) => {
  const first = journal(), attempt = first.begin({ kind: 'record', body }, rows);
  const second = journal({ ...scope, [field]: id(99) });
  expect(first.scope).toBeNull(); expect(first.read()).toBeNull(); expect(second.read()).toBeNull();
  expect(() => first.begin({ kind: 'record', body }, rows)).toThrow('UNAVAILABLE');
  await expect(first.run(attempt, vi.fn())).rejects.toThrow('UNAVAILABLE');
});

it('retains PARTIAL across reload, enforces the append route and preserves the visit through a refusal', async () => {
  const store = journal(), hook = hooks(store), attempt = store.begin({ kind: 'record', body }, rows);
  post.mockResolvedValueOnce({ data: response, response: { status: 201 } }); await act(async () => { await hook.send(attempt); });
  let recovered = await reload(); expect(recovered.read()).toMatchObject({ state: 'PARTIAL', sessionId: id(12) });
  expect(() => recovered.begin({ kind: 'record', body }, rows)).toThrow('ALREADY_SAVED');
  const correction = recovered.begin({ kind: 'append', sessionId: id(12), body: { lines: [line] } }, [id(10)]);
  const appender = hooks(recovered); post.mockResolvedValueOnce({ error: { code: 'SESSION_DISCOUNT_ABOVE_LIMIT' }, response: { status: 422 } });
  await act(async () => { await expect(appender.send(correction)).rejects.toMatchObject({ status: 422 }); });
  recovered = await reload(); const next = recovered.begin({ kind: 'append', sessionId: id(12), body: { lines: [line] } }, [id(10)]);
  post.mockResolvedValueOnce({ data: { ...response, outcome: 'COMPLETE', rejected_lines: [], added_lines: [savedLine] }, response: { status: 201 } });
  const complete = hooks(recovered); await act(async () => { await complete.send(next); });
  expect(post.mock.calls.at(-1)?.[0]).toContain('/{sessionId}/lines'); expect(recovered.read()).toBeNull(); expect(sessionStorage.length).toBe(0);
});

it('accepts a definite 201 by key after expiry and permits explicit leave after PARTIAL', async () => {
  const store = journal(), attempt = store.begin({ kind: 'record', body }, rows);
  let release!: (value: { status: number; data: RecordServiceSessionResponse }) => void;
  const result = store.run(attempt, () => new Promise<{ status: number; data: RecordServiceSessionResponse }>((resolve) => { release = resolve; }));
  await Promise.resolve(); now += SESSION_ATTEMPT_RETENTION_MS; expect(store.read()?.state).toBe('EXPIRED');
  expect(() => store.acknowledgeExpired()).toThrow('UNAVAILABLE');
  release({ status: 201, data: response }); await expect(result).resolves.toMatchObject({ status: 201 });
  expect(store.read()).toMatchObject({ state: 'PARTIAL', sessionId: id(12) }); store.leaveVisit();
  expect(store.read()).toBeNull(); expect((await reload()).read()).toBeNull();
});

it.each(['record', 'append'] as const)('records malformed %s 2xx as saved/display-failed, keeps a parseable id and never replays', async (kind) => {
  const store = journal(), command: SessionAttemptCommand = kind === 'record' ? { kind, body } : { kind, sessionId: id(12), body: { lines: body.lines } };
  const attempt = store.begin(command, rows), hook = hooks(store);
  post.mockResolvedValueOnce({ data: { session: { id: id(12), phone: 'synthetic PII' } }, response: { status: 201 } });
  await act(async () => { await expect(hook.send(attempt)).rejects.toMatchObject({ status: 201, code: 'SESSION_SAVED_DISPLAY_FAILED', sessionId: id(12) }); });
  expect(store.read()).toEqual({ version: 1, state: 'SAVED_DISPLAY_FAILED', scope, sessionId: id(12) });
  expect(sessionStorage.getItem(storageKey)).not.toMatch(/phone|body|key/);
  const recovered = await reload(); await expect(recovered.run(attempt, vi.fn())).rejects.toThrow('UNAVAILABLE');
  expect(post).toHaveBeenCalledTimes(1); expect(recovered.read()).toMatchObject({ state: 'SAVED_DISPLAY_FAILED', sessionId: id(12) });
  expect(() => recovered.begin({ kind: 'record', body }, rows)).toThrow('ALREADY_SAVED');
  const append: SessionAttemptCommand = { kind: 'append', sessionId: id(12), body: { lines: body.lines } };
  expect(() => recovered.begin(append, rows)).toThrow('ALREADY_SAVED'); expect(runtime.newId).toHaveBeenCalledTimes(1);
  recovered.leaveVisit(); expect(recovered.begin(append, rows).key).not.toBe(attempt.key);
});

it.each(['PARTIAL', 'SAVED_DISPLAY_FAILED'] as const)('keeps committed %s memory authoritative when persisting it fails', async (state) => {
  let full = false;
  const backing = { getItem: (key: string) => sessionStorage.getItem(key), removeItem: (key: string) => sessionStorage.removeItem(key),
    setItem(key: string, value: string) { if (full) throw new DOMException('Quota exceeded', 'QuotaExceededError'); sessionStorage.setItem(key, value); } };
  const store = createSessionAttemptJournal(scope, runtime, backing); journals.push(store);
  const attempt = store.begin({ kind: 'record', body }, rows), persisted = sessionStorage.getItem(storageKey), hook = hooks(store);
  full = true;
  post.mockResolvedValueOnce({ data: state === 'PARTIAL' ? response : { session: { id: id(12) } }, response: { status: 201 } });
  await act(async () => {
    if (state === 'PARTIAL') await hook.send(attempt);
    else await expect(hook.send(attempt)).rejects.toMatchObject({ code: 'SESSION_SAVED_DISPLAY_FAILED' });
  });
  expect(sessionStorage.getItem(storageKey)).toBe(persisted);
  const remounted = createSessionAttemptJournal(scope, runtime, backing); journals.push(remounted);
  for (const current of [store, remounted]) {
    expect(current.read()).toEqual({ version: 1, state, scope, sessionId: id(12) });
    expect(current.persistenceWarning).toBe('NOT_PERSISTED');
    const send = vi.fn(); await expect(current.run(attempt, send)).rejects.toThrow('UNAVAILABLE'); expect(send).not.toHaveBeenCalled();
  }
  expect(post).toHaveBeenCalledTimes(1); expect(runtime.newId).toHaveBeenCalledTimes(1);
});

it('keeps initialized idle memory after COMPLETE even if removing the stale PENDING entry fails', async () => {
  const backing = { getItem: (key: string) => sessionStorage.getItem(key), setItem: (key: string, value: string) => sessionStorage.setItem(key, value),
    removeItem() { throw new Error('Storage denied'); } };
  const store = createSessionAttemptJournal(scope, runtime, backing); journals.push(store);
  const attempt = store.begin({ kind: 'record', body }, rows);
  await store.run(attempt, async () => ({ status: 201, data: { ...response, outcome: 'COMPLETE', rejected_lines: [] } }));
  expect(store.read()).toBeNull(); expect(store.persistenceWarning).toBe('NOT_PERSISTED');
  await expect(store.run(attempt, vi.fn())).rejects.toThrow('UNAVAILABLE');
});

it('marks malformed 2xx saved even without a valid response session id', async () => {
  const store = journal(), attempt = store.begin({ kind: 'record', body }, rows), hook = hooks(store);
  post.mockResolvedValueOnce({ data: { session: { id: 'invalid' } }, response: { status: 201 } });
  await act(async () => { await expect(hook.send(attempt)).rejects.toMatchObject({ code: 'SESSION_SAVED_DISPLAY_FAILED' }); });
  expect(store.read()).toEqual({ version: 1, state: 'SAVED_DISPLAY_FAILED', scope });
  await expect(store.run(attempt, vi.fn())).rejects.toThrow('UNAVAILABLE'); store.leaveVisit(); expect(store.read()).toBeNull();
});

it.each(['legacy', 'version', 'extra', 'scopePii', 'future', 'invalidTime', 'invalidKind', 'partialId', 'partialPii', 'expiredFuture', 'expiredExtra'])('rejects and purges an invalid %s storage envelope', async (failure) => {
  const attempt = journal().begin({ kind: 'record', body }, rows);
  const bad: Record<string, unknown> = { version: 1, state: 'PENDING', attempt };
  if (failure === 'legacy') { delete bad.version; bad.state = 'EXPIRED'; bad.scope = scope; bad.expired = true; }
  if (failure === 'version') bad.version = 2;
  if (failure === 'extra') bad.phone = 'synthetic PII';
  if (failure === 'scopePii') bad.attempt = { ...attempt, scope: { ...scope, phone: 'synthetic PII' } };
  if (failure === 'future' || failure === 'invalidTime') bad.attempt = { ...attempt, createdAt: failure === 'future' ? now + 1 : 'invalid' };
  if (failure === 'invalidKind') bad.attempt = { ...attempt, kind: 'unknown' };
  if (failure.startsWith('partial')) { delete bad.attempt; bad.state = 'PARTIAL'; bad.scope = scope; bad.sessionId = failure === 'partialId' ? 'invalid' : id(12); if (failure === 'partialPii') bad.phone = 'synthetic PII'; }
  if (failure.startsWith('expired')) { delete bad.attempt; bad.state = 'EXPIRED'; bad.scope = scope; bad.key = attempt.key; bad.createdAt = failure === 'expiredFuture' ? now + 1 : now; if (failure === 'expiredExtra') bad.phone = 'synthetic PII'; }
  sessionStorage.setItem(storageKey, JSON.stringify(bad)); expect((await reload()).read()).toBeNull(); expect(sessionStorage.length).toBe(0);
});
