import { sessionPerformerCursorData, type SessionPerformerOptionPage, type SessionPerformerOptionsQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import type { SQL } from 'drizzle-orm';
import { searchHash, cursorScope, encodeCursor, decodeCursor } from '../../../shared/persistence/name-options-cursor.ts';
import { attendanceWorkingDate } from '../domain/clock-attendance.ts';
import { schedulingContext } from './schedule-context.adapter.ts';
import { sessionPerformers } from './session-performers.reader.ts';

function readCursor(query: SessionPerformerOptionsQuery, requestedAt: string, scopeHash: string) {
  if (query.cursor === undefined) return null;
  try {
    const cursor = decodeCursor(query.cursor, (value) => sessionPerformerCursorData.parse(value));
    if (cursor.lang !== query.lang || cursor.requested_at !== requestedAt || cursor.scope_hash !== scopeHash ||
      cursor.effective_at !== new Date(cursor.effective_at).toISOString()) throw new Error();
    return cursor;
  } catch { throw new RangeError('SESSION_PERFORMER_CURSOR_INVALID'); }
}

export const sessionPerformerCursorCodec = {
  scope: cursorScope,
  decode(query: SessionPerformerOptionsQuery, normalizedQ: string, requestedAt: string, scopeHash: string) {
    const cursor = readCursor(query, requestedAt, scopeHash);
    if (cursor !== null && (cursor.q_hash !== searchHash(normalizedQ) || cursor.effective_at !== query.occurred_at))
      throw new RangeError('SESSION_PERFORMER_CURSOR_INVALID');
    return cursor;
  },
  encode(key: string, id: string, query: SessionPerformerOptionsQuery, normalizedQ: string, requestedAt: string, scopeHash: string) {
    return encodeCursor({ key, id, lang: query.lang, q_hash: searchHash(normalizedQ),
      requested_at: requestedAt, effective_at: query.occurred_at, scope_hash: scopeHash });
  },
};

export function createSessionReaders(reads: {
  page(tx: Tx, companyId: string, businessId: string, branchId: string, day: string, query: SessionPerformerOptionsQuery,
    codec: typeof sessionPerformerCursorCodec, requestedAt: string, scopeHash: string): Promise<SessionPerformerOptionPage>;
  warningColumns(branchId: string, day: string, occurredAt: Date): SQL;
}) {
  return {
    readSessionPerformers(tx: Tx, companyId: string, businessId: string, branchId: string,
      employeeIds: readonly string[], occurredAt: Date, lockOnly = false) {
      return sessionPerformers(tx, companyId, businessId, branchId, employeeIds, occurredAt, reads.warningColumns, lockOnly);
    },
    async readSessionPerformerOptions(tx: Tx, companyId: string, businessId: string, branchId: string, query: SessionPerformerOptionsQuery,
      normalizeTime: (instant: string) => string) {
      const place = await schedulingContext(tx, companyId, businessId, branchId);
      if (place === null || !('timezone' in place)) return { items: [], next_cursor: null };
      const requestedAt = new Date(query.occurred_at).toISOString();
      const scopeHash = sessionPerformerCursorCodec.scope(companyId, businessId, branchId);
      const cursor = readCursor(query, requestedAt, scopeHash);
      const effectiveAt = cursor?.effective_at ?? normalizeTime(requestedAt);
      // تثبيت لحظة الصفحة الأولى يمنع تبدّل الإجازة الجزئية؛ نتيجة تطبيع الساعة الجديدة لا تُستخدم بعد فحص النافذة.
      if (cursor !== null) normalizeTime(effectiveAt);
      const day = attendanceWorkingDate(new Date(effectiveAt), place.timezone);
      return reads.page(tx, companyId, businessId, branchId, day, { ...query, occurred_at: effectiveAt }, sessionPerformerCursorCodec, requestedAt, scopeHash);
    },
  };
}
