import {
  assertStatementPeriodsOpen,
  lockStatementPeriods,
  reopenReviewedStatementPeriods,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';

import type {
  BusinessTimeZoneReader,
  CommissionLineHeadWrite,
  CommissionLinePerformerWrite,
  CommissionLineProjectionScope,
  CommissionLineReplacement,
  CommissionPeriodLockInput,
} from '../ports/commission-line-projection.port.ts';

type HeadRow = { lineId: string; revision: number; period: string };

export function createCommissionLineProjectionScope(
  tx: Tx,
  businessTimeZone: BusinessTimeZoneReader,
): CommissionLineProjectionScope {
  return {
    lockLines: async (lineIds) => {
      for (const lineId of lineIds) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(
          hashtextextended(app_company_id()::text || ':commission-line:' || ${lineId}::uuid::text, 0))`);
      }
    },
    readHeads: async (lineIds) => {
      if (lineIds.length === 0) return [];
      const rows = await tx.execute<HeadRow>(sql`SELECT line_id AS "lineId",revision,period
        FROM commission_line_heads
        WHERE company_id=app_company_id() AND line_id=ANY(ARRAY[${sql.join(lineIds.map((lineId) => sql`${lineId}`), sql`,`)}]::uuid[])`);
      return rows;
    },
    businessTimeZone: (companyId, businessId) => businessTimeZone(tx, companyId, businessId),
    lockPeriods: async (input) => lockPeriods(tx, input),
    replaceLines: async (replacements) => replaceLines(tx, replacements),
    reopenReviewed: (input) => reopenReviewedStatementPeriods(tx, input),
  };
}

async function lockPeriods(tx: Tx, input: CommissionPeriodLockInput) {
  const locked = await lockStatementPeriods(tx, {
    businessId: input.businessId,
    periods: input.periods,
    ids: input.ids,
  });
  const affected = new Set(input.affectedPeriods);
  assertStatementPeriodsOpen(locked.filter((row) => affected.has(row.period)));
  return locked;
}

async function replaceLines(
  tx: Tx,
  replacements: readonly CommissionLineReplacement[],
): Promise<void> {
  if (replacements.length === 0) return;
  await upsertHeads(tx, replacements.map((replacement) => replacement.head));
  const lineIds = replacements.map((replacement) => replacement.head.lineId);
  await tx.execute(sql`DELETE FROM commission_lines
    WHERE company_id=app_company_id() AND line_id=ANY(ARRAY[${sql.join(lineIds.map((lineId) => sql`${lineId}`), sql`,`)}]::uuid[])`);
  await insertPerformerRows(tx, replacements.flatMap((replacement) => replacement.rows));
}

async function upsertHeads(
  tx: Tx,
  heads: readonly CommissionLineHeadWrite[],
): Promise<void> {
  await tx.execute(sql`INSERT INTO commission_line_heads(
    company_id,business_id,line_id,session_id,branch_id,service_id,customer_id,revision,status,
    business_date,period)
    VALUES ${sql.join(
      heads.map((head) => sql`(
        app_company_id(),${head.businessId},${head.lineId},${head.sessionId},${head.branchId},
        ${head.serviceId},${head.customerId},${head.revision},${head.status},${head.businessDate},${head.period}
      )`),
      sql`, `,
    )}
    ON CONFLICT (company_id,line_id) DO UPDATE SET
      business_id=EXCLUDED.business_id,session_id=EXCLUDED.session_id,branch_id=EXCLUDED.branch_id,
      service_id=EXCLUDED.service_id,customer_id=EXCLUDED.customer_id,revision=EXCLUDED.revision,
      status=EXCLUDED.status,business_date=EXCLUDED.business_date,period=EXCLUDED.period`);
}

async function insertPerformerRows(
  tx: Tx,
  rows: readonly CommissionLinePerformerWrite[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.execute(sql`INSERT INTO commission_lines(
    company_id,business_id,line_id,branch_id,employee_id,service_id,occurred_at,recorded_at,
    business_date,period,net,net_share,share_bps,rule_kind,rule_pct_bps,rule_fixed_amount,counts,status)
    VALUES ${sql.join(
      rows.map((row) => sql`(
        app_company_id(),${row.businessId},${row.lineId},${row.branchId},${row.employeeId},${row.serviceId},
        ${row.occurredAt},${row.recordedAt},${row.businessDate},${row.period},${row.net},${row.netShare},
        ${row.shareBps},${row.ruleKind},${row.rulePctBps},${row.ruleFixedAmount},${row.counts},${row.status}
      )`),
      sql`, `,
    )}`);
}
