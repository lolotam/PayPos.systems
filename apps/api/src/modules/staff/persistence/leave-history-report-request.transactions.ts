import { createHash } from 'node:crypto';
import {
  leaveHistoryReportStoredQuery,
  leaveHistoryReportStoredScope,
} from '@pospay/contracts';
import { appendOutboxEvent, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { createLeaveReadAccess } from './leave-read-access.adapter.ts';
import {
  freezeLeaveHistoryReportScope,
  LeaveHistoryReportRequestError,
  type LeaveHistoryReportActor,
  type LeaveHistoryReportPendingInsert,
  type LeaveHistoryReportStoredScope,
} from '../domain/leave-history-report-request.ts';
import type {
  LeaveHistoryReportRequestScope,
  LeaveHistoryReportRequestTransactions,
} from '../ports/leave-history-report-request.port.ts';

type LeaveReadAccess = ReturnType<typeof createLeaveReadAccess>;

function reportFingerprint(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

export async function authorizeLeaveHistoryReportRequest(
  tx: Tx,
  actor: LeaveHistoryReportActor,
  access: LeaveReadAccess,
  branchId?: string,
): Promise<LeaveHistoryReportStoredScope> {
  const result = await access.check(tx, { ...actor, own: false });
  if (result === null || result.branches.length === 0 || !result.eligibilityDays?.length)
    throw new LeaveHistoryReportRequestError('NOT_FOUND');
  if (!result.featureEnabled) throw new LeaveHistoryReportRequestError('FEATURE_DISABLED');
  if (branchId !== undefined && !result.branches.includes(branchId))
    throw new LeaveHistoryReportRequestError('NOT_FOUND');
  return leaveHistoryReportStoredScope.parse(freezeLeaveHistoryReportScope(result));
}

async function lockCreator(tx: Tx, actor: LeaveHistoryReportActor): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
    ${actor.companyId}::text || '|' || ${actor.businessId}::text || '|' || ${actor.userId}::text, 0))`);
}

async function findReusablePending(
  tx: Tx,
  actor: LeaveHistoryReportActor,
  fingerprintSource: string,
  now: Date,
): Promise<string | null> {
  const [row] = await tx.execute<{ id: string }>(sql`SELECT id FROM leave_history_reports
    WHERE company_id=${actor.companyId} AND business_id=${actor.businessId} AND created_by=${actor.userId}
    AND fingerprint=${reportFingerprint(fingerprintSource)} AND status='pending'
    AND deadline_at > ${now.toISOString()} LIMIT 1`);
  return row?.id ?? null;
}

async function countPending(
  tx: Tx,
  actor: LeaveHistoryReportActor,
  now: Date,
): Promise<number> {
  const [row] = await tx.execute<{ count: number }>(sql`SELECT count(*)::int AS count
    FROM leave_history_reports
    WHERE company_id=${actor.companyId} AND business_id=${actor.businessId} AND created_by=${actor.userId}
    AND status='pending' AND deadline_at > ${now.toISOString()}`);
  return row?.count ?? 0;
}

async function insertPending(
  tx: Tx,
  actor: LeaveHistoryReportActor,
  input: LeaveHistoryReportPendingInsert,
): Promise<void> {
  const query = leaveHistoryReportStoredQuery.parse(input.query);
  await tx.execute(sql`INSERT INTO leave_history_reports
    (company_id,id,business_id,created_by,query,fingerprint,scope,as_of,deadline_at,status,row_count,expires_at)
    VALUES (${actor.companyId},${input.id},${actor.businessId},${actor.userId},
    ${JSON.stringify(query)}::jsonb,${reportFingerprint(input.fingerprintSource)},
    ${JSON.stringify(input.scope)}::jsonb,${input.asOf},${input.deadlineAt},'pending',0,${input.expiresAt})`);
}

function requestScope(
  tx: Tx,
  actor: LeaveHistoryReportActor,
  ids: IdGenerator,
  access: LeaveReadAccess,
): LeaveHistoryReportRequestScope {
  return {
    authorize: (branchId) => authorizeLeaveHistoryReportRequest(tx, actor, access, branchId),
    lockCreator: () => lockCreator(tx, actor),
    findReusablePending: (fingerprintSource, now) =>
      findReusablePending(tx, actor, fingerprintSource, now),
    countPending: (now) => countPending(tx, actor, now),
    createPending: (input) => insertPending(tx, actor, input),
    publishRequested: (reportId) =>
      appendOutboxEvent(tx, ids.newId(), {
        aggregateType: 'leave_history_report',
        aggregateId: reportId,
        eventType: 'LeaveHistoryReportRequested',
        payload: { report_id: reportId },
      }),
  };
}

export function createLeaveHistoryReportRequestTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  access: LeaveReadAccess,
): LeaveHistoryReportRequestTransactions {
  return {
    run: (actor, work) =>
      database.withTenant(actor.companyId, (tx) => work(requestScope(tx, actor, ids, access)), {
        userId: actor.userId,
      }),
  };
}
