import { appendServiceSessionLinesInput, id, recordServiceSessionInput, type AppendServiceSessionLinesInput, type RecordServiceSessionInput } from '@pospay/contracts';
import type { components } from '@/shared/api/schema';

export type SessionAttemptScope = { companyId: string; businessId: string; branchId: string; userId: string };
export type SessionAttemptRuntime = { now: () => number; newId: () => string };
export type SessionAttemptCommand =
  | { kind: 'record'; body: RecordServiceSessionInput }
  | { kind: 'append'; sessionId: string; body: AppendServiceSessionLinesInput };
export type SessionAttempt = (
  | { kind: 'record'; body: components['schemas']['RecordServiceSessionInput'] }
  | { kind: 'append'; sessionId: string; body: components['schemas']['AppendServiceSessionLinesInput'] }
) & {
  scope: SessionAttemptScope; key: string; createdAt: number; route: string; rowIds: string[];
};
export const SESSION_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

export const freezeSessionAttemptScope = (scope: SessionAttemptScope): SessionAttemptScope => Object.freeze({
  companyId: id.parse(scope.companyId), businessId: id.parse(scope.businessId), branchId: id.parse(scope.branchId), userId: id.parse(scope.userId),
});

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function freezeSessionAttempt(scope: SessionAttemptScope, command: SessionAttemptCommand, rowIds: string[], runtime: SessionAttemptRuntime): SessionAttempt {
  const place = freezeSessionAttemptScope(scope);
  const body = command.kind === 'record' ? recordServiceSessionInput.parse(command.body) : appendServiceSessionLinesInput.parse(command.body);
  if (rowIds.length !== body.lines.length || new Set(rowIds).size !== rowIds.length) throw new Error('SESSION_ATTEMPT_ROW_MAP_INVALID');
  const rows = rowIds.map((row) => id.parse(row));
  const sessionId = command.kind === 'append' ? id.parse(command.sessionId) : undefined;
  const route = `/v1/businesses/${place.businessId}/branches/${place.branchId}/service-sessions${sessionId ? `/${sessionId}/lines` : ''}`;
  // JSON يحذف القيم الاختيارية undefined بنفس طريقة النقل، قبل التجميد والاحتفاظ بالمحاولة.
  const bound = command.kind === 'record' ? { kind: 'record' as const, body: JSON.parse(JSON.stringify(body)) as components['schemas']['RecordServiceSessionInput'] }
    : { kind: 'append' as const, sessionId: id.parse(sessionId), body: JSON.parse(JSON.stringify(body)) as components['schemas']['AppendServiceSessionLinesInput'] };
  return freeze({ ...bound, scope: place, rowIds: rows, route, key: id.parse(runtime.newId()), createdAt: runtime.now() });
}

export function restoreSessionAttempt(value: SessionAttempt): SessionAttempt {
  if (!Number.isFinite(value.createdAt)) throw new Error('SESSION_ATTEMPT_TIME_INVALID');
  const restored = freezeSessionAttempt(value.scope, value, value.rowIds, { now: () => value.createdAt, newId: () => value.key });
  if (restored.route !== value.route) throw new Error('SESSION_ATTEMPT_ROUTE_INVALID');
  return restored;
}

export const sameSessionScope = (a: SessionAttemptScope, b: SessionAttemptScope) =>
  a.companyId === b.companyId && a.businessId === b.businessId && a.branchId === b.branchId && a.userId === b.userId;

export function sessionAttemptUnresolved(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('status' in error) || typeof error.status !== 'number') return true;
  return !(error.status >= 400 && error.status < 500) || (error.status === 409 && 'code' in error && error.code === 'IDEMPOTENCY_KEY_IN_PROGRESS');
}
