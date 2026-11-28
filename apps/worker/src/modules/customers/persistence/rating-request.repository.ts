import { sql } from 'drizzle-orm';
import type {
  RatingRequestRepository,
  RatingRequestRow,
} from '../ports/rating-request.repository.ts';

type StoredRequestRow = {
  readonly id: string;
  readonly status: RatingRequestRow['status'];
  readonly cancel_reason: string | null;
  readonly branch_id: string;
  readonly due_at: Date | string;
  readonly send_deadline: Date | string | null;
};

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
  findCoveringRequestDay: async (tx, key) => {
    const rows = await tx.execute<{ business_date: string }>(sql`SELECT
        r.business_date::text AS business_date
      FROM rating_requests AS r
      JOIN branches AS rb
        ON rb.company_id = r.company_id
        AND rb.business_id = r.business_id
        AND rb.id = r.branch_id
      JOIN businesses AS rbu
        ON rbu.company_id = rb.company_id
        AND rbu.id = rb.business_id
      WHERE r.company_id = ${key.companyId} AND r.business_id = ${key.businessId}
        AND r.customer_id = ${key.customerId}
        AND r.branch_id = ${key.branchId}
        AND r.business_date = (${key.localDate}::date - 1)
        AND r.status IN ('SENT', 'SENDING', 'SCHEDULED')
        AND r.send_deadline IS NOT NULL
        AND ((r.send_deadline - interval '30 minutes') AT TIME ZONE COALESCE(rb.timezone, rbu.timezone))::date > r.business_date
        AND ${key.occurredAt.toISOString()}::timestamptz < (r.send_deadline - interval '30 minutes')
      LIMIT 1`);
    return rows[0]?.business_date ?? null;
  },
};
