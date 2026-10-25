import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

export interface BootstrapRangeRead {
  readonly cutoff: Date;
  readonly maxSessionId: string;
  readonly recordedAtOrBefore: Date;
}

export interface BootstrapSessionRead {
  readonly sessionId: string;
  readonly businessId: string;
  readonly customerId: string;
  readonly branchId: string;
  readonly occurredAt: Date;
}

type BootstrapSessionRow = {
  readonly session_id: string;
  readonly business_id: string;
  readonly customer_id: string;
  readonly branch_id: string;
  readonly occurred_at: Date | string;
};

type CountRow = { readonly count: string | number };
type WatermarkRow = { readonly session_id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateRange(range: BootstrapRangeRead): void {
  if (!UUID.test(range.maxSessionId)) throw new RangeError('DAY_SESSIONS_CURSOR_INVALID');
}

function validateCursor(afterSessionId: string | null, limit: number): void {
  if (afterSessionId !== null && !UUID.test(afterSessionId))
    throw new RangeError('DAY_SESSIONS_CURSOR_INVALID');
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new RangeError('DAY_SESSIONS_LIMIT_INVALID');
}

async function assertTenant(tx: Tx, companyId: string): Promise<void> {
  const rows = await tx.execute<{ company_id: string | null }>(
    sql`SELECT app_company_id()::text AS company_id`,
  );
  const tenant = rows[0]?.company_id ?? null;
  if (tenant === null || tenant.toLowerCase() !== companyId.toLowerCase())
    throw new Error('DAY_SESSIONS_TENANT_MISMATCH');
}

// حالة السطور متغيرة؛ عضوية صفحات bootstrap ثابتة والجدولة نفسها بتتعامل مع الإلغاء (FR-B02b).
export function sessionsSinceStatement(
  companyId: string,
  range: BootstrapRangeRead,
  afterSessionId: string | null,
  limit: number,
): SQL {
  const after = afterSessionId === null ? sql`TRUE` : sql`s.id > ${afterSessionId}::uuid`;
  return sql`SELECT s.id AS session_id, s.business_id, s.customer_id, s.branch_id, s.occurred_at
    FROM service_sessions s
    WHERE s.company_id = ${companyId} AND s.company_id = app_company_id()
      AND s.occurred_at >= ${range.cutoff.toISOString()}::timestamptz
      AND s.id <= ${range.maxSessionId}::uuid
      AND s.recorded_at <= ${range.recordedAtOrBefore.toISOString()}::timestamptz
      AND ${after}
    ORDER BY s.id LIMIT ${limit}`;
}

export async function listSessionsSince(
  tx: Tx,
  companyId: string,
  range: BootstrapRangeRead,
  afterSessionId: string | null,
  limit: number,
): Promise<BootstrapSessionRead[]> {
  validateRange(range);
  validateCursor(afterSessionId, limit);
  await assertTenant(tx, companyId);
  const rows = await tx.execute<BootstrapSessionRow>(
    sessionsSinceStatement(companyId, range, afterSessionId, limit),
  );
  return rows.map((row) => ({
    sessionId: row.session_id,
    businessId: row.business_id,
    customerId: row.customer_id,
    branchId: row.branch_id,
    occurredAt: new Date(
      row.occurred_at instanceof Date ? row.occurred_at.getTime() : row.occurred_at,
    ),
  }));
}

// مهمة bootstrap لطلبات التقييم تحسب التغطية المتوقعة للنطاق المجمد نفسه (FR-B02b).
export function countSessionsSinceStatement(companyId: string, range: BootstrapRangeRead): SQL {
  return sql`SELECT count(*) AS count FROM service_sessions s
    WHERE s.company_id = ${companyId} AND s.company_id = app_company_id()
      AND s.occurred_at >= ${range.cutoff.toISOString()}::timestamptz
      AND s.id <= ${range.maxSessionId}::uuid
      AND s.recorded_at <= ${range.recordedAtOrBefore.toISOString()}::timestamptz`;
}

export async function countSessionsSince(
  tx: Tx,
  companyId: string,
  range: BootstrapRangeRead,
): Promise<number> {
  validateRange(range);
  await assertTenant(tx, companyId);
  const rows = await tx.execute<CountRow>(countSessionsSinceStatement(companyId, range));
  return Number(rows[0]?.count ?? 0);
}

// مهمة bootstrap لطلبات التقييم تقرأ أعلى معرف مرة واحدة لتجميد النطاق (FR-B02b).
export function latestSessionWatermarkStatement(companyId: string): SQL {
  return sql`SELECT s.id AS session_id FROM service_sessions s
    WHERE s.company_id = ${companyId} AND s.company_id = app_company_id()
    ORDER BY s.id DESC LIMIT 1`;
}

export async function latestSessionWatermark(tx: Tx, companyId: string): Promise<string | null> {
  await assertTenant(tx, companyId);
  const rows = await tx.execute<WatermarkRow>(latestSessionWatermarkStatement(companyId));
  return rows[0]?.session_id ?? null;
}
