import type { RecordServiceSessionResponse } from '@pospay/contracts';
import { listenForIdentityChanges } from '@/shared/browser/load-page';
import { freezeSessionAttempt, freezeSessionAttemptScope, parseSessionJournalEnvelope, sameSessionScope, sessionAttemptUnresolved,
  SessionSavedDisplayFailure, SESSION_ATTEMPT_RETENTION_MS, type SessionAttempt, type SessionAttemptCommand,
  type SessionAttemptRuntime, type SessionAttemptScope, type SessionJournalEnvelope } from './session-attempt';

const storageKey = 'pospay:service-session-attempt';
type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type WriteResult = { status: number; data: RecordServiceSessionResponse };
const registry = new Map<string, { core: ReturnType<typeof createCore>; users: number }>();

function readStored(storage: JournalStorage | undefined, scope: SessionAttemptScope | null, now: number): SessionJournalEnvelope | null {
  try {
    const raw = storage?.getItem(storageKey); if (!raw) return null;
    const recovered = parseSessionJournalEnvelope(JSON.parse(raw), now);
    const place = recovered.state === 'PENDING' ? recovered.attempt.scope : recovered.scope;
    if (scope && sameSessionScope(scope, place)) return recovered;
  } catch { /* رفض المخطط أو التخزين لا يبيح استبدال محاولة سليمة موجودة في ذاكرة التبويب. */ }
  try { storage?.removeItem(storageKey); } catch { /* قد يمنع المتصفح حذف الإدخال المرفوض أيضاً. */ }
  return null;
}

function expired(entry: SessionJournalEnvelope | null, now: number): SessionJournalEnvelope | null {
  if (entry?.state !== 'PENDING' || now - entry.attempt.createdAt < SESSION_ATTEMPT_RETENTION_MS) return entry;
  const attempt = entry.attempt;
  return { version: 1, state: 'EXPIRED', scope: attempt.scope, key: attempt.key, createdAt: attempt.createdAt,
    ...(attempt.kind === 'append' ? { sessionId: attempt.sessionId } : {}) };
}

