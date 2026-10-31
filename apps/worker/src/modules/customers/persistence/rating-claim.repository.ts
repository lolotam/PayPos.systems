import { sql } from 'drizzle-orm';
import type {
  DueRatingRequest,
  RatingClaimRepository,
  RatingCustomer,
} from '../ports/rating-claim.repository.ts';

type StoredRequest = {
  readonly id: string;
  readonly business_id: string;
  readonly customer_id: string;
  readonly business_date: string;
  readonly branch_id: string;
  readonly due_at: Date | string;
  readonly send_deadline: Date | string | null;
  readonly status: DueRatingRequest['status'];
};

type StoredCustomer = {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly locale: 'ar' | 'en';
  readonly opted_out_at: Date | string | null;
};

function instant(value: Date | string): Date {
  return new Date(value instanceof Date ? value.getTime() : value);
}

function request(row: StoredRequest): DueRatingRequest {
  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id,
    businessDate: row.business_date,
    branchId: row.branch_id,
    dueAt: instant(row.due_at),
    sendDeadline: row.send_deadline === null ? null : instant(row.send_deadline),
    status: row.status,
  };
}

const REQUEST_COLUMNS = sql`id, business_id, customer_id, business_date::text AS business_date,
  branch_id, due_at, send_deadline, status`;

export const ratingClaimRepository: RatingClaimRepository = {
  due: async (tx, companyId, now, limit) => {
    const rows = await tx.execute<StoredRequest>(sql`
      SELECT ${REQUEST_COLUMNS}
        FROM rating_requests
       WHERE company_id = ${companyId} AND status = 'SCHEDULED'
         AND due_at <= ${now.toISOString()}::timestamptz
       ORDER BY due_at, id
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED`);
    return rows.map(request);
  },
  lockCustomer: async (tx, companyId, customerId) => {
    const rows = await tx.execute<StoredCustomer>(sql`
      SELECT id, name, phone, locale, opted_out_at
        FROM customers
       WHERE company_id = ${companyId} AND id = ${customerId}
       FOR NO KEY UPDATE`);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      locale: row.locale,
      optedOutAt: row.opted_out_at === null ? null : instant(row.opted_out_at),
    };
  },
  lockRequest: async (tx, companyId, requestId) => {
    const rows = await tx.execute<StoredRequest>(sql`
      SELECT ${REQUEST_COLUMNS}
        FROM rating_requests
       WHERE company_id = ${companyId} AND id = ${requestId}
       FOR UPDATE SKIP LOCKED`);
    const row = rows[0];
    return row === undefined ? null : request(row);
  },
  reschedule: async (tx, companyId, requestId, schedule, at) => {
    await tx.execute(sql`UPDATE rating_requests SET
        branch_id = ${schedule.branchId},
        due_at = ${schedule.dueAt.toISOString()}::timestamptz,
        send_deadline = ${schedule.sendDeadline?.toISOString() ?? null}::timestamptz,
        updated_at = ${at.toISOString()}::timestamptz
      WHERE company_id = ${companyId} AND id = ${requestId} AND status = 'SCHEDULED'`);
  },
  cancel: async (tx, companyId, requestId, reason, at) => {
    await tx.execute(sql`UPDATE rating_requests SET
        status = 'CANCELLED', cancel_reason = ${reason}, updated_at = ${at.toISOString()}::timestamptz
      WHERE company_id = ${companyId} AND id = ${requestId} AND status = 'SCHEDULED'`);
  },
  claim: async (tx, companyId, requestId, claim) => {
    const hash = Buffer.from(claim.tokenHash).toString('hex');
    await tx.execute(sql`UPDATE rating_requests SET
        status = 'SENDING', token_hash = decode(${hash}, 'hex'),
        token_key_version = ${claim.tokenKeyVersion},
        claimed_at = ${claim.claimedAt.toISOString()}::timestamptz,
        expires_at = ${claim.expiresAt.toISOString()}::timestamptz,
        ready_event_id = ${claim.readyEventId},
        updated_at = ${claim.claimedAt.toISOString()}::timestamptz
      WHERE company_id = ${companyId} AND id = ${requestId} AND status = 'SCHEDULED'`);
  },
  snapshotPerformers: async (tx, companyId, requestId, businessId, performers) => {
    for (const performer of performers) {
      await tx.execute(sql`INSERT INTO rating_performers
          (company_id, id, request_id, business_id, employee_id)
        VALUES (${companyId}, ${performer.id}, ${requestId}, ${businessId}, ${performer.employeeId})
        ON CONFLICT (company_id, business_id, request_id, employee_id) DO NOTHING`);
    }
  },
};
