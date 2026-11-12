import {
  historyIds,
  historyRows,
  type HistoryScope,
  type LeaveHistoryContext,
  type Tx,
} from '@pospay/db';
import {
  LEAVE_HISTORY_REPORT_ROW_CAP,
  leaveHistoryReportStoredQuery,
  leaveHistoryReportStoredScope,
} from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { leaveHistoryReportExceedsRowCap } from '../domain/leave-history-report.ts';
import {
  LeaveHistoryReportDeadlineError,
  LeaveHistoryReportInputError,
  LeaveHistoryReportTooLargeError,
} from '../ports/leave-history-report.port.ts';

const LEAVE_HISTORY_REPORT_VISIBILITY = 'current' as const;

type PendingReport = {
  business_id: string;
  created_by: string;
  query: unknown;
  scope: unknown;
  as_of: Date | string;
};

async function pendingReport(
  tx: Tx,
  companyId: string,
  reportId: string,
): Promise<PendingReport | null> {
  const [row] = await tx.execute<PendingReport>(sql`SELECT business_id,created_by,query,scope,as_of
    FROM leave_history_reports WHERE company_id=${companyId} AND id=${reportId}
    AND status='pending' FOR UPDATE`);
  return row ?? null;
}

async function deadlinePassed(tx: Tx, companyId: string, reportId: string): Promise<boolean | null> {
  const [row] = await tx.execute<{ expired: boolean }>(sql`
    SELECT clock_timestamp()>=deadline_at AS expired FROM leave_history_reports
    WHERE company_id=${companyId} AND id=${reportId} AND status='pending'`);
  return row?.expired ?? null;
}

async function eligibilityDays(
  tx: Tx,
  companyId: string,
  report: PendingReport,
  branchIds: string[],
) {
  if (branchIds.length === 0) return [];
  const asOf = new Date(report.as_of).toISOString();
  const rows = await tx.execute<{ branchId: string; today: string | null }>(sql`
    SELECT requested.branch_id AS "branchId",
      CASE WHEN zone.name IS NULL THEN NULL ELSE
        to_char((${asOf}::timestamptz AT TIME ZONE COALESCE(br.timezone,b.timezone))::date,'YYYY-MM-DD')
      END AS today
    FROM unnest(${historyIds(branchIds)}) WITH ORDINALITY AS requested(branch_id,position)
    JOIN branches br ON br.company_id=${companyId} AND br.business_id=${report.business_id}
      AND br.id=requested.branch_id
    JOIN businesses b ON b.company_id=${companyId} AND b.id=${report.business_id}
    LEFT JOIN pg_timezone_names zone ON zone.name=COALESCE(br.timezone,b.timezone)
    ORDER BY requested.position`);
  if (rows.length !== branchIds.length) throw new LeaveHistoryReportInputError();
  return rows.flatMap(({ branchId, today }) => (today === null ? [] : [{ branchId, today }]));
}

async function builderInputs(
  tx: Tx,
  companyId: string,
  report: PendingReport,
  rowCap: number,
) {
  const query = leaveHistoryReportStoredQuery.safeParse(report.query);
  const storedScope = leaveHistoryReportStoredScope.safeParse(report.scope);
  if (!query.success || !storedScope.success) throw new LeaveHistoryReportInputError();
  const { eligibilityBranchIds, ...branchSets } = storedScope.data;
  const scope: HistoryScope = {
    ...branchSets,
    now: new Date(report.as_of),
    eligibilityDays: await eligibilityDays(tx, companyId, report, eligibilityBranchIds),
  };
  return {
    query: { ...query.data, limit: rowCap + 1 },
    scope,
    asOf: new Date(report.as_of).toISOString(),
    rowCap,
  };
}

function reportRowsPrefix(
  context: LeaveHistoryContext,
  input: Awaited<ReturnType<typeof builderInputs>>,
) {
  return historyRows(context, input.query, input.scope, {
    asOf: input.asOf,
    excludeOpen: false,
    visibility: LEAVE_HISTORY_REPORT_VISIBILITY,
  });
}

async function countCandidateRows(
  tx: Tx,
  context: LeaveHistoryContext,
  input: Awaited<ReturnType<typeof builderInputs>>,
): Promise<number> {
  const [count] = await tx.execute<{ row_count: number }>(sql`${reportRowsPrefix(context, input)}
    SELECT count(*)::int AS row_count FROM (SELECT 1 FROM rows LIMIT ${input.rowCap + 1}) c`);
  return count?.row_count ?? 0;
}

async function insertReportRows(
  tx: Tx,
  reportId: string,
  context: LeaveHistoryContext,
  input: Awaited<ReturnType<typeof builderInputs>>,
): Promise<number> {
  await tx.execute(sql`${reportRowsPrefix(context, input)}
    INSERT INTO leave_history_report_rows(company_id,report_id,seq,employee_id,record)
    SELECT ${context.companyId}::uuid,${reportId}::uuid,
      row_number() OVER (ORDER BY date DESC,rank,id DESC)::int,
      (record->>'employee_id')::uuid,record
    FROM rows ORDER BY date DESC,rank,id DESC LIMIT ${input.rowCap + 1}`);
  const [count] = await tx.execute<{ row_count: number }>(sql`
    SELECT count(*)::int AS row_count FROM leave_history_report_rows
    WHERE company_id=${context.companyId} AND report_id=${reportId}
      AND seq BETWEEN 1 AND ${input.rowCap + 1}`);
  return count?.row_count ?? 0;
}

async function markReady(
  tx: Tx,
  companyId: string,
  reportId: string,
  rowCount: number,
): Promise<void> {
  const updated = await tx.execute<{ id: string }>(sql`UPDATE leave_history_reports
    SET status='ready',row_count=${rowCount},computed_at=clock_timestamp(),error_code=NULL
    WHERE company_id=${companyId} AND id=${reportId} AND status='pending'
      AND clock_timestamp()<deadline_at RETURNING id`);
  if (updated.length === 0) throw new LeaveHistoryReportDeadlineError();
}

export async function buildLeaveHistoryReport(
  tx: Tx,
  companyId: string,
  reportId: string,
  rowCap = LEAVE_HISTORY_REPORT_ROW_CAP,
): Promise<void> {
  const report = await pendingReport(tx, companyId, reportId);
  if (report === null) return;
  const expired = await deadlinePassed(tx, companyId, reportId);
  if (expired === null) return;
  await tx.execute(sql`SELECT set_config('app.user_id',${report.created_by},true)`);
  if (expired) {
    await tx.execute(sql`UPDATE leave_history_reports
      SET status='failed',error_code='LEAVE_HISTORY_REPORT_FAILED'
      WHERE company_id=${companyId} AND id=${reportId} AND status='pending'`);
    return;
  }
  const input = await builderInputs(tx, companyId, report, rowCap);
  const context: LeaveHistoryContext = {
    companyId,
    userId: report.created_by,
    businessId: report.business_id,
    own: false,
  };
  const candidateCount = await countCandidateRows(tx, context, input);
  if (leaveHistoryReportExceedsRowCap(candidateCount, rowCap)) {
    throw new LeaveHistoryReportTooLargeError();
  }
  const rowCount = await insertReportRows(tx, reportId, context, input);
  if (leaveHistoryReportExceedsRowCap(rowCount, rowCap)) {
    throw new LeaveHistoryReportTooLargeError();
  }
  await markReady(tx, companyId, reportId, rowCount);
}
