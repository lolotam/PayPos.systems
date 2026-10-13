import { sessionPerformerCursorData, type SessionPerformerOptionPage, type SessionPerformerOptionsQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import type { SQL } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { attendanceWorkingDate } from '../domain/clock-attendance.ts';
import { schedulingContext } from './schedule-context.adapter.ts';
import { sessionPerformers } from './session-performers.reader.ts';

function searchHash(normalizedQ: string) {
  return createHash('sha256').update(normalizedQ).digest('hex');
}

export const sessionPerformerCursorCodec = {
  decode(query: SessionPerformerOptionsQuery, normalizedQ: string) {
    if (query.cursor === undefined) return null;
    try {
      const cursor = sessionPerformerCursorData.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
      if (Buffer.from(JSON.stringify(cursor)).toString('base64url') !== query.cursor ||
        cursor.lang !== query.lang || cursor.q_hash !== searchHash(normalizedQ)) throw new Error();
      return cursor;
    } catch { throw new RangeError('SESSION_PERFORMER_CURSOR_INVALID'); }
  },
  encode(key: string, id: string, query: SessionPerformerOptionsQuery, normalizedQ: string) {
    return Buffer.from(JSON.stringify({ key, id, lang: query.lang, q_hash: searchHash(normalizedQ) })).toString('base64url');
  },
};

export function createSessionReaders(reads: {
  page(tx: Tx, companyId: string, businessId: string, branchId: string, day: string, query: SessionPerformerOptionsQuery,
    codec: typeof sessionPerformerCursorCodec): Promise<SessionPerformerOptionPage>;
  warningColumns(branchId: string, day: string, occurredAt: Date): SQL;
}) {
  return {
    readSessionPerformers(tx: Tx, companyId: string, businessId: string, branchId: string,
      employeeIds: readonly string[], occurredAt: Date, lockOnly = false) {
      return sessionPerformers(tx, companyId, businessId, branchId, employeeIds, occurredAt, reads.warningColumns, lockOnly);
    },
    async readSessionPerformerOptions(tx: Tx, companyId: string, businessId: string, branchId: string, query: SessionPerformerOptionsQuery) {
      const place = await schedulingContext(tx, companyId, businessId, branchId);
      if (place === null || !('timezone' in place)) return { items: [], next_cursor: null };
      const day = attendanceWorkingDate(new Date(query.occurred_at), place.timezone);
      return reads.page(tx, companyId, businessId, branchId, day, query, sessionPerformerCursorCodec);
    },
  };
}
