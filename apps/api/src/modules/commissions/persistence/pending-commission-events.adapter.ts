import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { PendingCommissionEventsPort } from '../ports/pending-commission-events.port.ts';

/**
 * عدّاد الأحداث المعلّقة (ADR-0012 §2): لا يقرأ التطبيق جدول outbox أبدًا، فالعدد كله من دالة الـdefiner
 * `statement_pending_commission_events` التي تأخذ الشركة من سياق المعاملة.
 */
export const pendingCommissionEvents: PendingCommissionEventsPort = {
  captureApprovalStart: async (tx: Tx): Promise<string> => {
    const [row] = await tx.execute<{ started_at: string }>(
      sql`SELECT pg_catalog.transaction_timestamp()::text AS started_at`,
    );
    if (row === undefined) throw new Error('The transaction timestamp is unavailable');
    return row.started_at;
  },
  pendingCount: async (tx: Tx, approvalStartedAt: string): Promise<bigint> => {
    const [row] = await tx.execute<{ pending: string }>(
      sql`SELECT public.statement_pending_commission_events(${approvalStartedAt}::text::timestamptz)::text AS pending`,
    );
    if (row === undefined) throw new Error('The pending events count is unavailable');
    return BigInt(row.pending);
  },
};
