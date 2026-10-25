import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type {
  RatingRequestKey,
  RatingRequestRepository,
  RatingRequestRow,
} from '../ports/rating-request.repository.ts';

interface StoredRequestRow {
  readonly id: string;
  readonly status: RatingRequestRow['status'];
  readonly cancel_reason: string | null;
  readonly branch_id: string;
  readonly due_at: Date | string;
  readonly send_deadline: Date | string | null;
}

function instant(value: Date | string): Date {
  return new Date(value instanceof Date ? value.getTime() : value);
}

export const ratingRequestRepository: RatingRequestRepository = {
  lock: async (tx, key) => {
    const rows = await tx.execute<StoredRequestRow>(sql`SELECT
        id, status, cancel_reason, branch_id, due_at, send_deadline
      FROM rating_requests
      WHERE company_id = ${key.companyId} AND business_id = ${key.businessId}
        AND customer_id = ${key.customerId} AND business_date = ${key.businessDate}::date
      FOR UPDATE`);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      status: row.status,
      cancelReason: row.cancel_reason,
      branchId: row.branch_id,
      dueAt: instant(row.due_at),
      sendDeadline: row.send_deadline === null ? null : instant(row.send_deadline),
    };
  },
  insertIfAbsent: async (tx, key, row) => {
    await tx.execute(sql`INSERT INTO rating_requests
        (company_id, id, business_id, customer_id, business_date, branch_id, due_at, send_deadline, status)
      VALUES (${key.companyId}, ${row.id}, ${key.businessId}, ${key.customerId},
        ${key.businessDate}::date, ${row.branchId}, ${row.dueAt.toISOString()}::timestamptz,
        ${row.sendDeadline?.toISOString() ?? null}::timestamptz, 'SCHEDULED')
      ON CONFLICT (company_id, business_id, customer_id, business_date) DO NOTHING`);
  },
  schedule: async (tx, key, row, at) => {
    await tx.execute(sql`UPDATE rating_requests SET
        status = 'SCHEDULED', cancel_reason = NULL, branch_id = ${row.branchId},
        due_at = ${row.dueAt.toISOString()}::timestamptz,
        send_deadline = ${row.sendDeadline?.toISOString() ?? null}::timestamptz,
        updated_at = ${at.toISOString()}::timestamptz
      WHERE company_id = ${key.companyId} AND business_id = ${key.businessId}
        AND customer_id = ${key.customerId} AND business_date = ${key.businessDate}::date`);
  },
  cancel: async (tx, key, reason, at) => {
    await tx.execute(sql`UPDATE rating_requests SET
        status = 'CANCELLED', cancel_reason = ${reason}, updated_at = ${at.toISOString()}::timestamptz
      WHERE company_id = ${key.companyId} AND business_id = ${key.businessId}
        AND customer_id = ${key.customerId} AND business_date = ${key.businessDate}::date`);
  },
};
