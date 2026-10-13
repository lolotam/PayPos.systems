import type { SessionPerformerOptionPage, SessionPerformerOptionsQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import type { SQL } from 'drizzle-orm';
import { attendanceWorkingDate } from '../domain/clock-attendance.ts';
import { schedulingContext } from './schedule-context.adapter.ts';
import { sessionPerformers } from './session-performers.reader.ts';

export function createSessionReaders(reads: {
  page(tx: Tx, companyId: string, businessId: string, branchId: string, day: string, query: SessionPerformerOptionsQuery): Promise<SessionPerformerOptionPage>;
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
      return reads.page(tx, companyId, businessId, branchId, day, query);
    },
  };
}
