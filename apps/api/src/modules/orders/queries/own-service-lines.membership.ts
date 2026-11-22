import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { OwnWorkContext } from './own-work-context.ts';
import {
  emptyOwnLineSet,
  ownLineSet,
  ownSessionMap,
  type OwnLineSet,
  type OwnSessionRow,
} from './own-service-lines.page.ts';
import { inMonth, occurredKey, uuidList } from './own-service-lines.sql.ts';

/**
 * يحدد سطور الموظفة في الشهر بثلاث جمل كل واحدة على جدول واحد، تبدأ من صفوفها هي.
 *
 * @param tx معاملة القراءة الواحدة بلقطتها
 * @param c سياق الشركة والنشاط
 * @param employeeId الموظفة الموثقة
 * @param month الشهر YYYY-MM
 * @param withShare هل عمود share مسموح فيُقرأ share_bps
 * @returns مفاتيح سطورها وحصصها
 */
export async function locateOwnLines(
  tx: Tx,
  c: OwnWorkContext,
  employeeId: string,
  month: string,
  withShare: boolean,
): Promise<OwnLineSet> {
  const performed = await tx.execute<{ line_id: string; share_bps?: number }>(
    sql`SELECT line_id${withShare ? sql`,share_bps` : sql``}
    FROM line_performers
    WHERE company_id=${c.companyId} AND business_id=${c.businessId} AND employee_id=${employeeId}`,
  );
  if (performed.length === 0) return emptyOwnLineSet;
  const lineRows = await tx.execute<{ id: string; session_id: string }>(sql`SELECT id,session_id
    FROM service_lines
    WHERE company_id=${c.companyId} AND business_id=${c.businessId}
      AND id=ANY(${uuidList(performed.map((row) => row.line_id))})`);
  const sessionIds = [...new Set(lineRows.map((row) => row.session_id))];
  const sessionRows =
    await tx.execute<OwnSessionRow>(sql`SELECT id,business_date::text AS business_date,${occurredKey} AS occurred_at,branch_id
    FROM service_sessions
    WHERE company_id=${c.companyId} AND business_id=${c.businessId}
      AND id=ANY(${uuidList(sessionIds)}) AND ${inMonth(month)}`);
  const sessions = ownSessionMap(sessionRows);
  return ownLineSet(performed, new Map(lineRows.map((row) => [row.id, row.session_id])), sessions);
}
