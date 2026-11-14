import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type {
  NewServiceCategoryClosing,
  PendingServiceCategoryClosing,
} from '../domain/service-category-closing-path.ts';

type PendingRow = {
  id: string;
  action: 'close' | 'reopen';
  expected_revision: number;
  expected_service_count: number;
  deadline_at: Date;
};

export async function countAffectedServices(
  tx: Tx,
  companyId: string,
  businessId: string,
  categoryId: string,
  mode: 'open' | 'marked',
): Promise<number> {
  const state =
    mode === 'open' ? sql`AND closed_at IS NULL` : sql`AND closed_by_category_id=${categoryId}`;
  const [row] = await tx.execute<{ count: number }>(sql`SELECT count(*)::int AS count
    FROM services WHERE company_id=${companyId} AND business_id=${businessId}
      AND category_id=${categoryId} ${state}`);
  return Number(row?.count ?? 0);
}

export async function findPendingClosing(
  tx: Tx,
  companyId: string,
  businessId: string,
  categoryId: string,
): Promise<PendingServiceCategoryClosing | null> {
  const [row] = await tx.execute<PendingRow>(sql`SELECT id,action,expected_revision,
      expected_service_count,deadline_at FROM service_category_closings
    WHERE company_id=${companyId} AND business_id=${businessId} AND category_id=${categoryId}
      AND status='pending' LIMIT 1`);
  if (row === undefined) return null;
  return {
    id: row.id,
    action: row.action,
    expected_revision: row.expected_revision,
    expected_service_count: row.expected_service_count,
    deadline_at: new Date(row.deadline_at),
  };
}

export async function expireClosing(
  tx: Tx,
  companyId: string,
  closingId: string,
  at: Date,
): Promise<void> {
  await tx.execute(sql`UPDATE service_category_closings SET status='failed',
    error_code='SERVICE_CATEGORY_CLOSING_EXPIRED',finished_at=${at.toISOString()}::timestamptz
    WHERE company_id=${companyId} AND id=${closingId} AND status='pending'`);
}

export async function createClosing(
  tx: Tx,
  companyId: string,
  request: NewServiceCategoryClosing,
): Promise<void> {
  await tx.execute(sql`INSERT INTO service_category_closings
    (company_id,id,business_id,category_id,action,status,expected_revision,expected_service_count,
      requested_by,requested_at,deadline_at)
    VALUES (${companyId},${request.id},${request.business_id},${request.category_id},${request.action},
      'pending',${request.expected_revision},${request.expected_service_count},
      ${request.requested_by},${request.requested_at.toISOString()}::timestamptz,
      ${request.deadline_at.toISOString()}::timestamptz)`);
}
