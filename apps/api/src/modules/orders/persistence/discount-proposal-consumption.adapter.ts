import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { DiscountConsumptionPort } from '../ports/discount-consumption.port.ts';
import { termsHash } from './terms-hash.adapter.ts';

type LockedRow = {
  id: string;
  branch_id: string;
  requested_by: string;
  requested_by_membership_id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONSUMED';
  expires_at: Date;
  terms_hash: string;
};

export function discountConsumption(tx: Tx, companyId: string, businessId: string): DiscountConsumptionPort {
  return {
    lock: async (proposalIds) => {
      const ids = [...new Set(proposalIds.map((id) => id.toLowerCase()))].sort();
      if (ids.length === 0) return [];
      const selected = sql`id=ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`,`)}]::uuid[])`;
      const rows = await tx.execute<LockedRow>(sql`SELECT id,branch_id,requested_by,requested_by_membership_id,status,expires_at,terms_hash
        FROM discount_proposals WHERE company_id=${companyId} AND business_id=${businessId} AND kind='RECORD' AND ${selected}
        ORDER BY id FOR UPDATE`);
      return rows.map((row) => ({ id: row.id, branch_id: row.branch_id, requested_by: row.requested_by,
        requested_by_membership_id: row.requested_by_membership_id, status: row.status,
        expires_at: new Date(row.expires_at), terms_hash: row.terms_hash.trim() }));
    },
    consume: async (proposalId, lineId, hash, at) => {
      const moment = at.toISOString();
      const rows = await tx.execute<{ id: string }>(sql`UPDATE discount_proposals SET status='CONSUMED',consumed_line_id=${lineId},
        consumed_at=${moment}::timestamptz WHERE company_id=${companyId} AND business_id=${businessId} AND id=${proposalId}
        AND kind='RECORD' AND status='APPROVED' AND expires_at > ${moment}::timestamptz AND terms_hash=${hash} RETURNING id`);
      return rows.length > 0;
    },
    hash: termsHash(),
  };
}
