import { appendOutboxEvent, type Tx } from '@pospay/db';
import { lowRatingReceived } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import type { StoredRating } from '../domain/low-rating-notice.ts';
import type { LowRatingOutbox, LowRatingRepository } from '../ports/low-rating-notice.ports.ts';
import { performerNameAdapter } from './performer-name.adapter.ts';

type RatingRow = {
  readonly request_id: string;
  readonly business_id: string;
  readonly branch_id: string;
  readonly stars: number;
  readonly has_comment: boolean;
  readonly business_date: string;
  readonly customer_id: string;
};

function storedRating(row: RatingRow): StoredRating {
  return {
    requestId: row.request_id,
    businessId: row.business_id,
    branchId: row.branch_id,
    stars: row.stars,
    hasComment: row.has_comment,
    businessDate: row.business_date,
    customerId: row.customer_id,
  };
}

export function lowRatingRepository(tx: Tx): LowRatingRepository {
  return {
    readRating: async (event) => {
      const [row] = await tx.execute<RatingRow>(sql`SELECT r.request_id, r.business_id, r.branch_id,
          r.stars, (r.comment IS NOT NULL AND length(r.comment) > 0) AS has_comment,
          q.business_date::text AS business_date, q.customer_id
        FROM ratings r
        JOIN rating_requests q ON q.company_id = r.company_id AND q.id = r.request_id
        WHERE r.company_id = ${event.companyId} AND r.id = ${event.ratingId}`);
      return row === undefined ? null : storedRating(row);
    },
    readComment: async (event) => {
      const [row] = await tx.execute<{ comment: string | null }>(
        sql`SELECT comment FROM ratings
          WHERE company_id = ${event.companyId} AND id = ${event.ratingId}`,
      );
      return row?.comment ?? null;
    },
    readCustomer: async (event, customerId) => {
      const [row] = await tx.execute<{ name: string; phone: string }>(
        sql`SELECT name, phone FROM customers
          WHERE company_id = ${event.companyId} AND id = ${customerId}`,
      );
      return row === undefined ? null : { name: row.name, phone: row.phone };
    },
    performers: async (event) => {
      const rows = await tx.execute<{ employee_id: string }>(sql`SELECT employee_id
        FROM rating_performers
        WHERE company_id = ${event.companyId} AND business_id = ${event.businessId}
          AND request_id = ${event.requestId}
        ORDER BY employee_id`);
      const ids = rows.map((row) => row.employee_id);
      const names = new Map(
        (await performerNameAdapter.firstNames(tx, event.companyId, ids)).map((n) => [
          n.employeeId,
          n,
        ]),
      );
      return ids.map((id) => ({
        nameAr: names.get(id)?.nameAr ?? null,
        nameEn: names.get(id)?.nameEn ?? null,
      }));
    },
    claim: async (event, decision) => {
      const rows = await tx.execute(sql`INSERT INTO low_rating_notices
          (company_id, id, business_id, branch_id, rating_id, source_event_id, decided_at, recipient_count)
        VALUES (${event.companyId}, ${decision.id}, ${event.businessId}, ${event.branchId},
          ${event.ratingId}, ${event.sourceEventId}, ${decision.decidedAt.toISOString()}::timestamptz,
          ${decision.recipientCount})
        ON CONFLICT (company_id, rating_id) DO NOTHING RETURNING id`);
      return rows.length === 1;
    },
  };
}

export function lowRatingOutbox(tx: Tx): LowRatingOutbox {
  return {
    append: (id, ratingId, payload) =>
      appendOutboxEvent(tx, id, {
        aggregateType: 'rating',
        aggregateId: ratingId,
        eventType: 'LowRatingReceived',
        payload: lowRatingReceived.parse(payload),
      }),
  };
}
