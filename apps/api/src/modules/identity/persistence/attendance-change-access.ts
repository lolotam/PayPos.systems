import { canonicalOwnerSql, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';

export async function readAttendanceChangeAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchIds: string | readonly string[],
  now: Date,
): Promise<{ canRequest: boolean; owner: boolean; branches: string[] }> {
  const access = await readAccessTransaction(tx, companyId, userId, now);
  const candidates = typeof branchIds === 'string' ? [branchIds] : branchIds;
  const branches = candidates.filter((branchId) =>
    evaluateAccess(access.grants, 'request:attendance-change:branch', {
      companyId,
      businessId,
      branchId,
      actorUserId: userId,
    }),
  );
  const [row] = await tx.execute<{ owner: boolean }>(sql`
    SELECT EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=${companyId} AND m.user_id=${userId}
      AND m.starts_at<=${now.toISOString()}::timestamptz
      AND (m.ends_at IS NULL OR m.ends_at>${now.toISOString()}::timestamptz)
      AND ${canonicalOwnerSql('m', companyId)}) AS owner`);
  return { canRequest: branches.length > 0, owner: row?.owner === true, branches: [...branches] };
}

export async function readAttendanceChangeApprovers(
  tx: Tx,
  companyId: string,
  now: Date,
): Promise<string[]> {
  const rows = await tx.execute<{ user_id: string }>(sql`
    SELECT DISTINCT m.user_id FROM memberships m WHERE m.company_id=${companyId}
      AND m.starts_at<=${now.toISOString()}::timestamptz
      AND (m.ends_at IS NULL OR m.ends_at>${now.toISOString()}::timestamptz)
      AND ${canonicalOwnerSql('m', companyId)} ORDER BY m.user_id`);
  return rows.map((row) => row.user_id);
}
