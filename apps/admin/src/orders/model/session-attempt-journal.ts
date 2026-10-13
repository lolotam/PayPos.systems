import { listenForIdentityChanges } from '@/shared/browser/load-page';
import { freezeSessionAttempt, freezeSessionAttemptScope, restoreSessionAttempt, sameSessionScope, sessionAttemptUnresolved, SESSION_ATTEMPT_RETENTION_MS,
  type SessionAttempt, type SessionAttemptCommand, type SessionAttemptRuntime, type SessionAttemptScope } from './session-attempt';

const storageKey = 'pospay:service-session-attempt';
type Recovery = SessionAttempt | 'EXPIRED' | null;
type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function createSessionAttemptJournal(initialScope: SessionAttemptScope, runtime: SessionAttemptRuntime, storage?: JournalStorage) {
  try { storage ??= sessionStorage; } catch { /* المتصفح قد يمنع الوصول للتخزين؛ المحاولة تظل مجمدة في الذاكرة. */ }
  let scope: SessionAttemptScope | null = freezeSessionAttemptScope(initialScope), pending: Recovery = null;
  let flight: { key: string; promise: Promise<unknown> } | undefined;
  let stopIdentity: () => void = () => undefined;
  const persist = () => {
    // الجسم الصارم لا يقبل هاتفاً أو اسماً؛ بعد انتهاء الاحتفاظ يبقى مؤشر المنع فقط، بلا جسم أو مفتاح.
    try {
      if (pending === null) storage?.removeItem(storageKey);
      else storage?.setItem(storageKey, JSON.stringify(pending === 'EXPIRED' ? { scope, expired: true } : pending));
    } catch { /* التخزين المقفول لا يمنع استعادة المحاولة من ذاكرة التبويب. */ }
  };
  try {
    const raw = storage?.getItem(storageKey);
    if (raw) {
      const value = JSON.parse(raw);
      if (sameSessionScope(value.scope, initialScope)) pending = value.expired === true ? 'EXPIRED' : restoreSessionAttempt(value);
      else storage?.removeItem(storageKey);
    }
  } catch { persist(); }
  const read = (): Recovery => {
    if (pending && pending !== 'EXPIRED' && runtime.now() - pending.createdAt >= SESSION_ATTEMPT_RETENTION_MS) {
      pending = 'EXPIRED'; persist();
    }
    return pending;
  };
  const changeScope = (next: SessionAttemptScope | null) => {
    if (!next || !scope || !sameSessionScope(scope, next)) { pending = null; flight = undefined; scope = next ? freezeSessionAttemptScope(next) : null; persist(); }
    stopIdentity(); stopIdentity = next ? listenForIdentityChanges(() => changeScope(null)) : () => undefined;
  };
  stopIdentity = listenForIdentityChanges(() => changeScope(null));
  return {
    read, changeScope,
    dispose() { stopIdentity(); scope = null; pending = null; flight = undefined; },
    get scope() { return scope; },
    begin(command: SessionAttemptCommand, rowIds: string[]) {
      if (!scope || read()) throw new Error('SESSION_ATTEMPT_UNRESOLVED');
      pending = freezeSessionAttempt(scope, command, rowIds, runtime); persist();
      return pending;
    },
    run<T>(attempt: SessionAttempt, send: () => Promise<T>): Promise<T> {
      if (!scope || !sameSessionScope(scope, attempt.scope) || read() !== attempt) return Promise.reject(new Error('SESSION_ATTEMPT_UNAVAILABLE'));
      if (flight?.key === attempt.key) return flight.promise as Promise<T>;
      const promise = Promise.resolve().then(() => {
        if (read() !== attempt || !scope || !sameSessionScope(scope, attempt.scope)) throw new Error('SESSION_ATTEMPT_UNAVAILABLE');
        return send();
      }).then((result) => {
        if (pending !== attempt || !scope || !sameSessionScope(scope, attempt.scope)) throw new Error('SESSION_ATTEMPT_UNAVAILABLE');
        pending = null; persist();
        return result;
      }, (error: unknown) => {
        if (pending !== attempt) throw new Error('SESSION_ATTEMPT_UNAVAILABLE');
        if (!sessionAttemptUnresolved(error)) { pending = null; persist(); }
        throw error;
      }).finally(() => { if (flight?.promise === promise) flight = undefined; });
      flight = { key: attempt.key, promise };
      return promise;
    },
  };
}
export type SessionAttemptJournal = ReturnType<typeof createSessionAttemptJournal>;
