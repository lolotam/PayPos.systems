import type { RecordServiceSessionResponse } from '@pospay/contracts';
import { serviceSessionErrors } from '@pospay/i18n';
import { listenForIdentityChanges } from '@/shared/browser/load-page';
import { freezeSessionAttempt, freezeSessionAttemptScope, sameSessionScope, sessionAttemptUnresolved,
  SessionSavedDisplayFailure, SESSION_ATTEMPT_RETENTION_MS, SESSION_ATTEMPT_SAFETY_MARGIN_MS, type SessionAttempt, type SessionAttemptCommand,
  type SessionAttemptRuntime, type SessionAttemptScope, type SessionJournalEnvelope } from './session-attempt';
import { createSessionAttemptSlotStore, type JournalStorage } from './session-attempt-slot-store';

const storageKey = 'pospay:service-session-attempt';
type WriteResult = { status: number; data: RecordServiceSessionResponse };
const registry = new Map<string, { core: ReturnType<typeof createCore>; users: number }>();

function retentionElapsed(entry: Extract<SessionJournalEnvelope, { state: 'PENDING' | 'EXPIRED' }>, now: number) {
  const createdAt = entry.state === 'PENDING' ? entry.attempt.createdAt : entry.createdAt;
  return Math.max(0, now - Math.max(createdAt, entry.lastSentAt ?? createdAt)) >= SESSION_ATTEMPT_RETENTION_MS + SESSION_ATTEMPT_SAFETY_MARGIN_MS;
}

function expired(entry: SessionJournalEnvelope | null, now: number): SessionJournalEnvelope | null {
  if (entry?.state !== 'PENDING' || !retentionElapsed(entry, now)) return entry;
  const attempt = entry.attempt;
  return { version: 1, state: 'EXPIRED', scope: attempt.scope, key: attempt.key, createdAt: attempt.createdAt, ...(entry.lastSentAt !== undefined ? { lastSentAt: entry.lastSentAt } : {}),
    ...(attempt.kind === 'append' ? { sessionId: attempt.sessionId } : {}) };
}

function persistenceError() {
  return Object.assign(new Error('SESSION_ATTEMPT_NOT_PERSISTED'), { code: 'SESSION_ATTEMPT_NOT_PERSISTED', ...serviceSessionErrors.SESSION_ATTEMPT_NOT_PERSISTED });
}