function createCore(initialScope: SessionAttemptScope, runtime: SessionAttemptRuntime, storage?: JournalStorage) {
  let scope: SessionAttemptScope | null = freezeSessionAttemptScope(initialScope), value: SessionJournalEnvelope | null = null;
  let flight: { key: string; promise: Promise<WriteResult> } | undefined, stopIdentity: (() => void) | undefined;
  const persist = () => {
    try { if (value) { value = Object.freeze(value); storage?.setItem(storageKey, JSON.stringify(value)); } else storage?.removeItem(storageKey); }
    catch { /* التخزين المقفول لا يسمح باستعادة الصفحة، لكنه لا يغير المحاولة المحفوظة في ذاكرة التبويب. */ }
  };
  const stored = () => {
    const recovered = readStored(storage, scope, runtime.now());
    if (recovered && (value?.state !== 'PENDING' || recovered.state !== 'PENDING' || value.attempt.key !== recovered.attempt.key)) value = recovered;
  };
  const read = () => {
    stored(); const next = expired(value, runtime.now()); if (next !== value) { value = next; persist(); }
    return value;
  };
  const changeScope = (next: SessionAttemptScope | null) => {
    if (!next || !scope || !sameSessionScope(scope, next)) { scope = next ? freezeSessionAttemptScope(next) : null; value = null; flight = undefined; persist(); }
    stopIdentity?.(); stopIdentity = next ? listenForIdentityChanges(() => changeScope(null)) : undefined;
  };
  const matches = (attempt: SessionAttempt) => scope && sameSessionScope(scope, attempt.scope) &&
    ((value?.state === 'PENDING' && value.attempt.key === attempt.key) || (value?.state === 'EXPIRED' && value.key === attempt.key));
  const visit = (sessionId: string | undefined, state: 'PARTIAL' | 'SAVED_DISPLAY_FAILED') => {
    value = scope ? { version: 1, state, scope, ...(sessionId ? { sessionId } : {}) } as SessionJournalEnvelope : null; persist();
  };
  const settle = (attempt: SessionAttempt, result: WriteResult) => {
    stored(); if (!matches(attempt)) throw new Error('SESSION_ATTEMPT_UNAVAILABLE');
    if (result.data.outcome === 'PARTIAL') visit(result.data.session.id, 'PARTIAL'); else { value = null; persist(); }
  };
  const reject = (attempt: SessionAttempt, error: unknown) => {
    stored(); if (!matches(attempt)) throw new Error('SESSION_ATTEMPT_UNAVAILABLE');
    if (error instanceof SessionSavedDisplayFailure) visit(attempt.kind === 'append' ? attempt.sessionId : error.sessionId, 'SAVED_DISPLAY_FAILED');
    else if (!sessionAttemptUnresolved(error)) {
      if (attempt.kind === 'append') visit(attempt.sessionId, 'PARTIAL'); else { value = null; persist(); }
    }
    throw error;
  };
  return {
    read, changeScope, get scope() { return scope; },
    configure(next: SessionAttemptScope, clock: SessionAttemptRuntime, backing?: JournalStorage) { runtime = clock; storage = backing; if (!scope || !sameSessionScope(scope, next)) changeScope(next); stored(); if (!stopIdentity) stopIdentity = listenForIdentityChanges(() => changeScope(null)); },
    stop() { stopIdentity?.(); stopIdentity = undefined; },
    leaveVisit() { if (flight || value?.state === 'PENDING' || value?.state === 'EXPIRED') throw new Error('SESSION_ATTEMPT_UNRESOLVED'); value = null; persist(); },
    acknowledgeExpired() { if (read()?.state !== 'EXPIRED' || flight) throw new Error('SESSION_ATTEMPT_UNAVAILABLE'); value = null; persist(); },
    begin(command: SessionAttemptCommand, rowIds: string[]) {
      const recovered = read();
      if (!scope || flight || recovered?.state === 'PENDING' || recovered?.state === 'EXPIRED') throw new Error('SESSION_ATTEMPT_UNRESOLVED');
      if (recovered && (command.kind !== 'append' || command.sessionId !== recovered.sessionId)) throw new Error('SESSION_VISIT_ALREADY_SAVED');
      const attempt = freezeSessionAttempt(scope, command, rowIds, runtime); value = { version: 1, state: 'PENDING', attempt }; persist(); return attempt;
    },
    run<T extends WriteResult>(attempt: SessionAttempt, send: () => Promise<T>): Promise<T> {
      if (flight?.key === attempt.key && matches(attempt)) return flight.promise as Promise<T>;
      if (read()?.state !== 'PENDING' || !matches(attempt)) return Promise.reject(new Error('SESSION_ATTEMPT_UNAVAILABLE'));
      const promise = Promise.resolve().then(() => {
        if (read()?.state !== 'PENDING' || !matches(attempt)) throw new Error('SESSION_ATTEMPT_UNAVAILABLE'); return send();
      }).then((result) => { settle(attempt, result); return result; }, (error: unknown) => reject(attempt, error))
        .finally(() => { if (flight?.promise === promise) flight = undefined; });
      flight = { key: attempt.key, promise }; return promise;
    },
  };
}

export function createSessionAttemptJournal(initialScope: SessionAttemptScope, runtime: SessionAttemptRuntime, storage?: JournalStorage) {
  try { storage ??= sessionStorage; } catch { /* الذاكرة المشتركة تظل تمنع طلباً جديداً إذا منع المتصفح التخزين. */ }
  let shared = registry.get(storageKey);
  if (!shared) { shared = { core: createCore(initialScope, runtime, storage), users: 0 }; registry.set(storageKey, shared); }
  const entry = shared; entry.users += 1; entry.core.configure(initialScope, runtime, storage);
  let disposed = false, binding = freezeSessionAttemptScope(initialScope);
  const current = () => !disposed && entry.core.scope && sameSessionScope(binding, entry.core.scope);
  const requireCurrent = () => { if (!current()) throw new Error('SESSION_ATTEMPT_UNAVAILABLE'); };
  return {
    get scope() { return current() ? entry.core.scope : null; },
    read() { return current() ? entry.core.read() : null; },
    changeScope(next: SessionAttemptScope | null) { if (!disposed) { if (next) binding = freezeSessionAttemptScope(next); entry.core.changeScope(next); } },
    leaveVisit() { requireCurrent(); entry.core.leaveVisit(); },
    acknowledgeExpired() { requireCurrent(); entry.core.acknowledgeExpired(); },
    begin(command: SessionAttemptCommand, rowIds: string[]) { requireCurrent(); return entry.core.begin(command, rowIds); },
    run<T extends WriteResult>(attempt: SessionAttempt, send: () => Promise<T>): Promise<T> { return current() ? entry.core.run(attempt, send) : Promise.reject(new Error('SESSION_ATTEMPT_UNAVAILABLE')); },
    dispose() { if (!disposed) { disposed = true; entry.users -= 1; if (entry.users === 0 && !entry.core.read()) entry.core.stop(); } },
  };
}
export type SessionAttemptJournal = ReturnType<typeof createSessionAttemptJournal>;