// visitTimes: وقت الزيارة من السيرفر؛ الإلحاق المرفوض ما بيرجّعش جسم، وبعد reload التصحيح لازم يتقرا على وقت الزيارة مش «دلوقتي».
function createCore(initialScope: SessionAttemptScope, runtime: SessionAttemptRuntime, storage?: JournalStorage) {
  const slots = createSessionAttemptSlotStore(storage);
  let scope: SessionAttemptScope | null = freezeSessionAttemptScope(initialScope), value: SessionJournalEnvelope | null | undefined;
  let flight: { key: string; promise: Promise<WriteResult> } | undefined, stopIdentity: (() => void) | undefined;
  let persistenceWarning: 'NOT_PERSISTED' | null = null; const visitTimes = new Map<string, string>();
  const transition = (next: SessionJournalEnvelope | null, required = false) => {
    persistenceWarning = slots.write(next) ? null : 'NOT_PERSISTED';
    if (required && persistenceWarning) throw persistenceError(); value = next ? Object.freeze(next) : null;
  };
  const read = () => {
    // نستعيد التخزين مرة عند تحميل التبويب؛ بعدها تتقدم حالة الذاكرة حتى لو فشل حفظها.
    if (value === undefined) { value = slots.recover(scope); if (slots.blocked) persistenceWarning = 'NOT_PERSISTED'; if (value?.state === 'PARTIAL' && value.occurredAt) visitTimes.set(value.sessionId, value.occurredAt); }
    const next = expired(value ?? null, runtime.now()); if (next !== value) transition(next);
    return value ?? null;
  };
  const changeScope = (next: SessionAttemptScope | null) => {
    if (!next || !scope || !sameSessionScope(scope, next)) { scope = next ? freezeSessionAttemptScope(next) : null; value = null; flight = undefined; slots.purge(); persistenceWarning = slots.blocked ? 'NOT_PERSISTED' : null; }
    stopIdentity?.(); stopIdentity = next ? listenForIdentityChanges(() => changeScope(null)) : undefined;
  };
  const matches = (attempt: SessionAttempt) => scope && sameSessionScope(scope, attempt.scope) &&
    ((value?.state === 'PENDING' && value.attempt.key === attempt.key) || (value?.state === 'EXPIRED' && value.key === attempt.key));
  const visit = (sessionId: string | undefined, state: 'PARTIAL' | 'SAVED_DISPLAY_FAILED') => {
    const occurredAt = state === 'PARTIAL' && sessionId ? visitTimes.get(sessionId) : undefined; transition(scope ? { version: 1, state, scope, ...(sessionId ? { sessionId } : {}), ...(occurredAt ? { occurredAt } : {}) } as SessionJournalEnvelope : null);
  };
  const settle = (attempt: SessionAttempt, result: WriteResult) => {
    if (!matches(attempt)) throw new Error('SESSION_ATTEMPT_UNAVAILABLE'); visitTimes.set(result.data.session.id, result.data.session.occurred_at);
    if (result.data.outcome === 'PARTIAL') visit(result.data.session.id, 'PARTIAL'); else transition(null);
  };
  const reject = (attempt: SessionAttempt, error: unknown) => {
    if (!matches(attempt)) throw new Error('SESSION_ATTEMPT_UNAVAILABLE');
    if (error instanceof SessionSavedDisplayFailure) visit(attempt.kind === 'append' ? attempt.sessionId : error.sessionId, 'SAVED_DISPLAY_FAILED');
    else if (!sessionAttemptUnresolved(error)) {
      if (attempt.kind === 'append') visit(attempt.sessionId, 'PARTIAL'); else transition(null);
    }
    throw error;
  };
  return {
    read, changeScope, get scope() { return scope; }, get persistenceWarning() { return persistenceWarning; },
    configure(next: SessionAttemptScope, clock: SessionAttemptRuntime, backing?: JournalStorage) { runtime = clock; slots.configure(backing); if (!scope || !sameSessionScope(scope, next)) changeScope(next); read(); if (!stopIdentity) stopIdentity = listenForIdentityChanges(() => changeScope(null)); },
    stop() { stopIdentity?.(); stopIdentity = undefined; },
    leaveVisit() { if (flight || value?.state === 'PENDING' || value?.state === 'EXPIRED') throw new Error('SESSION_ATTEMPT_UNRESOLVED'); transition(null, true); },
    begin(command: SessionAttemptCommand, rowIds: string[]) {
      const recovered = read();
      if (!scope || flight || recovered?.state === 'PENDING' || recovered?.state === 'EXPIRED') throw new Error('SESSION_ATTEMPT_UNRESOLVED');
      if (recovered && (recovered.state !== 'PARTIAL' || command.kind !== 'append' || command.sessionId !== recovered.sessionId)) throw new Error('SESSION_VISIT_ALREADY_SAVED');
      if (slots.blocked) throw persistenceError();
      const attempt = freezeSessionAttempt(scope, command, rowIds, runtime); transition({ version: 1, state: 'PENDING', attempt }, true);
      return attempt;
    },
    run<T extends WriteResult>(attempt: SessionAttempt, send: () => Promise<T>): Promise<T> {
      if (flight?.key === attempt.key && matches(attempt)) return flight.promise as Promise<T>;
      if (read()?.state !== 'PENDING' || !matches(attempt)) return Promise.reject(new Error('SESSION_ATTEMPT_UNAVAILABLE'));
      const promise = Promise.resolve().then(() => {
        const entry = read(); if (entry?.state !== 'PENDING' || !matches(attempt)) throw new Error('SESSION_ATTEMPT_UNAVAILABLE');
        transition({ ...entry, lastSentAt: Math.max(entry.lastSentAt ?? entry.attempt.createdAt, runtime.now()) }, true); return send();
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
    get persistenceWarning() { return current() ? entry.core.persistenceWarning : null; },
    read() { return current() ? entry.core.read() : null; },
    changeScope(next: SessionAttemptScope | null) { if (!disposed) { if (next) binding = freezeSessionAttemptScope(next); entry.core.changeScope(next); } },
    leaveVisit() { requireCurrent(); entry.core.leaveVisit(); },
    begin(command: SessionAttemptCommand, rowIds: string[]) { requireCurrent(); return entry.core.begin(command, rowIds); },
    run<T extends WriteResult>(attempt: SessionAttempt, send: () => Promise<T>): Promise<T> { return current() ? entry.core.run(attempt, send) : Promise.reject(new Error('SESSION_ATTEMPT_UNAVAILABLE')); },
    dispose() { if (!disposed) { disposed = true; entry.users -= 1; if (entry.users === 0 && !entry.core.read()) entry.core.stop(); } },
  };
}
export type SessionAttemptJournal = ReturnType<typeof createSessionAttemptJournal>;
